const {test} = require("node:test");
const assert = require("node:assert/strict");
const {once} = require("node:events");
const {createApp} = require("../app");
const {loadCatalog} = require("../catalog");

test("HTTP 内容、身份边界、未知接口和无效 JSON", async () => {
  const app = createApp({database: {}, catalog: loadCatalog(), appId: "wx0000000000000000", logging: false});
  const server = app.listen(0, "127.0.0.1");await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${base}/api/luohan`);let data = await response.json();
    assert.equal(data.data.total, 500);assert.ok(Buffer.byteLength(JSON.stringify(data)) < 1000 * 1024);
    response = await fetch(`${base}/api/luohan?q=130`);data = await response.json();assert.equal(data.data.items[0].number, 130);assert.equal(data.data.total, 1);
    response = await fetch(`${base}/api/luohan/3`);data = await response.json();assert.ok(data.data.original);assert.ok(data.data.source.url);
    for (const value of ["0", "501", "1.5", "abc"]) {response = await fetch(`${base}/api/luohan/${value}`);assert.equal(response.status, 400);}
    response = await fetch(`${base}/api/me`);assert.equal(response.status, 401);
    response = await fetch(`${base}/api/wx_openid`);assert.equal(response.status, 401);
    response = await fetch(`${base}/api/me/import`);assert.equal(response.status, 401);
    response = await fetch(`${base}/api/no-such-route`);assert.equal(response.status, 404);
    response = await fetch(`${base}/api/me/bootstrap`, {method: "POST", headers: {"content-type":"application/json"}, body:"{"});assert.equal(response.status, 400);
    response = await fetch(`${base}/api/health`);assert.equal(response.status, 200);
  } finally {server.closeAllConnections();await new Promise(resolve => server.close(resolve));}
});
