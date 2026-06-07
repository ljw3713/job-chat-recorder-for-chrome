# Changelog

## 1.33.0 - 2026-06-07

- 同步页和总览页新增“忽略选中”，选中记录会移动到本地忽略记录表。
- 同步前会检查忽略记录表，已忽略的记录不会再次同步。
- 总览页新增“忽略记录”弹窗，可查看忽略记录并恢复到记录表。
- 记录表和忽略表保持互斥，同一唯一索引只会存在于其中一张表。

## 1.32.0 - 2026-06-04

- BOSS直聘同步不再要求当前页面必须是消息页，支持在 zhipin.com 登录态页面直接通过接口获取数据。
- 删除“打开/刷新 BOSS 消息页”相关按钮和旧捕获提示逻辑。

## 1.31.0 - 2026-06-04

- BOSS直聘唯一索引改为 `boss|encryptBossId|jobId`，支持同一个招聘者关联多个岗位。
- BOSS直聘同步前如果记录已存在但 `lastMessageInfo.msgId` 变化，会重新同步该记录。
- BOSS直聘消息变化时使用 `lastMessageInfo.msgTime` 更新“更新时间”，并更新“原消息”。

## 1.30.0 - 2026-06-03

- 修复猎聘待同步数量判断，去重比较同时兼容裸 `oppositeImId` 和 `liepin|oppositeImId`。
- 猎聘同步前会先和已保存记录、待保存记录进行统一 key 对比，已存在联系人不再重复同步。

## 1.29.0 - 2026-06-03

- 修复 BOSS直聘待同步数量过多的问题，去重逻辑恢复旧版唯一索引优先级。
- BOSS直聘唯一索引继续优先使用 `encryptBossId/encryptUid/uid/jobId/msgId`，`friendId` 仅作为兜底。
- 去重比较同时兼容裸 id 和 `boss|id` 形式，并保留导入数据已有的唯一索引。

## 1.28.0 - 2026-06-03

- BOSS直聘同步改为先通过 `geekFilterByLabel?labelId=0` 获取联系人 `friendId`。
- 使用获取到的 `friendId` 拼装 `friendIds` payload，再请求 `getGeekFriendList.json` 获取具体岗位信息。
- 合并标签列表中的联系人标识和更新时间，保留新接口去重字段并使用旧接口岗位详情。

## 1.27.0 - 2026-06-03

- BOSS直聘联系人列表改为通过 `geekFilterByLabel?labelId=0` 接口获取。
- 适配新接口返回的 `friendList`、`updateTime`、`encryptFriendId` 和 `friendId` 字段。
- 更新 BOSS 页面接口 hook，改为捕获新列表接口的 GET 响应。
