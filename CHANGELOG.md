# Changelog

## 1.27.0 - 2026-06-03

- BOSS直聘联系人列表改为通过 `geekFilterByLabel?labelId=0` 接口获取。
- 适配新接口返回的 `friendList`、`updateTime`、`encryptFriendId` 和 `friendId` 字段。
- 更新 BOSS 页面接口 hook，改为捕获新列表接口的 GET 响应。
