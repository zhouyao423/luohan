# 归元数罗汉后端

Express + Sequelize + MySQL，提供用户资料、五百罗汉内容、收藏和数罗汉相遇历史。小程序通过微信云托管调用，服务根据网关注入的微信身份区分用户。

## 启动与配置

1. 运行 `npm ci` 安装锁定的依赖。
2. 云托管提供 `MYSQL_ADDRESS`（内网 host:port）、`MYSQL_USERNAME`、`MYSQL_PASSWORD`、`MYSQL_DATABASE` 四个环境变量，数据库须事先创建。小程序 AppID 和监听端口维护在 `config/application.cloud.properties`。
3. 本地调试将 `config/application.example.properties` 复制为 `config/application.local.properties`，填写数据库外网地址、账号、密码、库名、小程序 AppID 和本地监听端口。
4. 云托管运行 `npm start`；本地运行 `npm run start:local`。

本地 properties 使用 `key=value`，密码值保留等号后的全部字符。显式指定配置文件时仅使用文件配置，不受云端 MySQL 环境变量影响。私有 properties 文件已被 Git 忽略，文件权限建议为 `600`，不得放进文档或日志。默认监听端口为 80，须与云托管服务端口一致。

启动时验证数据库连接并创建缺失的表，不修改已有表结构。业务表为 `t_luohan_user`、`t_luohan_favorite`、`t_luohan_encounter`，时间按 UTC 保存。模板计数器的首页、接口和表保留。

Docker 构建使用锁定依赖，包含非敏感的云端配置文件；私有 properties 文件不会进入镜像。云托管从 master 构建时无需上传数据库配置文件，四个 MySQL 环境变量须在服务运行设置中提供。

## 微信调用与身份

基础库须支持 `wx.cloud.callContainer`（2.23.0 及以上）。先初始化云环境，再调用：

```js
await wx.cloud.init({ env: '你的云环境 ID' });
const result = await wx.cloud.callContainer({
  config: { env: '你的云托管环境 ID' },
  path: '/api/me/bootstrap',
  method: 'POST',
  header: {
    'X-WX-SERVICE': '你的服务名称',
    'content-type': 'application/json'
  },
  data: {}
});
const user = result.data.data;
```

客户端不传 OpenID、AppID 或业务用户 ID。服务校验网关注入的 `X-WX-SOURCE`、`X-WX-APPID`、`X-WX-OPENID`；资源复用时使用完整的 `X-WX-FROM-APPID` 和 `X-WX-FROM-OPENID`。调用方 AppID 必须与配置一致。

**这些请求头只有在可信网关入口下才可作为身份依据。服务上线前须关闭可绕过微信身份注入的公网访问，并检查网关对身份请求头的处理。普通 HTTP 客户端自行填写请求头不构成认证。**

用户初始化不读取微信昵称或头像。小程序应由用户主动选择头像、填写昵称后更新资料，允许保留默认昵称“读者”。

## 接口

成功响应为 `{ "code": 0, "message": "ok", "data": ... }`。错误包含字符串错误码和说明；HTTP 400 为参数错误，401 为身份缺失，404 为账号未初始化或接口不存在，409 为版本或幂等冲突，413 为请求过大，500 为内部错误。JSON 请求体上限为 100 KB。

### 用户

| 方法与路径 | 请求 | 返回与行为 |
| --- | --- | --- |
| `POST /api/me/bootstrap` | `{}` | 首次创建返回 201，重试返回 200；同一小程序身份只有一个用户 |
| `GET /api/me` | 无 | 用户 ID、昵称、头像文件 ID、头像上传目录、创建和更新时间 |
| `PATCH /api/me` | `nickname`、`avatarFileId` 至少一项 | 更新用户资料，不接受身份字段 |

昵称去除首尾空白后须为 1–40 个 Unicode 字符。`avatarFileId` 可为 `null`；非空时须为云存储文件 ID，路径位于返回的 `avatarUploadPrefix`，即 `users/{用户ID}/avatars/`，文件名使用字母、数字、下划线或连字符，扩展名为 jpg/jpeg/png/webp。

服务只校验头像文件 ID 格式和用户目录，不验证文件是否存在。客户端上传前需配置对象存储权限，使用户只能写入自己的目录；展示头像时使用云存储临时 URL。数据库不保存本地临时路径。

### 内容

| 方法与路径 | 请求 | 返回 |
| --- | --- | --- |
| `GET /api/luohan` | 可选 `q`，最多 100 字符 | `contentVersion`、`total`、`items`；数字按尊序查找，其他文字搜索名称或原文 |
| `GET /api/luohan/:no` | 尊序 1–500 | 名称、原文、赏读、来源、图片元数据和内容版本 |

目录位于 `data/luohan.json`，每尊只保留一份文字，共 500 尊；34 尊包含赏读，其余 `reading` 为空字符串。客户端须按内容是否存在展示赏读入口。图片元数据当前为空数组，接入对象存储图片后可补充。内容版本为目录文件的 SHA256。

### 收藏

| 方法与路径 | 请求 | 返回与行为 |
| --- | --- | --- |
| `GET /api/me/favorites` | 无 | `items`，包含收藏及取消收藏的状态和版本 |
| `PUT /api/me/favorites/:no` | `{ "version": 0 }` 等 | 收藏；版本 0 表示本地尚无服务端状态 |
| `DELETE /api/me/favorites/:no` | `{ "version": 1 }` 等 | 取消收藏；保留删除标记用于同步 |

每条状态包含 `number`、`saved`、`version`、`updatedAt`。客户端显示 `saved: true` 的条目，但同步时须保留 `saved: false` 的版本。重复写入同一状态不会递增版本；改变状态须使用最新版本，过期请求返回 409 和当前状态。客户端应刷新状态后由用户决定是否重新操作，避免旧设备覆盖新操作。

### 数罗汉与随机相遇

`POST /api/me/encounters` 接受以下一种请求：

```json
{
  "requestId": "client-request-0001",
  "mode": "count",
  "startNumber": 130,
  "count": 30,
  "direction": 1
}
```

```json
{ "requestId": "client-request-0002", "mode": "random" }
```

`requestId` 为 8–64 位字母、数字、下划线或连字符，每次新操作生成新 ID，网络重试沿用原 ID。计数的起点算第一尊，数量范围 1–500；方向 1 向右、-1 向左，超过首尾循环计数。示例结果为第 159 尊。

随机模式由服务端等概率选取 1–500，不接受计数参数或客户端结果。同一用户、同一请求 ID、同一参数只创建一条记录；重复请求返回原结果，改用其他参数返回 409。

结果包含玩法参数、最终尊序、内容版本、原文和来源快照、创建时间。目录更新不会修改既有历史。

`GET /api/me/encounters?limit=20&cursor=...` 按创建时间和记录 ID 倒序分页。`limit` 默认为 20，最大 100；将上一页返回的 `nextCursor` 原样传回，`null` 表示结束。记录仅对当前用户可见。

## 验证

测试使用 Node.js 18 及以上：

```sh
npm test
npm run test:db
```

第一条验证配置解析、身份、计数、随机取样、目录和 HTTP 参数边界。第二条读取本地 properties，连接真实 MySQL，验证用户隔离、收藏并发与版本、相遇幂等、历史快照、分页和查询索引；创建独立测试用户，并在结束时删除这些测试用户和关联数据。

健康检查为 `GET /api/health`，表示进程可响应，不代表实时数据库检查。云托管权限、对象存储权限、小程序真机调用和容器构建须在对应环境中另行验证。

## 参考

- [微信云托管开发指南](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/)
- [小程序调用容器](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/call/mini.html)
- [小程序上传云存储文件](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/storage/miniapp/upload.html)
- [MIT License](./LICENSE)
