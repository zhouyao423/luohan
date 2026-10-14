const {Sequelize, DataTypes} = require("sequelize");
const crypto = require("crypto");

function createDatabase(config) {
  const sequelize = new Sequelize(config.name, config.username, config.password, {
    host: config.host, port: config.port, dialect: "mysql", logging: false,
    timezone: "+00:00", dialectOptions: {charset: "utf8mb4", connectTimeout: 10000},
    pool: {max: 5, min: 0, acquire: 15000, idle: 10000},
  });
  const id = () => ({type: DataTypes.CHAR(32), primaryKey: true, allowNull: false, defaultValue: () => crypto.randomBytes(16).toString("hex"), comment: "业务记录标识"});
  const timestamps = () => ({
    createdAt: {type: DataTypes.DATE(3), allowNull: false, field: "created_at", comment: "创建时间，UTC，毫秒精度"},
    updatedAt: {type: DataTypes.DATE(3), allowNull: false, field: "updated_at", comment: "更新时间，UTC，毫秒精度"},
  });
  const options = (tableName, comment, indexes) => ({tableName, comment, timestamps: true, underscored: true, engine: "InnoDB", charset: "utf8mb4", collate: "utf8mb4_bin", indexes});
  const Content = sequelize.define("LuohanContent", {
    id: id(),
    number: {type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, comment: "罗汉尊序，1–500"},
    name: {type: DataTypes.STRING(100), allowNull: false, comment: "罗汉名称"},
    original: {type: DataTypes.TEXT, allowNull: false, comment: "偈语原文"},
    reading: {type: DataTypes.TEXT, allowNull: false, comment: "赏读正文，空字符串表示尚无赏读"},
    lineReadings: {type: DataTypes.JSON, allowNull: true, field: "line_readings", comment: "按原句顺序保存白话释义，元素含 original 和 explanation；NULL 表示尚未编写"},
    source: {type: DataTypes.JSON, allowNull: false, comment: "原文来源标题和链接"},
    ...timestamps(),
  }, options("t_luohan_content", "归元数罗汉内容", [{unique: true, name: "udx_number", fields: ["number"]}]));
  const Image = sequelize.define("LuohanImage", {
    id: id(),
    luohanNumber: {type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, field: "luohan_number", comment: "所属罗汉尊序，1–500"},
    type: {type: DataTypes.STRING(16), allowNull: false, comment: "图片类型，statue 为雕塑，gold-card 为金卡，classic-card 为经典卡"},
    fileId: {type: DataTypes.STRING(512), allowNull: false, field: "file_id", comment: "云存储稳定文件标识，不保存临时链接"},
    cloudPath: {type: DataTypes.STRING(512), allowNull: false, field: "cloud_path", comment: "对象存储文件路径"},
    width: {type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, comment: "图片宽度，像素"},
    height: {type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, comment: "图片高度，像素"},
    sha256: {type: DataTypes.CHAR(64), allowNull: false, comment: "图片文件 SHA256 哈希，十六进制"},
    ...timestamps(),
  }, options("t_luohan_image", "归元数罗汉图片索引", [{unique: true, name: "udx_luohan_number_type", fields: ["luohan_number", "type"]}]));
  const User = sequelize.define("LuohanUser", {
    id: id(),
    appId: {type: DataTypes.STRING(32), allowNull: false, field: "app_id", comment: "调用方小程序 AppID"},
    openId: {type: DataTypes.STRING(128), allowNull: false, field: "open_id", comment: "微信用户标识，仅在对应 AppID 下唯一"},
    nickname: {type: DataTypes.STRING(40), allowNull: false, defaultValue: "读者", comment: "用户设置的昵称，初始为读者"},
    avatarFileId: {type: DataTypes.STRING(512), allowNull: true, field: "avatar_file_id", comment: "头像对象存储文件标识，NULL 表示未设置"},
    ...timestamps(),
  }, options("t_luohan_user", "归元数罗汉用户", [{unique: true, name: "udx_app_id_open_id", fields: ["app_id", "open_id"]}]));
  const Favorite = sequelize.define("LuohanFavorite", {
    id: id(),
    userId: {type: DataTypes.CHAR(32), allowNull: false, field: "user_id", comment: "业务用户标识"},
    luohanNumber: {type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, field: "luohan_number", comment: "罗汉尊序，1–500"},
    saved: {type: DataTypes.BOOLEAN, allowNull: false, comment: "收藏状态，1 为收藏，0 为删除同步标记"},
    version: {type: DataTypes.INTEGER.UNSIGNED, allowNull: false, comment: "收藏状态版本，从 1 开始递增"},
    ...timestamps(),
  }, options("t_luohan_favorite", "归元数罗汉收藏及删除同步标记", [{unique: true, name: "udx_user_id_luohan_number", fields: ["user_id", "luohan_number"]}]));
  const Encounter = sequelize.define("LuohanEncounter", {
    id: id(),
    userId: {type: DataTypes.CHAR(32), allowNull: false, field: "user_id", comment: "业务用户标识"},
    requestId: {type: DataTypes.STRING(64), allowNull: false, field: "request_id", comment: "客户端生成的相遇请求标识，用于幂等重试"},
    requestHash: {type: DataTypes.CHAR(64), allowNull: false, field: "request_hash", comment: "计数参数 SHA256，用于识别请求标识误用"},
    mode: {type: DataTypes.STRING(8), allowNull: false, comment: "玩法，count 为计数，random 为随机"},
    startNumber: {type: DataTypes.SMALLINT.UNSIGNED, allowNull: true, field: "start_number", comment: "起点尊序，1–500；随机模式为 NULL"},
    count: {type: DataTypes.SMALLINT.UNSIGNED, allowNull: true, comment: "计数，1–500，起点算第一尊；随机模式为 NULL"},
    direction: {type: DataTypes.TINYINT, allowNull: true, comment: "计数方向，1 向右，-1 向左；随机模式为 NULL"},
    resultNumber: {type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, field: "result_number", comment: "最终尊序，1–500"},
    contentVersion: {type: DataTypes.CHAR(64), allowNull: false, field: "content_version", comment: "相遇时目录内容的 SHA256 版本"},
    snapshot: {type: DataTypes.JSON, allowNull: false, comment: "相遇时的编号、名称、原文和来源快照，后续目录更新不修改"},
    ...timestamps(),
  }, options("t_luohan_encounter", "归元数罗汉相遇历史", [
    {unique: true, name: "udx_user_id_request_id", fields: ["user_id", "request_id"]},
    {name: "idx_user_id_created_at_id", fields: ["user_id", "created_at", "id"]},
  ]));
  const Memorial = sequelize.define("LuohanMemorial", {
    id: id(),
    userId: {type: DataTypes.CHAR(32), allowNull: false, field: "user_id", comment: "业务用户标识"},
    luohanNumber: {type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, field: "luohan_number", comment: "典藏原稿对应尊序，1–500"},
    version: {type: DataTypes.INTEGER.UNSIGNED, allowNull: false, comment: "原稿同步版本，从 1 开始递增"},
    draft: {type: DataTypes.JSON, allowNull: false, comment: "名称、原文快照、昵称、日期、题字和印章"},
    ...timestamps(),
  }, options("t_luohan_memorial", "归元数罗汉用户典藏原稿", [{unique: true, name: "udx_memorial_user_number", fields: ["user_id", "luohan_number"]}]));
  const Counter = sequelize.define("Counter", {count: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 1}});
  async function init() {
    await sequelize.authenticate();
    // Only create missing tables; never alter an existing schema at startup.
    for (const model of [Counter, User, Favorite, Encounter, Content, Image, Memorial]) await model.sync();
  }
  return {sequelize, User, Favorite, Encounter, Counter, Content, Image, Memorial, init, close: () => sequelize.close()};
}
module.exports = {createDatabase};
