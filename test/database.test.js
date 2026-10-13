const {test} = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {once} = require("node:events");
const {Op} = require("sequelize");
const {loadConfig} = require("../config");
const {createDatabase} = require("../db");
const {createApp} = require("../app");
const {loadCatalog} = require("../catalog");

test("真实 MySQL：用户隔离、收藏版本、随机幂等、历史快照、分页", {timeout: 120000}, async () => {
  const config = loadConfig("config/application.local.properties");
  const db = createDatabase(config.database);
  const userIds = [];
  let server;
  try {
    await db.init();
    const catalog = loadCatalog();
    const app = createApp({database: db, catalog, appId: config.appId, logging: false});
    server = app.listen(0, "127.0.0.1");await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const testPrefix = `integration_${crypto.randomBytes(12).toString("hex")}`;
    async function call(user, method, path, body) {
      const response = await fetch(base + path, {method, headers: {"content-type": "application/json", "x-wx-source": "wx_client", "x-wx-appid": config.appId, "x-wx-openid": testPrefix + user}, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
      return {status: response.status, ...(await response.json())};
    }
    for (const user of ["A", "B"]) {
      const result = await call(user, "POST", "/api/me/bootstrap", {});
      assert.equal(result.status, 201);userIds.push(result.data.id);
    }
    const repeated = await Promise.all([call("A", "POST", "/api/me/bootstrap", {}),call("A", "POST", "/api/me/bootstrap", {})]);
    assert.ok(repeated.every(result => result.status === 200 && result.data.id === userIds[0]));
    let result = await call("A", "PATCH", "/api/me", {nickname: "静读🌿"});assert.equal(result.status, 200);assert.equal(result.data.nickname, "静读🌿");
    result = await call("A", "PATCH", "/api/me", {avatarFileId: `cloud://example.storage/users/${userIds[1]}/avatars/test.png`});assert.equal(result.status, 400);
    result = await call("A", "PATCH", "/api/me", {avatarFileId: `cloud://example.storage/users/${userIds[0]}/avatars/test.png`});assert.equal(result.status, 200);
    result = await call("A", "PATCH", "/api/me", {avatarFileId: null});assert.equal(result.data.avatarFileId, null);
    result = await call("A", "PUT", "/api/me/favorites/130", {version: 0});assert.equal(result.data.version, 1);
    result = await call("A", "PUT", "/api/me/favorites/130", {version: 0});assert.equal(result.data.version, 1);
    result = await call("B", "GET", "/api/me/favorites");assert.deepEqual(result.data.items, []);
    result = await call("A", "DELETE", "/api/me/favorites/130", {version: 1});assert.equal(result.data.saved, false);assert.equal(result.data.version, 2);
    result = await call("A", "PUT", "/api/me/favorites/130", {version: 1});assert.equal(result.status, 409);assert.equal(result.data.saved, false);
    result = await call("A", "PUT", "/api/me/favorites/130", {version: 2});assert.equal(result.data.version, 3);
    result = await call("B", "PUT", "/api/me/favorites/130", {version: 0, userId: userIds[0]});assert.equal(result.status, 400);
    const duplicates = await Promise.all([call("A", "DELETE", "/api/me/favorites/130", {version: 3}),call("A", "DELETE", "/api/me/favorites/130", {version: 3})]);
    assert.ok(duplicates.every(result => result.status === 200 && result.data.version === 4));
    assert.equal(await db.Favorite.count({where: {userId: userIds[0], luohanNumber: 130}}), 1);
    const counting = {requestId: "test-count-request", mode: "count", startNumber: 130, count: 30, direction: 1};
    result = await call("A", "POST", "/api/me/encounters", counting);assert.equal(result.status, 201);assert.equal(result.data.resultNumber, 159);
    const historical = result.data;
    result = await call("A", "POST", "/api/me/encounters", {...counting, direction: -1});assert.equal(result.status, 409);
    const entry = catalog.entries.find(entry => entry.number === 159);entry.original = "新目录文字";
    result = await call("A", "POST", "/api/me/encounters", counting);assert.equal(result.status, 200);assert.equal(result.data.snapshot.original, historical.snapshot.original);
    const random = {requestId: "test-random-request", mode: "random"};
    const draws = await Promise.all([call("A", "POST", "/api/me/encounters", random),call("A", "POST", "/api/me/encounters", random),call("A", "POST", "/api/me/encounters", random)]);
    assert.equal(draws.filter(result => result.status === 201).length, 1);assert.equal(new Set(draws.map(result => result.data.id)).size, 1);assert.equal(new Set(draws.map(result => result.data.resultNumber)).size, 1);
    result = await call("A", "POST", "/api/me/encounters", {requestId: "test-wrap-request", mode: "count", startNumber: 500, count: 2, direction: 1});assert.equal(result.data.resultNumber, 1);
    const seen = [];let cursor = null;
    do {
      result = await call("A", "GET", `/api/me/encounters?limit=1${cursor ? `&cursor=${cursor}` : ""}`);assert.equal(result.status, 200);
      seen.push(...result.data.items.map(item => item.id));cursor = result.data.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 3);assert.equal(new Set(seen).size, 3);
    result = await call("B", "GET", "/api/me/encounters");assert.deepEqual(result.data.items, []);
    result = await call("A", "GET", "/api/me/encounters?cursor=%25");assert.equal(result.status, 400);
    result = await call("A", "POST", "/api/me/import", {});assert.equal(result.status, 404);
    const [plan] = await db.sequelize.query("EXPLAIN SELECT id FROM t_luohan_encounter WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 21", {replacements: [userIds[0]]});
    assert.equal(plan[0].key, "idx_user_id_created_at_id");
    const [fields] = await db.sequelize.query("SELECT table_name, column_name, column_comment FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN ('t_luohan_user','t_luohan_favorite','t_luohan_encounter')");
    assert.ok(fields.length > 20);assert.ok(fields.every(field => field.column_comment));
    console.log("MySQL integration checks passed; all three business tables have column comments and the history query uses its index");
  } finally {
    if (server) {server.closeAllConnections();await new Promise(resolve => server.close(resolve));}
    if (userIds.length) await db.sequelize.transaction(async transaction => {
      const where = {userId: {[Op.in]: userIds}};
      await db.Encounter.destroy({where, transaction});await db.Favorite.destroy({where, transaction});
      await db.User.destroy({where: {id: {[Op.in]: userIds}}, transaction});
    });
    await db.close();
  }
});
