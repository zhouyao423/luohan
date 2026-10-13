const crypto = require("crypto");

class ApiError extends Error {
  constructor(status, code, message, data = null) {
    super(message);this.status = status;this.code = code;this.data = data;
  }
}
function invalid(message) { throw new ApiError(400, "INVALID_ARGUMENT", message); }
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) invalid(`${label}须为 ${min}–${max} 的整数`);
  return value;
}
function bodyFields(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("请求内容须为 JSON 对象");
  if (Object.keys(body).some(key => !allowed.includes(key))) invalid("请求包含不支持的字段");
}
function memorialDraft(body, number) {
  bodyFields(body, ["version", "number", "name", "original", "nickname", "date", "inscription", "seal"]);
  if (body.version !== 1 || body.number !== number) invalid("典藏原稿版本或尊序不一致");
  for (const [key, max, required] of [["name",100,true],["original",6000,true],["nickname",12,false],["inscription",48,false]]) {
    if (typeof body[key] !== "string" || (required && !body[key].trim()) || [...body[key]].length > max) invalid("典藏原稿文字无效或过长");
  }
  if (!["念", "藏", ""].includes(body.seal) || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !Number.isFinite(Date.parse(body.date)) || new Date(body.date + "T12:00:00Z").toISOString().slice(0, 10) !== body.date) invalid("典藏原稿日期或印章无效");
  return {version: 1, number, name: body.name, original: body.original, nickname: body.nickname, date: body.date, inscription: body.inscription, seal: body.seal};
}
function identity(headers, appId) {
  if (!headers["x-wx-source"]) throw new ApiError(401, "UNAUTHENTICATED", "请通过微信云托管调用");
  const reused = headers["x-wx-from-appid"] !== undefined || headers["x-wx-from-openid"] !== undefined;
  const callerAppId = headers[reused ? "x-wx-from-appid" : "x-wx-appid"];
  const openId = headers[reused ? "x-wx-from-openid" : "x-wx-openid"];
  if (callerAppId !== appId || typeof openId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(openId)) throw new ApiError(401, "UNAUTHENTICATED", "微信身份不可用");
  return {appId: callerAppId, openId};
}
function encounterInput(body) {
  bodyFields(body, ["requestId", "mode", "startNumber", "count", "direction"]);
  if (typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(body.requestId)) invalid("requestId 须为 8–64 位字母、数字、下划线或连字符");
  if (!["count", "random"].includes(body.mode)) invalid("mode 须为 count 或 random");
  if (body.mode === "random") {
    if (["startNumber", "count", "direction"].some(key => body[key] !== undefined)) invalid("随机模式不接受计数参数");
    return {requestId: body.requestId, mode: "random", startNumber: null, count: null, direction: null};
  }
  integer(body.startNumber, 1, 500, "起点");integer(body.count, 1, 500, "计数");
  if (body.direction !== 1 && body.direction !== -1) invalid("direction 须为 1（向右）或 -1（向左）");
  return {requestId: body.requestId, mode: "count", startNumber: body.startNumber, count: body.count, direction: body.direction};
}
function destination(start, count, direction) { return ((start - 1 + (count - 1) * direction) % 500 + 500) % 500 + 1; }
function randomNumber(source = crypto.randomBytes) {
  const limit = Math.floor(0x100000000 / 500) * 500;
  let value;
  do {value = source(4).readUInt32BE(0);} while (value >= limit);
  return value % 500 + 1;
}
function requestHash(input) {
  return crypto.createHash("sha256").update(JSON.stringify([input.mode, input.startNumber, input.count, input.direction])).digest("hex");
}
function encodeCursor(record) { return Buffer.from(JSON.stringify({time: record.createdAt.toISOString(), id: record.id})).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function decodeCursor(value) {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid("分页游标无效");
  try {
    const decoded = JSON.parse(Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!decoded || typeof decoded.time !== "string" || !/^[a-f0-9]{32}$/.test(decoded.id) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(decoded.time) || new Date(decoded.time).toISOString() !== decoded.time) invalid("分页游标无效");
    return {time: new Date(decoded.time), id: decoded.id};
  } catch {invalid("分页游标无效");}
}
module.exports = {ApiError, invalid, integer, bodyFields, memorialDraft, identity, encounterInput, destination, randomNumber, requestHash, encodeCursor, decodeCursor};
