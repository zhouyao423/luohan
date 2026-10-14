const fs = require("fs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {once} = require("node:events");
const {loadConfig} = require("../config");
const {createDatabase} = require("../db");
const {createApp} = require("../app");
const {readCatalog} = require("../catalog");
const {validateBatch, importLineReadings} = require("../line-readings");

test("真实 MySQL：500 尊、2000 句、重复导入无变更及详情接口", {timeout: 60000}, async () => {
  const config = loadConfig("config/application.local.properties");
  const db = createDatabase(config.database);
  let server;
  try {
    const expected = JSON.parse(fs.readFileSync("data/line-readings.json", "utf8")).entries;
    const before = await db.Content.findAll({order: [["number", "ASC"]], raw: true});
    validateBatch(before);
    assert.deepEqual(before.map(({number, name, original, lineReadings}) => ({number, name, original, lineReadings})), expected);
    const [coverage] = await db.sequelize.query("SELECT COUNT(*) AS entryCount, SUM(JSON_LENGTH(line_readings)) AS lineCount, SUM(line_readings IS NULL) AS missingCount FROM t_luohan_content");
    assert.equal(Number(coverage[0].entryCount), 500);assert.equal(Number(coverage[0].lineCount), 2000);assert.equal(Number(coverage[0].missingCount), 0);
    assert.equal((await importLineReadings(db, expected)).updated, 0);
    assert.deepEqual(await db.Content.findAll({order: [["number", "ASC"]], raw: true}), before);
    const catalog = await readCatalog(db);
    assert.equal(catalog.entries.length, 500);
    const app = createApp({database: db, appId: config.appId, logging: false});
    server = app.listen(0, "127.0.0.1");await once(server, "listening");
    for (const number of [1, 3, 48, 130, 229, 500]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/luohan/${number}`);
      assert.equal(response.status, 200);
      const {data} = await response.json();
      assert.deepEqual(data.lineReadings, expected[number - 1].lineReadings);
      assert.equal(data.original, expected[number - 1].original);
      assert.equal(data.contentVersion, catalog.version);
    }
  } finally {
    if (server) {server.closeAllConnections();await new Promise(resolve => server.close(resolve));}
    await db.close();
  }
});
