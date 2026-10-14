const {DataTypes, Transaction} = require("sequelize");

function verseLines(original) {
  if (typeof original !== "string") throw new Error("偈语原文无效");
  return original.split(/[\s，。；,.;．！？!?、+]+/u).filter(Boolean).flatMap(part => {
    const characters = [...part];
    // Some collected seven-character verses have no separators between lines.
    return characters.length > 7 && characters.length % 7 === 0 ? characters.join("").match(/.{7}/gu) : [part];
  });
}

function validateLineReadings(original, readings) {
  const lines = verseLines(original);
  if (!Array.isArray(readings) || !lines.length || readings.length !== lines.length) throw new Error("逐句解释数量与原文不一致");
  for (let i = 0; i < lines.length; i++) {
    const item = readings[i];
    if (!item || item.original !== lines[i] || typeof item.explanation !== "string" || item.explanation !== item.explanation.trim() || item.explanation.length < 8 || item.explanation.length > 300) throw new Error("逐句解释原句、顺序或正文无效");
  }
}

function validateBatch(entries) {
  if (!Array.isArray(entries) || entries.length !== 500) throw new Error("逐句解释须包含全部 500 尊");
  const numbers = new Set();
  for (const entry of entries) {
    if (!Number.isInteger(entry.number) || entry.number < 1 || entry.number > 500 || numbers.has(entry.number) || typeof entry.name !== "string" || !entry.name) throw new Error("逐句解释编号或名称无效");
    validateLineReadings(entry.original, entry.lineReadings);
    numbers.add(entry.number);
  }
}

async function migrateLineReadings(database) {
  const query = database.sequelize.getQueryInterface();
  const fields = await query.describeTable("t_luohan_content");
  if (!fields.line_readings) await query.addColumn("t_luohan_content", "line_readings", {type: DataTypes.JSON, allowNull: true, comment: "按原句顺序保存白话释义，元素含 original 和 explanation；NULL 表示尚未编写"});
}

async function importLineReadings(database, entries) {
  validateBatch(entries);
  return database.sequelize.transaction({isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ}, async transaction => {
    const rows = await database.Content.findAll({attributes: ["id", "number", "name", "original", "lineReadings"], order: [["number", "ASC"]], transaction, lock: transaction.LOCK.UPDATE});
    if (rows.length !== 500) throw new Error("数据库罗汉内容不完整");
    const byNumber = new Map(entries.map(entry => [entry.number, entry]));
    for (const row of rows) {
      const entry = byNumber.get(row.number);
      if (!entry || entry.name !== row.name || entry.original !== row.original) throw new Error(`第 ${row.number} 尊原文已变化，停止导入`);
      if (row.lineReadings && row.lineReadings.length && JSON.stringify(row.lineReadings) !== JSON.stringify(entry.lineReadings)) throw new Error(`第 ${row.number} 尊已有不同释义，停止覆盖`);
    }
    let updated = 0;
    for (const row of rows) {
      const entry = byNumber.get(row.number);
      if (JSON.stringify(row.lineReadings) === JSON.stringify(entry.lineReadings)) continue;
      await row.update({lineReadings: entry.lineReadings}, {transaction});
      updated++;
    }
    return {entries: entries.length, lines: entries.reduce((sum, entry) => sum + entry.lineReadings.length, 0), updated};
  });
}

module.exports = {verseLines, validateLineReadings, validateBatch, migrateLineReadings, importLineReadings};
