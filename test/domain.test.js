const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {identity, encounterInput, destination, randomNumber, requestHash, encodeCursor, decodeCursor} = require("../domain");
const {loadCatalog} = require("../catalog");

test("微信身份来自当前小程序或完整的资源复用请求头", () => {
  const appId = "wx0000000000000000";
  assert.deepEqual(identity({"x-wx-source": "wx_client", "x-wx-appid": appId, "x-wx-openid": "test-user"}, appId), {appId, openId: "test-user"});
  assert.deepEqual(identity({"x-wx-source": "wx_client", "x-wx-appid": "owner", "x-wx-from-appid": appId, "x-wx-from-openid": "test-user"}, appId), {appId, openId: "test-user"});
  for (const headers of [{}, {"x-wx-source": "wx_client"}, {"x-wx-source": "wx_client", "x-wx-appid": "other", "x-wx-openid": "test-user"}, {"x-wx-source": "wx_client", "x-wx-appid": appId, "x-wx-openid": "test-user", "x-wx-from-appid": appId}]) assert.throws(() => identity(headers, appId), error => error.status === 401);
});
test("起点算第一尊，两个方向都循环，不接受客户端结果或身份", () => {
  for (const [start, count, direction, expected] of [[130,30,1,159],[130,30,-1,101],[500,2,1,1],[1,2,-1,500],[130,1,1,130],[130,500,1,129]]) {
    const input = encounterInput({requestId: "test-request", mode: "count", startNumber: start, count, direction});
    assert.equal(destination(input.startNumber, input.count, input.direction), expected);
  }
  for (const changes of [{count: 0},{count: 501},{startNumber: "130"},{direction: 0},{resultNumber: 3},{userId: "someone"}]) assert.throws(() => encounterInput({requestId: "test-request", mode: "count", startNumber: 130, count: 30, direction: 1, ...changes}), error => error.status === 400);
  assert.throws(() => encounterInput({requestId: "test-request", mode: "random", startNumber: 130}));
});
test("随机拒绝采样消除取模偏差", () => {
  const values = [0xffffffff, 499];
  assert.equal(randomNumber(() => {const buffer = Buffer.alloc(4);buffer.writeUInt32BE(values.shift());return buffer;}), 500);
  assert.equal(values.length, 0);
});
test("幂等参数签名和分页游标保留完整语义", () => {
  const input = encounterInput({requestId: "test-request", mode: "count", startNumber: 130, count: 30, direction: 1});
  assert.equal(requestHash(input), requestHash({...input, requestId: "another-request"}));
  assert.notEqual(requestHash(input), requestHash({...input, direction: -1}));
  const row = {id: "a".repeat(32), createdAt: new Date("2026-10-13T00:00:00.123Z")};
  const cursor = decodeCursor(encodeCursor(row));
  assert.equal(cursor.id, row.id);assert.equal(cursor.time.toISOString(), row.createdAt.toISOString());
  for (const value of ["%", "e30", "a".repeat(300), ["abc"]]) assert.throws(() => decodeCursor(value));
});
test("500 尊各有一份文字，来源可查，响应没有前端核对分类", () => {
  const catalog = loadCatalog();assert.equal(catalog.entries.length, 500);
  assert.equal(new Set(catalog.entries.map(entry => entry.number)).size, 500);
  assert.ok(catalog.entries[2].original);assert.match(catalog.entries[2].source.url, /^https:\/\//);
  assert.equal(catalog.entries.some(entry => Object.hasOwn(entry, "verified")), false);
});

test("500 尊各有雕塑、金卡和经典卡，拒绝错号、外层目录和失效图片元数据", () => {
  const catalog = loadCatalog();
  const files = catalog.entries.flatMap(entry => entry.images.map(image => image.fileId));
  assert.equal(files.length, 1500);assert.equal(new Set(files).size, 1500);
  const card = catalog.entries[2].images.find(image => image.type === "gold-card");
  assert.equal(card.fileId, "cloud://prod-d3g2q7qh039bf1ea2.7072-prod-d3g2q7qh039bf1ea2-1505362636/luohan/gold-cards/003-3c70f437499c.jpg");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luohan-images-"));
  const filename = path.join(directory, "catalog.json");
  const original = JSON.stringify({entries: catalog.entries});
  const invalidImages = [
    entry => entry.images.pop(),
    entry => {entry.images[1] = {...entry.images[0]};},
    entry => {entry.images[0] = null;},
    entry => {entry.images[0].sha256 = "invalid";},
    entry => {entry.images[0].width = 0;},
    entry => {entry.images[2].cloudPath = entry.images[2].cloudPath.replace("classic-cards", "gold-cards");},
    entry => {entry.images[0].cloudPath = entry.images[0].cloudPath.replace("001-", "002-");},
    entry => {entry.images[0].fileId = entry.images[0].fileId.replace("/luohan/", "/对象存储上传包/luohan/");},
    entry => {entry.images[0].fileId = "https://example.com/temporary.jpg?expires=1";},
  ];
  try {
    for (const change of invalidImages) {
      const data = JSON.parse(original);change(data.entries[0]);
      fs.writeFileSync(filename, JSON.stringify(data));
      assert.throws(() => loadCatalog(filename), /图片|雕塑|金卡/);
    }
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
});
