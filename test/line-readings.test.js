const {test} = require("node:test");
const assert = require("node:assert/strict");
const {verseLines, validateBatch, validateLineReadings, importLineReadings} = require("../line-readings");

const original = "人生苦短休叹息，自立自强当努力。坚定信念勤追求，进则高来滞则低。";
const lineReadings = verseLines(original).map(line => ({original: line, explanation: "用自己的行动认真面对生活。"}));
const entries = Array.from({length: 500}, (_, index) => ({number: index + 1, name: `尊者${index + 1}`, original, lineReadings}));

test("分句保留文字，支持缺失标点、加号和非七言句", () => {
  assert.deepEqual(verseLines("学海无边勤为岸正途无涯稳为先粗浮浅薄难为器功成名就仰周全"), ["学海无边勤为岸", "正途无涯稳为先", "粗浮浅薄难为器", "功成名就仰周全"]);
  assert.deepEqual(verseLines("随喜功德结善缘，好运钟情有缘人深根松影覆岩石，千古岁寒傲霜晨"), ["随喜功德结善缘", "好运钟情有缘人", "深根松影覆岩石", "千古岁寒傲霜晨"]);
  assert.deepEqual(verseLines("胜人不如胜己 赞己不如赞人 与君不负登临约 同上金鳌背上行"), ["胜人不如胜己", "赞己不如赞人", "与君不负登临约", "同上金鳌背上行"]);
  assert.deepEqual(verseLines("肩膀重任信念坚+勤勉质朴清为濂+处事论世无烦恼+知足常乐种福田"), ["肩膀重任信念坚", "勤勉质朴清为濂", "处事论世无烦恼", "知足常乐种福田"]);
  assert.deepEqual(verseLines("忠信谨慎出英才，君之风志勤中来． 他年结出丰硕果，人间净土乐开怀"), ["忠信谨慎出英才", "君之风志勤中来", "他年结出丰硕果", "人间净土乐开怀"]);
});

test("拒绝缺句、错序、空释义和重复编号", () => {
  validateBatch(entries);
  assert.throws(() => validateLineReadings(original, lineReadings.slice(1)));
  assert.throws(() => validateLineReadings(original, [...lineReadings].reverse()));
  assert.throws(() => validateLineReadings(original, lineReadings.map(item => ({...item, explanation: " "}))));
  assert.throws(() => validateBatch(entries.slice(1)));
  assert.throws(() => validateBatch([...entries.slice(1), entries[1]]));
});

function database(rows) {
  const writes = [];
  return {writes, Content: {findAll: async options => {assert.equal(options.lock, "UPDATE");assert.ok(options.attributes.includes("id"));return rows.map(row => ({...row, update: async values => {writes.push({number: row.number, values});}}));}}, sequelize: {transaction: async (options, run) => {assert.equal(options.isolationLevel, "REPEATABLE READ");return run({LOCK: {UPDATE: "UPDATE"}});}}};
}

test("全量预检先于写入；只更新释义；重复导入跳过", async () => {
  const blank = entries.map(entry => ({...entry, lineReadings: null}));
  let db = database(blank);
  assert.deepEqual(await importLineReadings(db, entries), {entries: 500, lines: 2000, updated: 500});
  assert.equal(db.writes.length, 500);
  assert.ok(db.writes.every(write => Object.keys(write.values).join() === "lineReadings"));
  db = database(entries);
  assert.equal((await importLineReadings(db, entries)).updated, 0);
  assert.equal(db.writes.length, 0);
  db = database(blank.map(row => row.number === 500 ? {...row, original: "变化后的原文"} : row));
  await assert.rejects(importLineReadings(db, entries), /原文已变化/);
  assert.equal(db.writes.length, 0);
  db = database(blank.map(row => row.number === 500 ? {...row, lineReadings: [{original: "原句", explanation: "已有的编辑释义"}]} : row));
  await assert.rejects(importLineReadings(db, entries), /停止覆盖/);
  assert.equal(db.writes.length, 0);
});
