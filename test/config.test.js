const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {loadConfig} = require("../config");

test("properties 保留密码字符并拒绝重复字段、缺少字段和无效端口", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luohan-config-"));
  const filename = path.join(directory, "application.properties");
  const contents = "# Test configuration\nmysql.host=localhost\nmysql.database=test_db\nmysql.username=test_user\nmysql.password= test=value# \nwechat.appid=wx0000000000000000\n";
  try {
    fs.writeFileSync(filename, contents);
    const config = loadConfig(filename);
    assert.equal(config.database.password, " test=value# ");
    assert.equal(config.database.port, 3306);
    assert.equal(config.port, 80);
    for (const invalid of [contents + "mysql.host=other\n", contents + "mysql.port=0\n", contents.replace("mysql.database=test_db", "mysql.database="), contents + "server.port=70000\n"]) {
      fs.writeFileSync(filename, invalid);
      assert.throws(() => loadConfig(filename));
    }
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
});
