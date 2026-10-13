const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {Transaction} = require("sequelize");

function loadCatalog(filename = path.join(__dirname, "data/luohan.json")) {
  return catalogFromEntries(JSON.parse(fs.readFileSync(filename, "utf8")).entries);
}

function catalogFromEntries(entries) {
  const ids = new Set();
  if (!Array.isArray(entries) || entries.length !== 500) throw new Error("罗汉目录须包含 500 尊");
  for (const entry of entries) {
    if (!Number.isInteger(entry.number) || entry.number < 1 || entry.number > 500 || ids.has(entry.number) || !entry.name || !entry.original) throw new Error("罗汉目录编号或文字无效");
    if (!entry.source || !/^https?:\/\//.test(entry.source.url) || !Array.isArray(entry.images)) throw new Error("罗汉目录来源或图片元数据无效");
    if (entry.images.length !== 3) throw new Error("每尊须包含雕塑、金卡和经典卡");
    const imageTypes = new Set();
    for (const image of entry.images) {
      if (!image || !["statue", "gold-card", "classic-card"].includes(image.type) || imageTypes.has(image.type)) throw new Error("罗汉图片类型无效或重复");
      const statue = image.type === "statue";
      if (typeof image.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(image.sha256)) throw new Error("罗汉图片哈希无效");
      const cloudPath = `luohan/${statue ? "statues" : image.type === "gold-card" ? "gold-cards" : "classic-cards"}/${String(entry.number).padStart(3, "0")}-${image.sha256.slice(0, 12)}.${statue ? "webp" : "jpg"}`;
      const fileId = typeof image.fileId === "string" && image.fileId.match(/^cloud:\/\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\/(.+)$/);
      if (image.cloudPath !== cloudPath || !fileId || fileId[1] !== cloudPath || image.width !== 512 || image.height !== 768) throw new Error("罗汉图片路径或尺寸无效");
      imageTypes.add(image.type);
    }
    ids.add(entry.number);
  }
  entries.sort((a, b) => a.number - b.number);
  return {entries, version: crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex")};
}

async function readCatalog(database, transaction) {
  if (!transaction) return database.sequelize.transaction({isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ}, transaction => readCatalog(database, transaction));
  // shortcut: reads all 500 entries to hash the catalogue; add cache invalidation if traffic grows.
  const entries = await database.Content.findAll({attributes: ["number", "name", "original", "reading", "source"], order: [["number", "ASC"]], raw: true, transaction});
  const images = await database.Image.findAll({attributes: ["luohanNumber", "type", "fileId", "cloudPath", "width", "height", "sha256"], order: [["luohanNumber", "ASC"], ["type", "DESC"]], raw: true, transaction});
  const byNumber = new Map(entries.map(entry => {entry.images = [];return [entry.number, entry];}));
  for (const {luohanNumber, ...image} of images) {
    const entry = byNumber.get(luohanNumber);
    if (!entry) throw new Error("图片关联的罗汉内容不存在");
    entry.images.push(image);
  }
  return catalogFromEntries(entries);
}

async function importCatalog(database, catalog = loadCatalog()) {
  return database.sequelize.transaction({isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ}, async transaction => {
    const contentRows = await database.Content.findAll({attributes: ["number"], raw: true, transaction});
    const imageRows = await database.Image.findAll({attributes: ["luohanNumber", "type"], raw: true, transaction});
    const contentNumbers = new Set(contentRows.map(row => row.number));
    const imageKeys = new Set(imageRows.map(row => `${row.luohanNumber}:${row.type}`));
    const now = new Date();
    const contents = catalog.entries.filter(entry => !contentNumbers.has(entry.number)).map(({images, ...entry}) => ({...entry, createdAt: now, updatedAt: now}));
    const images = catalog.entries.flatMap(entry => entry.images.filter(image => !imageKeys.has(`${entry.number}:${image.type}`)).map(image => ({...image, luohanNumber: entry.number, createdAt: now, updatedAt: now})));
    if (contents.length) await database.Content.bulkCreate(contents, {transaction, validate: true});
    if (images.length) await database.Image.bulkCreate(images, {transaction, validate: true});
    return readCatalog(database, transaction);
  });
}
function firstLine(text) { return (text.match(/[^\s，。；,.;！？!?、]+[，。；,.;！？!?、]*/) || [text])[0]; }
function summary(entry) { return {number: entry.number, name: entry.name, firstLine: firstLine(entry.original), images: entry.images}; }
module.exports = {loadCatalog, readCatalog, importCatalog, summary};
