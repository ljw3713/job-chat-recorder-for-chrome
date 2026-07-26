# BOSS 直聘数据同步逻辑

本文记录 Chrome 插件在 BOSS 直聘（`*.zhipin.com`）页面同步沟通记录时的调用流程、接口与请求参数。

## 触发流程

用户点击插件弹窗的“同步当前聊天记录”按钮后：

1. `popup.js` 向后台发送 `START_JOB_CHAT_EXTRACTION`，携带当前标签页的 `id`、`url` 与 `title`。
2. 后台识别域名为 `zhipin.com`，打开同步结果页，并向内容脚本发送 `JOB_CHAT_PREPARE_SYNC`。
3. 内容脚本调用 `JobChatBossExtractor.prepare()`：读取联系人列表、过滤近三个月记录，并与本地的已保存、待保存、忽略记录比对，计算待同步数量。
4. 用户在同步结果页开始实际同步后，后台发送 `JOB_CHAT_EXTRACT_RECORDS`；内容脚本调用 `JobChatBossExtractor.extract()`，逐条获取招聘者详情并保存阶段性结果。

`prepare()` 和 `extract()` 都会读取联系人列表；但只有 `extract()` 会逐条请求招聘者详情接口。

## 公共请求配置

所有 BOSS 接口均在 BOSS 页面内容脚本上下文中发起：

- `credentials: 'include'`：携带当前 BOSS 登录态 Cookie。
- 公共请求头：
  - `accept: application/json, text/plain, */*`
  - `x-requested-with: XMLHttpRequest, XMLHttpRequest`
  - `traceid: F-<当前时间十六进制><随机字符串>`
  - `zp_token: <token>`：若 Cookie 中存在 `bst`，优先使用；否则使用 `zp_token`。
- 请求成功后要求响应 JSON 的 `code === 0`；否则视为接口异常。

## 接口一：按标签获取联系人列表

用于获取可同步的联系人基础列表。

```http
GET https://www.zhipin.com/wapi/zprelation/friend/geekFilterByLabel?labelId=0
```

| 参数 | 位置 | 值 | 说明 |
| --- | --- | --- | --- |
| `labelId` | Query | `0` | 默认标签，获取联系人列表。 |

响应列表从以下字段之一读取：

- `zpData.friendList`
- `zpData.result`
- `result`

随后从每项按以下优先级提取联系人 ID：`friendId` → `id` → `relationId` → `friend.friendId`。

## 接口二：批量获取联系人详情列表

用于补全联系人、岗位和最后一条消息信息。

```http
POST https://www.zhipin.com/wapi/zprelation/friend/getGeekFriendList.json
Content-Type: application/x-www-form-urlencoded

friendIds=<id1,id2,id3,...>
```

| 参数 | 位置 | 值 | 说明 |
| --- | --- | --- | --- |
| `friendIds` | Form Body | 逗号分隔的联系人 ID | 由接口一返回的联系人 ID 组成；每批最多 150 个。 |

响应列表字段与接口一相同。接口一和接口二的结果按 `friendId` 合并；合并后仅保留最近三个月有更新的记录，更新时间优先级为：`updateTime` → `lastMessageInfo.msgTime` → `lastTS`。

### 回退策略

批量 POST 任一请求失败时，按下列顺序重试：

1. 使用页面 Hook 捕获的该接口原始 `method` 与 `body`。
2. 对相同接口发送空参数 `GET`。
3. 对相同接口发送空参数 `POST`。

页面 Hook 会拦截 BOSS 页面自身对联系人相关接口的 `fetch` 与 `XMLHttpRequest`，并把捕获的 URL、方法和请求体写入 `chrome.storage.local.jobChatBossFriendListCapture`。

## 接口三：获取单个招聘者/岗位详情

仅在实际同步阶段，对每一个待同步联系人调用；用于补充招聘者姓名、公司、职位、岗位名称和薪资等信息。

```http
GET https://www.zhipin.com/wapi/zpchat/geek/getBossData?bossId=<bossId>&bossSource=<bossSource>&securityId=<securityId>
```

| 参数 | 位置 | 来源 | 说明 |
| --- | --- | --- | --- |
| `bossId` | Query | `item.encryptBossId`，缺失时 `item.encryptUid` | 招聘者加密 ID。缺失时不请求该接口。 |
| `bossSource` | Query | `item.sourceType`，缺失时 `0` | 招聘者来源类型。 |
| `securityId` | Query | `item.securityId` | 会话/安全标识。缺失时不请求该接口。 |

该请求失败不会中断整次同步：代码会忽略本条详情错误，并使用联系人列表中的已有字段生成记录。

## 同步与去重规则

- 忽略记录不会进入同步队列。
- 首选去重键：`encryptBossId|jobId`。
- 其次可使用 `securityId`、`encryptFriendId` 或 `friendId`。
- 同步结果会在记录的 `boss` 对象中保存发送所需的稳定字段，包括 `ownerUserId`、`friendId`、`peerKey`、`chatSecurityId`、`uploadSecurityId`、`jobId` 和 `encryptJobId`。
- 已存在记录仅在最后消息 ID（`lastMessageInfo.msgId`）变化，或消息状态变化时才会重新同步。
- 消息状态转换规则：BOSS 返回 `lastMessageInfo.status === '1'` 时，插件记录为 `'0'`；其他情况记录为 `'1'`。
- 实际同步逐条执行，间隔由 `jobChatSyncRateSettings` 或兼容的 `jobChatSyncRateLimit` 控制；默认约为 500 ms。

## 2.0.0 发送前自动补全

批量发送优先使用同步后保存在本地记录中的数字 `friendId` 和 28 字符 `peerKey`。字段完整时不会重复扫描联系人列表，也不会重复调用 `getBossData`。

旧记录缺少字段时，扩展只为本批次中信息不全的目标执行补全：

1. 调用 `geekFilterByLabel?labelId=0`，按 recordKey 中的 peerKey 或已有 friendId 精确定位联系人。
2. 仅把匹配到的 friendId 分批提交给 `getGeekFriendList.json`，每批最多 150 个。
3. 必要时调用一次 `getBossData`，补充权威数字 bossId、加密 bossId 和岗位字段。
4. 将补全后的稳定字段回写总记录，供后续发送直接复用。

如果联系人详情接口失败，扩展会继续尝试使用联系人列表已有字段。单条记录仍无法精确匹配或补齐时，该条发送状态标为“失败”，备注显示“标识不全，需要重新同步记录再发送”，不会阻断同批次其他有效记录。

WebSocket 发送协议、认证数据来源、ACK 和失败处理详见 [zhipin_send_msg.md](zhipin_send_msg.md)。

## 相关源码

- 按钮入口：`popup.js`
- 后台调度：`background.js`
- BOSS 同步实现：`boss-extractor.js`
- 页面请求捕获：`boss-hook.js`
- WebSocket 协议编解码：`boss-message-protocol.js`
