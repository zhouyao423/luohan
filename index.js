const {loadConfig} = require("./config");
const {createDatabase} = require("./db");
const {loadCatalog} = require("./catalog");
const {createApp} = require("./app");

async function bootstrap() {
  let database;
  try {
    const config = loadConfig(process.argv[2]);
    database = createDatabase(config.database);
    await database.init();
    const app = createApp({database, catalog: loadCatalog(), appId: config.appId});
    const server = app.listen(config.port, () => console.log("服务已启动", config.port));
    server.on("error", async error => {
      console.error("监听失败", error.code || error.name);
      await database.close();process.exitCode = 1;
    });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      const timeout = setTimeout(() => process.exit(1), 10000);timeout.unref();
      server.close(async () => {await database.close();clearTimeout(timeout);});
    };
    process.once("SIGTERM", stop);process.once("SIGINT", stop);
  } catch (error) {
    console.error("启动失败", error.name);
    if (database) await database.close();
    process.exitCode = 1;
  }
}
bootstrap();
