const fs = require("fs");
const path = require("path");
const {loadConfig} = require("../config");
const {createDatabase} = require("../db");
const {validateBatch, migrateLineReadings, importLineReadings} = require("../line-readings");

(async () => {
  let database;
  try {
    const entries = JSON.parse(fs.readFileSync(process.argv[3] || path.join(__dirname, "../data/line-readings.json"), "utf8")).entries;
    validateBatch(entries);
    database = createDatabase(loadConfig(process.argv[2]).database);
    await database.sequelize.authenticate();
    const fields = await database.sequelize.getQueryInterface().describeTable("t_luohan_content");
    const [before] = await database.sequelize.query("SELECT number, name, original, reading, source, updated_at" + (fields.line_readings ? ", line_readings AS lineReadings" : "") + " FROM t_luohan_content ORDER BY number");
    if (before.length !== 500 || before.some((row, i) => row.number !== i + 1 || row.name !== entries.find(entry => entry.number === row.number).name || row.original !== entries.find(entry => entry.number === row.number).original)) throw new Error("原文快照与数据库不一致，停止导入");
    const folder = path.join(__dirname, "../artifacts/line-readings");
    fs.mkdirSync(folder, {recursive: true});
    const backup = path.join(folder, `before-import-${new Date().toISOString().replace(/:/g, "-")}.json`);
    fs.writeFileSync(backup, JSON.stringify({entries: before}, null, 2), {flag: "wx"});
    await migrateLineReadings(database);
    const result = await importLineReadings(database, entries);
    const after = await database.Content.findAll({attributes: ["number", "name", "original", "reading", "source", "lineReadings"], order: [["number", "ASC"]], raw: true});
    validateBatch(after);
    for (let i = 0; i < before.length; i++) {
      for (const field of ["number", "name", "original", "reading", "source"]) {
        if (JSON.stringify(before[i][field]) !== JSON.stringify(after[i][field])) throw new Error("数据库回读与导入前内容不一致");
      }
      const expected = entries.find(entry => entry.number === after[i].number).lineReadings;
      if (JSON.stringify(after[i].lineReadings) !== JSON.stringify(expected)) throw new Error("数据库释义回读不一致");
    }
    console.log(JSON.stringify({...result, verified: after.length, backup}));
  } catch (error) {
    console.error("逐句解释导入失败", error.name);
    if (/^(逐句|数据库|原文|第 \d+ 尊)/.test(error.message)) console.error(error.message);
    process.exitCode = 1;
  } finally {if (database) await database.close();}
})();
