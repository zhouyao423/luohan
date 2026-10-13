const {loadConfig} = require("../config");
const {createDatabase} = require("../db");
const {importCatalog} = require("../catalog");

(async () => {
  let database;
  try {
    database = createDatabase(loadConfig(process.argv[2]).database);
    await database.sequelize.authenticate();
    await database.Content.sync();
    await database.Image.sync();
    const catalog = await importCatalog(database);
    console.log(JSON.stringify({entries: catalog.entries.length, images: catalog.entries.reduce((count, entry) => count + entry.images.length, 0), contentVersion: catalog.version}));
  } catch (error) {
    console.error("内容导入失败", error.name);
    process.exitCode = 1;
  } finally {if (database) await database.close();}
})();
