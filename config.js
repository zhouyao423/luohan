const fs = require("fs");
const path = require("path");

function loadConfig(filename, environment = process.env) {
  const cloud = filename === undefined;
  filename = filename || path.join(__dirname, "config/application.cloud.properties");
  let contents;
  try { contents = fs.readFileSync(filename, "utf8"); }
  catch { throw new Error("配置文件不可读取，请检查 properties 文件"); }
  const values = Object.create(null);
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim() || /^\s*[#!]/.test(line)) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("配置文件须使用 key=value 格式");
    const key = line.slice(0, separator).trim();
    if (Object.prototype.hasOwnProperty.call(values, key)) throw new Error("配置文件存在重复字段");
    values[key] = line.slice(separator + 1);
  }
  if (cloud) {
    const address = typeof environment.MYSQL_ADDRESS === "string" && environment.MYSQL_ADDRESS.match(/^([^\s:/]+):(\d{1,5})$/);
    if (!address) throw new Error("MYSQL_ADDRESS 须为 host:port");
    values["mysql.host"] = address[1];
    values["mysql.port"] = address[2];
    values["mysql.database"] = environment.MYSQL_DATABASE;
    values["mysql.username"] = environment.MYSQL_USERNAME;
    values["mysql.password"] = environment.MYSQL_PASSWORD;
  }
  for (const key of ["mysql.host", "mysql.database", "mysql.username", "mysql.password", "wechat.appid"]) {
    if (!values[key]) throw new Error(`缺少配置字段 ${key}`);
  }
  if (!/^[A-Za-z0-9_]+$/.test(values["mysql.database"])) throw new Error("数据库名格式无效");
  if (!/^wx[A-Za-z0-9]{16}$/.test(values["wechat.appid"])) throw new Error("小程序 AppID 格式无效");
  function port(key, fallback) {
    const value = values[key] === undefined ? fallback : Number(values[key]);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`端口配置无效：${key}`);
    return value;
  }
  return {
    database: {host: values["mysql.host"], port: port("mysql.port", 3306), name: values["mysql.database"], username: values["mysql.username"], password: values["mysql.password"]},
    port: port("server.port", 80), appId: values["wechat.appid"],
  };
}

module.exports = {loadConfig};
