const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadCatalog(filename = path.join(__dirname, "data/luohan.json")) {
  const raw = fs.readFileSync(filename, "utf8");
  const {entries} = JSON.parse(raw);
  const ids = new Set();
  if (!Array.isArray(entries) || entries.length !== 500) throw new Error("罗汉目录须包含 500 尊");
  for (const entry of entries) {
    if (!Number.isInteger(entry.number) || entry.number < 1 || entry.number > 500 || ids.has(entry.number) || !entry.name || !entry.original) throw new Error("罗汉目录编号或文字无效");
    if (!entry.source || !/^https?:\/\//.test(entry.source.url) || !Array.isArray(entry.images)) throw new Error("罗汉目录来源或图片元数据无效");
    ids.add(entry.number);
  }
  return {entries: entries.sort((a, b) => a.number - b.number), version: crypto.createHash("sha256").update(raw).digest("hex")};
}
function firstLine(text) { return (text.match(/[^\s，。；,.;！？!?、]+[，。；,.;！？!?、]*/) || [text])[0]; }
function summary(entry) { return {number: entry.number, name: entry.name, firstLine: firstLine(entry.original), images: entry.images}; }
module.exports = {loadCatalog, summary};
