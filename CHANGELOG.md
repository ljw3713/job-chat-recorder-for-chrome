# Changelog

## 1.28.0 - 2026-06-03

- BOSS直聘同步改为先通过 `geekFilterByLabel?labelId=0` 获取联系人 `friendId`。
- 使用获取到的 `friendId` 拼装 `friendIds` payload，再请求 `getGeekFriendList.json` 获取具体岗位信息。
- 合并标签列表中的联系人标识和更新时间，保留新接口去重字段并使用旧接口岗位详情。

## 1.27.0 - 2026-06-03

- BOSS直聘联系人列表改为通过 `geekFilterByLabel?labelId=0` 接口获取。
- 适配新接口返回的 `friendList`、`updateTime`、`encryptFriendId` 和 `friendId` 字段。
- 更新 BOSS 页面接口 hook，改为捕获新列表接口的 GET 响应。
