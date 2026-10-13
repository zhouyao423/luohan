const path = require("path");
const {version} = require("./package.json");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const {Op, Transaction} = require("sequelize");
const {readCatalog, summary} = require("./catalog");
const {ApiError, invalid, integer, bodyFields, identity, encounterInput, destination, randomNumber, requestHash, encodeCursor, decodeCursor} = require("./domain");

function createApp({database, appId, readContent = transaction => readCatalog(database, transaction), logging = true}) {
  const {User, Favorite, Encounter, Counter, sequelize} = database;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({extended: false, limit: "100kb"}));
  app.use(express.json({limit: "100kb"}));
  app.use(cors());
  if (logging) {
    morgan.token("safe-path", req => req.path);
    app.use(morgan(":method :safe-path :status :response-time ms"));
  }
  const run = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);
  const ok = (res, data, status = 200) => res.status(status).json({code: 0, message: "ok", data});
  const profile = user => ({id: user.id, nickname: user.nickname, avatarFileId: user.avatarFileId, avatarUploadPrefix: `users/${user.id}/avatars/`, createdAt: user.createdAt, updatedAt: user.updatedAt});
  const favorite = row => ({number: row.luohanNumber, saved: row.saved, version: row.version, updatedAt: row.updatedAt});
  const encounter = row => ({id: row.id, requestId: row.requestId, mode: row.mode, startNumber: row.startNumber, count: row.count, direction: row.direction, resultNumber: row.resultNumber, contentVersion: row.contentVersion, snapshot: row.snapshot, createdAt: row.createdAt});
  function authenticate(req, res, next) {
    try {req.wxIdentity = identity(req.headers, appId);next();} catch (error) {next(error);}
  }
  function numberParam(value) {
    if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) invalid("尊序须为 1–500 的整数");
    return integer(Number(value), 1, 500, "尊序");
  }
  app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
  app.get("/api/health", (req, res) => ok(res, {status: "ok", version}));
  app.get("/api/luohan", run(async (req, res) => {
    if (req.query.q !== undefined && (typeof req.query.q !== "string" || req.query.q.length > 100)) invalid("搜索词最多 100 字符");
    const catalog = await readContent();
    const query = (req.query.q || "").trim();
    const matches = !query ? catalog.entries : catalog.entries.filter(entry => /^\d+$/.test(query) ? entry.number === Number(query) : entry.name.includes(query) || entry.original.includes(query));
    ok(res, {contentVersion: catalog.version, total: matches.length, items: matches.map(summary)});
  }));
  app.get("/api/luohan/:no", run(async (req, res) => {
    const number = numberParam(req.params.no);
    const catalog = await readContent();
    ok(res, {...catalog.entries.find(entry => entry.number === number), contentVersion: catalog.version});
  }));

  app.use("/api/me", authenticate, run(async (req, res, next) => {
    if (req.method === "POST" && req.path === "/bootstrap") return next();
    req.user = await User.findOne({where: req.wxIdentity});
    if (!req.user) throw new ApiError(404, "ACCOUNT_NOT_INITIALIZED", "请先初始化账号");
    next();
  }));
  app.post("/api/me/bootstrap", run(async (req, res) => {
    bodyFields(req.body, []);
    const [user, created] = await User.findOrCreate({where: req.wxIdentity});
    ok(res, profile(user), created ? 201 : 200);
  }));
  app.get("/api/me", (req, res) => ok(res, profile(req.user)));
  app.patch("/api/me", run(async (req, res) => {
    bodyFields(req.body, ["nickname", "avatarFileId"]);
    if (!Object.keys(req.body).length) invalid("请提供昵称或头像");
    const changes = {};
    if (req.body.nickname !== undefined) {
      if (typeof req.body.nickname !== "string" || !req.body.nickname.trim() || [...req.body.nickname.trim()].length > 40) invalid("昵称须为 1–40 个字符");
      changes.nickname = req.body.nickname.trim();
    }
    if (req.body.avatarFileId !== undefined) {
      if (req.body.avatarFileId !== null) {
        const fileId = req.body.avatarFileId;
        // shortcut: validates the file namespace only; verify existence and ownership when storage is connected.
        const match = typeof fileId === "string" && fileId.length <= 512 && fileId.match(/^cloud:\/\/[A-Za-z0-9._-]+\/(.+)$/);
        if (!match || !new RegExp(`^users/${req.user.id}/avatars/[A-Za-z0-9_-]+\\.(?:jpg|jpeg|png|webp)$`).test(match[1])) invalid("头像须来自当前用户的头像存储目录");
      }
      changes.avatarFileId = req.body.avatarFileId;
    }
    await req.user.update(changes);
    ok(res, profile(req.user));
  }));
  app.get("/api/me/favorites", run(async (req, res) => {
    const rows = await Favorite.findAll({where: {userId: req.user.id}, order: [["luohanNumber", "ASC"]]});
    const catalog = await readContent();
    const entryByNumber = new Map(catalog.entries.map(entry => [entry.number, entry]));
    ok(res, {items: rows.map(row => ({...favorite(row), entry: summary(entryByNumber.get(row.luohanNumber))}))});
  }));
  async function changeFavorite(req, res, saved) {
    const number = numberParam(req.params.no);
    bodyFields(req.body, ["version"]);
    const expectedVersion = integer(req.body.version, 0, 4294967294, "收藏版本");
    const row = await sequelize.transaction(async transaction => {
      // Serialize changes for this user, including the first insert with no row to lock yet.
      await User.findByPk(req.user.id, {transaction, lock: transaction.LOCK.UPDATE});
      const existing = await Favorite.findOne({where: {userId: req.user.id, luohanNumber: number}, transaction});
      if (existing && existing.saved === saved) return existing;
      if (expectedVersion !== (existing ? existing.version : 0)) throw new ApiError(409, "VERSION_CONFLICT", "收藏已更新，请读取最新状态", existing ? favorite(existing) : {number, saved: false, version: 0});
      if (existing) return existing.update({saved, version: existing.version + 1}, {transaction});
      return Favorite.create({userId: req.user.id, luohanNumber: number, saved, version: 1}, {transaction});
    });
    ok(res, favorite(row));
  }
  app.put("/api/me/favorites/:no", run((req, res) => changeFavorite(req, res, true)));
  app.delete("/api/me/favorites/:no", run((req, res) => changeFavorite(req, res, false)));
  app.post("/api/me/encounters", run(async (req, res) => {
    const input = encounterInput(req.body);
    const hash = requestHash(input);
    const result = await sequelize.transaction({isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ}, async transaction => {
      await User.findByPk(req.user.id, {transaction, lock: transaction.LOCK.UPDATE});
      const existing = await Encounter.findOne({where: {userId: req.user.id, requestId: input.requestId}, transaction});
      if (existing) {
        if (existing.requestHash !== hash) throw new ApiError(409, "REQUEST_ID_CONFLICT", "requestId 已用于另一组参数");
        return {row: existing, created: false};
      }
      const resultNumber = input.mode === "random" ? randomNumber() : destination(input.startNumber, input.count, input.direction);
      const catalog = await readContent(transaction);
      const entry = catalog.entries.find(entry => entry.number === resultNumber);
      const row = await Encounter.create({...input, userId: req.user.id, requestHash: hash, resultNumber, contentVersion: catalog.version, snapshot: {number: entry.number, name: entry.name, original: entry.original, source: entry.source}}, {transaction});
      return {row, created: true};
    });
    ok(res, encounter(result.row), result.created ? 201 : 200);
  }));
  app.get("/api/me/encounters", run(async (req, res) => {
    let limit = 20;
    if (req.query.limit !== undefined) {
      if (typeof req.query.limit !== "string" || !/^\d{1,3}$/.test(req.query.limit)) invalid("分页数量无效");
      limit = integer(Number(req.query.limit), 1, 100, "分页数量");
    }
    const where = {userId: req.user.id};
    if (req.query.cursor !== undefined) {
      const cursor = decodeCursor(req.query.cursor);
      where[Op.or] = [{createdAt: {[Op.lt]: cursor.time}}, {createdAt: cursor.time, id: {[Op.lt]: cursor.id}}];
    }
    const rows = await Encounter.findAll({where, limit: limit + 1, order: [["createdAt", "DESC"], ["id", "DESC"]]});
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    ok(res, {items: page.map(encounter), nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null});
  }));

  app.get("/api/wx_openid", authenticate, (req, res) => res.send(req.wxIdentity.openId));
  app.get("/api/count", run(async (req, res) => ok(res, await Counter.count())));
  app.post("/api/count", run(async (req, res) => {
    if (req.body.action === "inc") await Counter.create();
    else if (req.body.action === "clear") await Counter.destroy({where: {}});
    ok(res, await Counter.count());
  }));
  app.use((req, res) => res.status(404).json({code: "NOT_FOUND", message: "接口不存在", data: null}));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ApiError) return res.status(error.status).json({code: error.code, message: error.message, data: error.data});
    if (error.type === "entity.parse.failed") return res.status(400).json({code: "INVALID_JSON", message: "JSON 内容无效", data: null});
    if (error.type === "entity.too.large") return res.status(413).json({code: "BODY_TOO_LARGE", message: "请求内容超过限制", data: null});
    if (logging) console.error("请求处理失败", error.name);
    res.status(500).json({code: "INTERNAL_ERROR", message: "服务暂时不可用", data: null});
  });
  return app;
}
module.exports = {createApp};
