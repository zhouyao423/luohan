const {test} = require("node:test");
const assert = require("node:assert/strict");
const {once} = require("node:events");
const {createApp} = require("../app");
const {loadCatalog} = require("../catalog");

test("HTTP 内容、身份边界、未知接口和无效 JSON", async () => {
  const database = {User: {findOne: async () => ({id: "test-user"})}, Favorite: {findAll: async () => [{luohanNumber: 3, saved: true, version: 1}]}};
  const catalog = loadCatalog();
  let unavailable = false;
  const app = createApp({database, readContent: async () => {if (unavailable) throw new Error("private database error");return catalog;}, appId: "wx0000000000000000", logging: false});
  const server = app.listen(0, "127.0.0.1");await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${base}/api/luohan`);let data = await response.json();
    assert.equal(data.data.total, 500);assert.ok(Buffer.byteLength(JSON.stringify(data)) < 1000 * 1024);
    assert.equal(data.data.items.reduce((count, item) => count + item.images.length, 0), 1500);
    response = await fetch(`${base}/api/luohan?q=130`);data = await response.json();assert.equal(data.data.items[0].number, 130);assert.equal(data.data.total, 1);
    response = await fetch(`${base}/api/luohan/3`);data = await response.json();assert.ok(data.data.original);assert.ok(data.data.source.url);
    const images = data.data.images;
    assert.deepEqual(images.map(image => image.type), ["statue", "gold-card", "classic-card"]);
    assert.match(images[2].fileId, /\/luohan\/classic-cards\/003-7f6d952c8c8f\.jpg$/);
    assert.match(images[1].fileId, /\/luohan\/gold-cards\/003-3c70f437499c\.jpg$/);
    response = await fetch(`${base}/api/me/favorites`, {headers: {"x-wx-source": "wx_client", "x-wx-appid": "wx0000000000000000", "x-wx-openid": "test-user"}});
    data = await response.json();assert.equal(response.status, 200);assert.deepEqual(data.data.items[0].entry.images, images);
    catalog.entries[2].name = "更新后的罗汉名称";catalog.version = "a".repeat(64);
    response = await fetch(`${base}/api/luohan/3`);data = await response.json();
    assert.equal(data.data.name, "更新后的罗汉名称");assert.equal(data.data.contentVersion, catalog.version);
    for (const value of ["0", "501", "1.5", "abc"]) {response = await fetch(`${base}/api/luohan/${value}`);assert.equal(response.status, 400);}
    response = await fetch(`${base}/api/me`);assert.equal(response.status, 401);
    response = await fetch(`${base}/api/wx_openid`);assert.equal(response.status, 401);
    response = await fetch(`${base}/api/me/import`);assert.equal(response.status, 401);
    response = await fetch(`${base}/api/no-such-route`);assert.equal(response.status, 404);
    response = await fetch(`${base}/api/me/bootstrap`, {method: "POST", headers: {"content-type":"application/json"}, body:"{"});assert.equal(response.status, 400);
    response = await fetch(`${base}/api/health`);assert.equal(response.status, 200);assert.equal((await response.json()).data.version, "1.2.0");
    unavailable = true;
    response = await fetch(`${base}/api/luohan/3`);data = await response.json();
    assert.equal(response.status, 500);assert.equal(data.code, "INTERNAL_ERROR");assert.equal(data.data, null);
  } finally {server.closeAllConnections();await new Promise(resolve => server.close(resolve));}
});
