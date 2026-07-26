# BOSS 直聘总览查询与批量发送消息修改方案

## 1. 目标与范围

本方案面向 `results.html?mode=overview`，实现以下功能：

1. 在操作栏最右侧增加查询输入框，查询公司、岗位、招聘者和原消息；停止输入 1 秒后自动执行。
2. 消息状态使用“全部、未读、已读”下拉筛选，默认全部。
3. 在“导入 CSV”右侧增加“发送信息”按钮和批量发送弹窗。
4. 检查 BOSS 直聘标签页及登录态，通过当前登录会话向选中的联系人发送文本消息。
5. 按每分钟发送数顺序限速，降低高频发送触发风控的概率。

本期仅支持：

- BOSS 直聘已有聊天联系人。
- 纯文本消息。
- 用户主动勾选目标后发送。
- 单 WebSocket 连接、逐条发送。

本期不支持：

- 猎聘消息发送。
- 图片、文件和语音。
- 自动创建新联系人会话。
- 仅靠公司名或招聘者姓名模糊匹配发送目标。
- 对结果不明确的消息自动重试。

## 2. 已验证的协议结论

根据 `docs/zhipin_send_msg.md` 和 Codex 任务
`019f9250-49ba-7ab2-b0cf-94d41e28b502` 中的真实发送结果，普通文本消息已经通过以下最小时序得到服务端 20 字节成功 ACK：

```text
刷新 wt2
→ 建立 WebSocket
→ 发送 0x10 认证帧
→ 发送 chat 注册帧
→ ACK 初始服务端推送
→ 发送文本 SendRoot
→ 收到包含相同 cmid 和非零 mid 的 20 字节 ACK
```

实测成功流程没有发送：

- `operation=6` 会话状态帧。
- `/message/suggest`。
- `geekEnter`。
- `historyMsg`。

此前发送失败的直接原因是修改正文后没有重新计算最外层 Varint payload 长度，而不是缺少上述会话初始化步骤。因此，`operation=6` 和 `/message/suggest` 不进入首版关键路径。

`getBossData`、`historyMsg` 和 `geekEnter` 仍可作为目标凭据刷新和会话校验步骤，但不作为 WebSocket 文本协议的硬性前置条件。

## 3. 总览查询

### 3.1 页面位置

在 `.toolbar-row.actions` 最右侧增加查询框，仅在 `mode=overview` 时显示。

建议占位文字：

```text
查询公司、岗位、招聘者、原消息
```

### 3.2 查询字段

```text
companyName
jobName
recruiterName
recruiterTitle
lastMessage
```

### 3.3 查询规则

- 监听 `input` 事件。
- 每次输入取消上一次定时器。
- 停止输入 1 秒后执行查询。
- 去除首尾空白，不区分英文大小写。
- 多个空格分隔的关键词采用 AND 匹配。
- 查询与来源、公司、消息状态、日期、排序组合生效。
- 清空查询框后恢复其他筛选条件下的全部结果。
- 查询或其他筛选条件变化后清空当前选择，防止隐藏记录被误发送。

## 4. 消息状态筛选

状态下拉保留三项：

```text
全部 = ""
未读 = "0"
已读 = "1"
```

默认选择“全部”。

无法识别状态的记录统一按“未读”处理，确保表格展示和筛选结果一致。

## 5. “发送信息”按钮

在 `importCsvBtn` 右侧增加 `sendMessageBtn`。

行为：

- 仅 overview 模式显示。
- 没有选中记录时禁用。
- 有选择时显示数量，例如“发送信息（5）”。
- 点击后打开发送弹窗。
- 实际发送前如果包含猎聘记录，则阻止整个批次并提示；不静默跳过。

## 6. 发送弹窗

### 6.1 布局

弹窗顶部：

- 多行消息输入框。
- 建议限制为 1–1000 个字符。
- 显示当前字符数。

第二行：

- 左侧为“发送”按钮。
- 右侧为“每分钟发送数”数字输入框。
- 默认 2 条/分钟。
- 建议限制为 1–10 条/分钟。

下方目标列表字段：

| 公司 | 岗位 | 招聘者 | 更新时间 | 发送状态 |
| --- | --- | --- | --- | --- |

列表展示全部选中记录，可视区域最多十行，超过后纵向滚动，不截断数据。

弹窗标题显示：

```text
已选 N 条 · 可发送 M 条 · 不可发送 K 条
```

### 6.2 目标状态

```text
等待发送
正在初始化
发送中
已发送
失败
结果未知
不可发送：非 BOSS 记录
不可发送：缺少联系人标识
不可发送：账号不匹配
```

### 6.3 发送前校验

以下情况禁止启动：

- 消息正文为空。
- 没有选中记录。
- 存在猎聘记录。
- 没有打开 zhipin 标签页。
- BOSS 账号未登录。
- 多个标签页登录了不同 BOSS 账号。
- 无法取得当前页面 HTTP token。
- 目标无法在当前账号的联系人列表中精确匹配。
- 已经有发送批次正在运行。

发送期间禁用消息框、速率输入和再次发送按钮。关闭弹窗时提示发送任务仍在运行，避免用户误以为关闭弹窗等于取消。

## 7. BOSS 数据模型

### 7.1 拆分联系人标识

当前 `boss.securityId` 混合了两类不同凭据，必须拆分：

```js
boss: {
  ownerUserId,
  friendId,
  peerKey,
  chatSecurityId,
  uploadSecurityId,
  friendSource,
  bossId,
  encryptBossId,
  jobId,
  encryptJobId,
  lastMsgId,
  lastMessageInfo
}
```

字段来源：

```text
ownerUserId
  = getUserInfo.json.zpData.userId

friendId
  = detail.data.bossId
  || item.uid
  || item.friendId

peerKey
  = detail.data.encryptBossId
  || item.encryptBossId
  || item.encryptUid
  || item.encryptFriendId

chatSecurityId
  = item.securityId

uploadSecurityId
  = detail.data.securityId

friendSource
  = item.friendSource
```

发送前至少校验：

- `friendId` 是有效数字。
- `peerKey` 是 28 字符，且只包含字母、数字、下划线和连字符。
- `chatSecurityId` 非空。
- `ownerUserId` 与当前登录账号一致。

### 7.2 旧数据

- 旧 `boss.securityId` 不再直接用于发信。
- 可以按长度辅助迁移，但迁移结果不能作为最终发送凭据。
- 发送前重新获取联系人列表和 `getBossData`。
- 成功精确匹配后更新新的拆分字段。
- 无法匹配的旧记录标记为不可发送。
- 禁止用公司名、招聘者姓名进行模糊匹配。

### 7.3 CSV 数据

- CSV 与已有记录通过相同 `recordKey` 合并时，保留已有 `boss` 对象。
- 只有 CSV 数据、没有 BOSS 会话字段的记录默认不可发送。
- 仅允许通过有效 `recordKey`、`peerKey`、`jobId` 精确匹配。

## 8. 标签页、账号和登录态

后台查询：

```js
chrome.tabs.query({
  url: ['https://*.zhipin.com/*']
})
```

选择规则：

1. 没有 zhipin 标签页：提示用户打开并登录。
2. 只有一个登录账号：优先选择最近活动的聊天标签页。
3. 多个标签页属于同一账号：选择当前活动标签页。
4. 多个标签页属于不同账号：终止并提示用户只保留要发送的账号。

在 zhipin 页面请求：

```http
GET /wapi/zpuser/wap/getUserInfo.json
```

登录成功必须满足：

```text
HTTP 200
code === 0
zpData.userId 有效
```

`zpData.userId` 用作：

```text
Register.user_id
ChatMessage.from.uid
boss.ownerUserId
```

## 9. HTTP token 和连接参数

### 9.1 HTTP token

认证帧中的 16 字符 client token 与页面 HTTP 请求的 `token` 请求头一致，但不直接等于任意完整 Cookie 值。

扩展 `boss-hook.js`：

- 拦截 `fetch` 请求 headers。
- 拦截 `XMLHttpRequest.prototype.setRequestHeader`。
- 捕获名为 `token` 的请求头。
- 也可从页面发出的 `0x10` 认证帧解析 `clientToken`。
- 去除认证值尾部的 `|0`。
- token 只保存在当前页面内存中。
- 不写入 `chrome.storage.local`，不打印日志。

如果登录成功但未取得 token，提示用户打开或刷新 BOSS 聊天页面后重试。

### 9.2 其他参数

```text
wt2
  = GET /wapi/zppassport/get/wt

WS 主机
  = GET /wapi/zpchat/config/ws

pc_device_id
  = /wapi/zpCommon/toggle/all 的 attrs.pc_device_id

public_ip
  = getUserInfo.json.zpData.clientIP

version
  = "4.92"

clientCode
  = 9019

platform
  = "web"

platformVersion
  = "-1"
```

`version` 和 `clientCode` 集中配置。若注册失败，立即终止并提示 BOSS 客户端协议参数可能已变化。

## 10. WebSocket 架构

### 10.1 运行位置

WebSocket 在 zhipin 页面主世界中创建：

```js
new WebSocket(`wss://${host}/chatws`, wt2)
```

这样可以自动使用页面 Cookie、Origin 和 User-Agent，并避免 MV3 后台休眠影响长批次。

后台负责：

- 查找标签页。
- 校验登录账号。
- 从 storage 重新读取并验证目标。
- 启动任务。
- 转发非敏感进度。

内容脚本负责：

- 与后台通信。
- 校验登录态。
- 与页面主世界 Hook 通信。
- 转发任务状态。

页面主世界负责：

- 获取运行时 token 和页面参数。
- 建立 WebSocket。
- 编码和发送消息。
- 处理 ACK、推送和心跳。

### 10.2 浏览器端二进制实现

新建 `boss-message-protocol.js`，使用：

```text
Uint8Array
TextEncoder
DataView
BigInt
crypto.getRandomValues
```

实现：

- unsigned Varint 编解码。
- protobuf wire type 0、1、2。
- uint16 大端。
- uint64 大端 ACK 读取。
- fixed64 小端。
- 认证帧。
- chat 注册帧。
- 文本 SendRoot。
- chat 路由头。
- 推送 ACK。
- 送达回执解析。
- 外层帧长度校验。

## 11. WebSocket 状态机

### 11.1 认证

生成：

```text
connectionId = "ws-" + 16 位大写十六进制
clientToken = HTTP token + "|0"
```

发送 `0x10` 认证帧，只有收到：

```text
20 02 00 00
```

才进入注册阶段。

### 11.2 注册

注册 sequence 为 `1`。

注册参数：

```text
userId
version = 4.92
pcDeviceId
publicIp
clientCode = 9019
platform = web
platformVersion = -1
```

只有收到：

```text
40 02 00 01
```

才进入 ready 状态。

### 11.3 初始推送

收到 `0x32 chat` 推送后提取推送 sequence，并回复：

```text
40 02 <push sequence>
```

至少正确处理一次初始推送后才发送业务消息。

## 12. 目标准备

批次开始时重新获取 BOSS 联系人列表，建立当前账号下的精确目标映射。

每个目标发送前：

1. 获取最新 `friendId`、`peerKey`、`chatSecurityId` 和 `friendSource`。
2. 调用 `getBossData` 刷新联系人详情。
3. 可调用 `historyMsg` 验证会话并获取最新 `cmid`。
4. 可调用 `geekEnter` 模拟网页进入会话。

首版不发送 `operation=6` 和 `/message/suggest`。

## 13. sequence 和 cmid

### 13.1 sequence

```text
注册请求 = 1
第一条业务请求 = 2
后续业务请求逐条递增
```

本期不考虑到达 65535。

维护：

```js
pendingBySequence
```

用于将服务端确认匹配到对应请求。

### 13.2 cmid

建议：

1. 从目标 `historyMsg` 取得最新 `cmid`。
2. 取本批次所有目标最新值的最大值。
3. 第一条消息使用 `maxCmid + 1`。
4. 后续每条递增 1。

要求：

- 全程使用 `BigInt`。
- field 4 和 field 11 完全相同。
- 批次内不得重复。
- 不使用服务端 `mid` 作为 `cmid`。

## 14. 文本消息编码

```text
SendRoot.operation = 1

ChatMessage.from.uid = 当前 userId
ChatMessage.from.flag = 0

ChatMessage.to.uid = friendId
ChatMessage.to.peer_key = peerKey
ChatMessage.to.flag = 0

ChatMessage.type = 1
ChatMessage.cmid = 新 cmid
ChatMessage.timestamp = 当前 Unix 毫秒

Content.content_type = 1
Content.version = 1
Content.text = UTF-8 正文

ChatMessage.repeated_cmid = 相同 cmid
```

编码必须从内向外进行：

1. 编码正文。
2. 编码 Content。
3. 编码 ChatMessage。
4. 编码 SendRoot。
5. 拼接 chat 路由和 sequence。
6. 计算 payload 实际长度。
7. 编码外层 Varint。
8. 校验声明长度与实际长度一致。
9. 调用 `WebSocket.send()`。

禁止复用旧消息帧的任何长度字段。

## 15. 限速队列

“每分钟发送数”按速率实现，不并发发送。

```text
最小发送间隔 = 60000 / 每分钟发送数
```

规则：

- 单 WebSocket。
- 每次只处理一个目标。
- 当前目标收到明确 ACK 后才进入下一条等待。
- 下一条开始时间不得早于上一次发送时间加最小间隔。
- 每分钟最多发送配置数量。

## 16. 成功、失败和重试

### 16.1 成功

同时满足：

```text
frameType == 0x40
payloadLength == 18
ack.sequence == 当前请求 sequence
ack.cmid == 当前消息 cmid
ack.mid != 0
```

后续送达推送不是首个成功判定的硬条件，但收到后必须回复 ACK。

### 16.2 单条失败后继续

- 目标实时数据不存在。
- `friendId` 或 `peerKey` 校验失败。
- 单条目标 HTTP 初始化明确失败。
- 服务端明确拒绝该条消息。

### 16.3 结果未知且不重试

- 消息发送后 ACK 超时。
- 消息发送后 WebSocket 断开。
- ACK 无法解析或无法匹配。
- 页面在 ACK 前刷新。

以上情况不得自动重发，防止重复消息。

### 16.4 停止整个批次

- zhipin 标签页关闭。
- 登录失效或 userId 变化。
- WebSocket 认证或注册失败。
- 心跳超时。
- 本地协议长度校验失败。
- 页面刷新导致任务上下文丢失。

## 17. 心跳

长批次期间：

- 定时发送 `c0 00`。
- 收到 `d0 00` 更新最后存活时间。
- 收到任何合法服务端帧也更新存活时间。
- 心跳超时后关闭连接并停止批次。
- 对所有 `0x32 chat` 推送及时回复 ACK。
- 批次结束后主动关闭 WebSocket。

心跳间隔集中配置，后续根据页面实际行为调整。

## 18. 进度和敏感数据保护

弹窗显示：

```text
已完成 X / 总数 Y
成功 A
失败 B
结果未知 C
下一条预计发送时间
```

单条任务状态只包含：

```text
recordKey
status
errorCode
errorMessage
sentAt
```

禁止保存或输出：

```text
Cookie
HTTP token
zp_token
wt2
完整 friendId
peerKey
chatSecurityId
uploadSecurityId
完整二进制帧
```

## 19. 预计修改文件

- `results.html`
  - 查询框、发送按钮、发送弹窗和样式。
- `results.js`
  - debounce 查询、筛选、目标预检、弹窗和进度。
- `results-database.js`
  - 保存每分钟发送数，不保存凭据。
- `boss-extractor.js`
  - 拆分联系人标识，保存 `ownerUserId`。
- `shared-records.js`
  - 新字段规范化和旧字段兼容。
- `content.js`
  - 登录检查、任务接收、页面主世界桥接。
- `boss-hook.js`
  - 捕获 token、页面参数和管理页面 WebSocket。
- `boss-message-protocol.js`
  - 新增浏览器端协议编解码模块。
- `background.js`
  - 标签页、账号、目标和任务调度。
- `manifest.json`
  - 注册新的页面主世界资源；原则上不增加 `cookies` 权限。
- `docs/zhipin_send_msg.md`
  - 补充最小成功流程、批量 sequence、cmid、心跳和失败策略。

## 20. 测试计划

### 20.1 逻辑测试

- 查询输入停止 1 秒后执行。
- 五类字段查询和多关键词匹配。
- 全部、未读、已读筛选。
- Varint 边界值。
- 中文、emoji 和长文本。
- protobuf 嵌套长度。
- uint64 BigInt。
- ACK 大端 `cmid/mid`。
- sequence 递增。
- 每分钟发送间隔。

### 20.2 数据测试

- 新 BOSS 记录字段完整。
- 旧记录迁移。
- CSV 合并保留已有 `boss` 数据。
- 独立 CSV 记录不可发送。
- 猎聘记录不可发送。
- 多账号阻止发送。
- `ownerUserId` 不一致时阻止发送。

### 20.3 集成测试

- 无 zhipin 标签页。
- 未登录。
- 已登录但没有 token。
- 认证和注册成功。
- 单条文本发送成功。
- 多条消息按速率顺序发送。
- ACK 超时。
- WebSocket 中途关闭。
- BOSS 标签页刷新或关闭。
- 服务端推送 ACK。
- 十条与十一条目标列表滚动。
- 执行 `npm run package` 验证扩展打包。

## 21. 实施顺序

1. 拆分和迁移 BOSS 联系人字段。
2. 新增协议编解码模块和单元测试。
3. 增强页面 Hook，获取 token 和运行参数。
4. 完成单条文本消息发送并验证 20 字节 ACK。
5. 实现后台标签页、登录态和账号校验。
6. 增加 overview 查询框和状态筛选修正。
7. 增加发送按钮、弹窗和目标预检。
8. 增加批量队列、sequence、cmid、限速和进度。
9. 验证异常流程和敏感数据保护。
10. 打包扩展并进行小批量真实账号验收。

## 22. 验收标准

在存在已登录 BOSS 直聘标签页的前提下：

1. 用户可以查询并筛选 overview 记录。
2. 用户可以勾选有效 BOSS 记录并打开发送弹窗。
3. 弹窗正确展示全部目标，十条以上可以滚动。
4. 系统能够验证当前账号、实时刷新目标凭据并建立 WebSocket。
5. 消息严格按每分钟发送数顺序发送。
6. 每条消息只有在收到相同 `cmid` 且 `mid != 0` 的 ACK 后才显示成功。
7. 失败和结果未知状态准确展示。
8. 结果未知的消息不自动重试。
9. 猎聘、账号不匹配及无法精确匹配的记录不会被发送。
10. 日志和本地存储中不出现任何认证凭据或完整联系人安全标识。
