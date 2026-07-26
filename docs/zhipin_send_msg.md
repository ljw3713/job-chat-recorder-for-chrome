# BOSS 直聘 WebSocket 消息协议

本文根据多组成功 HAR/WebSocket 记录整理，描述认证、`chat` 注册、文本消息、图片消息和服务端回执的实际二进制结构。

仅用于当前登录账号的正常会话调试。不要提交 Cookie、`wt2`、`zp_token`、HTTP `token`、用户 ID 或安全标识。

## 扩展 2.0.0 实现说明

扩展中的批量文本发送运行在任一已登录 BOSS 页面主世界，不要求打开聊天页。认证凭据只在该页面内存中使用，不写入扩展存储，也不会进入进度或请求日志。运行时 `token` 从当前页面的 HTTP 请求或新建 WebSocket 认证帧捕获；它不是 `zp_token`、`bst` 等 Cookie 的直接替代值。任务为单 WebSocket 串行队列；每条消息使用递增 sequence 和 BigInt cmid，仅当收到相同 sequence、cmid 且非零 mid 的 20 字节 ACK 时标记“成功”。ACK 超时、连接中断或无法匹配 ACK 标记为“失败”，不会自动重发。

批次会拒绝猎聘记录。BOSS 记录缺失 `friendId` / `peerKey` 时会先自动补齐；单条记录仍无法补齐、账号不匹配或发送失败时，只把该条标为“失败”并在备注栏记录原因，后续记录继续发送。发送弹窗中的记录状态仅使用“成功、失败、等待”。

发送弹窗默认每分钟发送 10 条，只限制最小值为 1。任务运行时“发送”按钮变为“停止”；停止会关闭当前批次连接，尚未发送的记录保持“等待”。

发送日志栏默认隐藏。仅当结果页 URL 包含 `log=enable` 时显示，例如 `results.html?mode=overview&log=enable`。日志记录补全、HTTP 请求地址和参数、响应、WebSocket 生命周期以及每条发送结果，其中 token、用户 ID 和联系人标识等认证或发送凭据会隐藏。日志栏隐藏时后台仍会记录日志。

扩展选择最近访问的 `*.zhipin.com` 标签页并在页面主世界检查用户信息，因此职位页等非聊天页面也可发送。本版本按单账号使用场景设计，不尝试区分同一浏览器中的多个 BOSS 登录账号。

2.0.0 的发送预检会复用记录中格式有效的 `friendId` 和 `peerKey`。旧记录缺失字段时，先用 label 列表按 peerKey 定位联系人，仅对选中的 friendId 请求 `getGeekFriendList`，再调用一次 `getBossData` 取得权威 bossId 并回写记录；后续发送不再重复扫描全部联系人或请求 `getBossData`。`chatSecurityId` 仅供 HTTP 会话接口使用，不是纯文本 WebSocket 帧的必要字段。

收到相同 sequence、cmid 且 mid 非零的发送 ACK 后，扩展会把总记录的 `lastMessage` 更新为已发送正文，将 `updatedDate` 更新为当前时间，并把 `messageStatus` 设为未读。ACK 超时、连接断开或服务端拒绝时，该条标为“失败”并显示原因，但不更新总记录中的消息。

`pc_device_id` 是聊天注册帧中的当前浏览器设备字段，不是登录凭据。扩展从页面初始化请求、本地运行状态或页面自身发送的 `0x33` 注册帧 `ClientInfo.field_5` 捕获该值；职位页没有建立原生聊天连接时，使用扩展为当前浏览器生成并持久化的稳定 32 位设备标识。它不依赖 toggle 接口响应，也不要求用户重新登录。

## 1. 基础编码

WebSocket 业务帧的外层结构为：

```text
[1 byte frameType][unsigned Varint payloadLength][payload]
```

`payloadLength` 使用 protobuf 风格的无符号 LEB128 Varint。

已确认的帧类型：

| 类型 | 方向 | 含义 |
| --- | --- | --- |
| `0x10` | 客户端 → 服务端 | 认证请求 |
| `0x20` | 服务端 → 客户端 | 认证结果 |
| `0x33` | 客户端 → 服务端 | `chat` 请求 |
| `0x32` | 服务端 → 客户端 | `chat` 推送 |
| `0x40` | 双向 | 请求确认或推送 ACK |
| `0xc0` | 客户端 → 服务端 | Ping |
| `0xd0` | 服务端 → 客户端 | Pong |

整数编码约定：

- protobuf `varint`：wire type `0`。
- protobuf `fixed64`：wire type `1`，8 字节小端。
- 字符串、bytes、嵌套消息：wire type `2`。
- 帧中的二字节长度、路由长度和序号：大端。
- 发送确认中的 `cmid`、`mid`：8 字节大端，不是 protobuf Varint。

## 2. 获取连接参数

页面建立 WS 前会调用：

```http
POST /wapi/zppassport/set/zpToken
GET  /wapi/zppassport/get/wt
GET  /wapi/zpchat/config/ws
```

关键数据：

| 数据 | 来源 |
| --- | --- |
| `wt2` | `get/wt` 响应的 `zpData.wt2` |
| WS 主机 | `config/ws` 响应的 `zpData.result` |
| `userId` | `getUserInfo.json` 等当前用户接口 |
| HTTP `token` | 页面部分 HTTP 请求中名为 `token` 的请求头 |
| `pc_device_id` | 页面初始化参数 `attrs[pc_device_id]` |
| `public_ip` | `getUserInfo.json` 响应的 `zpData.clientIP` |

注意：HTTP `token`、`zp_token` 和 `wt2` 是三个不同的值。

### 2.1 接收方标识映射

同一个联系人在 HTTP 接口和 WebSocket 中使用四类不同数据，不能因为字段名中都包含 `Id` 或 `securityId` 就合并保存：

| 建议字段 | 已确认来源 | 样本长度 | 用途 |
| --- | --- | ---: | --- |
| `friendId` | `friendId`、`uid`、`data.bossId` | 数字 | WS `Peer.field_1` |
| `peerKey` | `encryptFriendId`、`encryptBossId`、`encryptUid` | 28 | WS `Peer.field_2`、HTTP 查询参数 `bossId` |
| `chatSecurityId` | `getGeekFriendList.json` 的 `item.securityId` | 216 | `getBossData`、`historyMsg`、`geekEnter` |
| `uploadSecurityId` | `getBossData` 的 `zpData.data.securityId` | 124 | `quicklyUpload` 和实际图片上传 |

成功样本中以下四个值完全相等，并且等于消息帧的 `to.field_2`：

```text
labelItem.encryptFriendId
== item.encryptBossId
== item.encryptUid
== getBossData.zpData.data.encryptBossId
```

推荐的数据提取方式：

```js
const friendId =
  detail?.data?.bossId ||
  item.uid ||
  item.friendId ||
  '';

const peerKey =
  detail?.data?.encryptBossId ||
  item.encryptBossId ||
  item.encryptUid ||
  item.encryptFriendId ||
  '';

const chatSecurityId = item.securityId || '';
const uploadSecurityId = detail?.data?.securityId || '';
```

发送前至少校验：

```js
function isPeerKey(value) {
  return typeof value === 'string'
    && value.length === 28
    && /^[A-Za-z0-9_~-]+$/.test(value);
}
```

不要使用 `data.securityId || item.securityId` 合并两种凭据：它会优先选择 124 字符的上传凭据并丢失 216 字符的聊天接口凭据。旧数据应迁移到独立字段；缺少稳定 friendId/peerKey 时重新请求联系人列表和 `getBossData` 补齐，已有格式有效字段的纯文本发送可直接复用。

握手示例：

```text
wss://<ws-host>/chatws

Cookie: <当前 Cookie>
Origin: https://www.zhipin.com
Sec-WebSocket-Protocol: <最新 wt2>
User-Agent: <与页面一致>
```

## 3. 认证帧 `0x10`

### 3.1 结论

认证 payload 整体不是 protobuf，而是自定义二进制结构：

```text
uint16BE  magicLength       // 6
bytes     magic             // ASCII "MQIsdp"
bytes[4]  fixedHeader       // 03 c2 00 19

uint16BE  connectionIdLength
bytes     connectionId      // "ws-" + 16 位大写十六进制，共 19 字节

uint16BE  clientTokenLength
bytes     clientToken       // HTTP token + "|0"

uint16BE  wt2Length
bytes     wt2               // get/wt 返回的最新 wt2
```

成功抓包中的长度关系：

```text
magic         = 6 bytes
connectionId  = 19 bytes
clientToken   = 18 bytes
wt2           = 89 bytes
payload       = 144 bytes

frame:
10 90 01 <144-byte payload>
```

`90 01` 是数值 144 的 Varint。

### 3.2 构造示例

```js
function u16be(value) {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(value);
  return out;
}

function buildAuthPayload({ connectionId, httpToken, wt2 }) {
  const magic = Buffer.from('MQIsdp');
  const clientToken = Buffer.from(`${httpToken}|0`);
  const connection = Buffer.from(connectionId);
  const wt = Buffer.from(wt2);

  return Buffer.concat([
    u16be(magic.length),
    magic,
    Buffer.from([0x03, 0xc2, 0x00, 0x19]),
    u16be(connection.length),
    connection,
    u16be(clientToken.length),
    clientToken,
    u16be(wt.length),
    wt,
  ]);
}
```

`connectionId` 每次新连接都会变化，成功记录的格式均为：

```text
ws-<16 位大写十六进制>
```

不要复用 HAR 中的旧 `connectionId`、HTTP `token` 或 `wt2`。

### 3.3 认证成功判定

成功响应为：

```text
20 02 00 00
```

解释：

```text
20       认证响应类型
02       payload 长度
00 00    成功状态
```

只有收到该响应后才发送注册帧。

## 4. `chat` 路由头

客户端 `0x33` 和服务端 `0x32` 的 payload 都以路由头开始：

```text
[uint16BE routeLength]["chat"][uint16BE sequence]
```

例如 sequence 为 `2`：

```text
00 04 63 68 61 74 00 02
      c  h  a  t
```

后面紧跟 protobuf 消息体。

服务端推送中的 `sequence` 必须原样放入 ACK：

```text
40 02 <sequence byte 1> <sequence byte 2>
```

## 5. `chat` 注册帧

成功注册帧结构为：

```text
[0x33][Varint payloadLength]
[chat route，sequence=1]
[RegisterRoot protobuf]
```

抓包中的完整 protobuf 结构如下。字段名是根据取值推断的，字段编号和 wire type 已确认。

```protobuf
message RegisterRoot {
  uint64 operation = 1;        // wire 0，固定为 2
  Register register = 4;       // wire 2
}

message Register {
  uint64 type = 1;             // wire 0，固定为 1
  uint64 user_id = 2;          // wire 0，当前登录用户 ID
  ClientInfo client = 3;       // wire 2
  uint64 flag = 5;             // wire 0，抓包值为 0
}

message ClientInfo {
  string version = 1;          // wire 2，抓包值 "4.92"
  bytes field_2 = 2;           // wire 2，空
  bytes field_3 = 3;           // wire 2，空
  bytes field_4 = 4;           // wire 2，空
  string pc_device_id = 5;     // wire 2
  string public_ip = 6;        // wire 2
  uint64 field_7 = 7;          // wire 0，示例值 9019
  string platform = 8;         // wire 2，"web"
  string field_9 = 9;          // wire 2，"-1"
  bytes field_10 = 10;         // wire 2，空
  bytes field_11 = 11;         // wire 2，空
  fixed64 field_12 = 12;       // wire 1，0
  fixed64 field_13 = 13;       // wire 1，0
}
```

对应编码层级：

```text
RegisterRoot
├─ field 1, wire 0 = 2
└─ field 4, wire 2
   ├─ field 1, wire 0 = 1
   ├─ field 2, wire 0 = userId
   ├─ field 3, wire 2 = ClientInfo
   └─ field 5, wire 0 = 0
```

其中：

- `pc_device_id` 与页面初始化时 `/wapi/zpCommon/toggle/all` 请求中的 `attrs[pc_device_id]` 完全一致。
- `public_ip` 与 `getUserInfo.json` 响应中的 `zpData.clientIP` 完全一致。
- 三组成功样本的 `field_7` 均为 `9019`，同时使用 `version="4.92"`。现有样本来自同一账号、浏览器和日期，因此尚不能证明 `9019` 是跨版本、跨账号的全局常量。

建议将 `field_7` 作为与客户端版本绑定、可配置的 `clientCode` 保存，而不是散落硬编码：

```js
const registerContext = {
  version: '4.92',
  pcDeviceId,
  publicIp: userInfo.clientIP,
  clientCode: 9019,
  platform: 'web',
  platformVersion: '-1',
};
```

只有收到注册成功响应后才能继续；如果使用 `9019` 后没有收到 `40 02 00 01`，应立即终止连接并重新取得当前页面的注册参数。

### 5.1 注册成功判定

注册请求的 sequence 为 `00 01`，成功响应为：

```text
40 02 00 01
```

之后服务端通常发送 `/message/pull`：

```protobuf
message ServerRoot {
  uint64 operation = 1;        // 4
  RpcPush push = 6;
}

message RpcPush {
  uint64 id = 1;
  string path = 2;             // "/message/pull"
  repeated KeyValue args = 3;
}
```

客户端需要用服务端推送的二字节 sequence 回复 `0x40` ACK。

### 5.2 初始化目标会话

“打开并初始化目标会话”不是单一页面操作。完整成功 HAR 中，在发送实际聊天消息之前依次出现：

```text
1. GET  /wapi/zpchat/geek/getBossData
2. GET  /wapi/zpchat/geek/historyMsg
3. WS   operation=6 的目标会话状态帧
4. WS   RPC /message/suggest
5. POST /wapi/zpchat/geek/geekEnter
6. 等待并处理上述 WS 请求的 ACK 和响应
```

两个查询使用相同的接收方参数：

```text
bossId     = peerKey
securityId = chatSecurityId
```

`geekEnter` 请求体为：

```text
jobSource=0
k810=0
securityId=<chatSecurityId>
```

成功样本中的 `operation=6` 帧包含：

```text
friendId
flag = 0
timestamp
field_5 = 0
```

该帧的业务名称尚未确认，因此实现中可暂命名为 `ConversationState`，但字段编号、wire type 和抓包值必须按成功样本编码。

`/message/suggest` 的参数为：

```text
action=query
from_id=<当前 userId>
to_id=<friendId>
friend_source=<friendSource>
type=1
chat_type=1
msg_id=<当前毫秒时间戳>
resident=
scene=
```

推荐实现为串行初始化函数：

```js
async function initializeConversation(context) {
  const detail = await getBossData({
    bossId: context.peerKey,
    bossSource: context.friendSource,
    securityId: context.chatSecurityId,
  });

  await historyMsg({
    bossId: context.peerKey,
    securityId: context.chatSecurityId,
    maxMsgId: 0,
    count: 20,
    page: 1,
    src: context.friendSource,
  });

  await sendConversationStateFrame({
    friendId: context.friendId,
    timestamp: Date.now(),
  });

  await sendMessageSuggestRpc({
    action: 'query',
    from_id: context.userId,
    to_id: context.friendId,
    friend_source: context.friendSource,
    type: 1,
    chat_type: 1,
    msg_id: Date.now(),
    resident: '',
    scene: '',
  });

  await geekEnter({
    jobSource: 0,
    k810: 0,
    securityId: context.chatSecurityId,
  });

  return {
    ...context,
    peerKey: detail.data.encryptBossId || context.peerKey,
    uploadSecurityId: detail.data.securityId,
  };
}
```

HAR 可以证明网页成功流程执行了以上步骤，但不能单独证明每一步都是服务端接受消息的硬性要求。在完成逐项消融验证前，应完整、串行复现，并在发送 `SendRoot` 前等待 WS ACK 和 `/message/suggest` 响应。

## 6. 文本消息帧

文本消息为：

```text
[0x33][Varint payloadLength]
[chat route，成功样本使用 sequence=2]
[SendRoot protobuf]
```

已确认的 protobuf 结构：

```protobuf
message SendRoot {
  uint64 operation = 1;        // wire 0，固定为 1
  ChatMessage message = 3;     // wire 2
}

message Peer {
  uint64 uid = 1;              // wire 0
  string peer_key = 2;         // wire 2，仅接收方存在
  uint64 flag = 7;             // wire 0，0
}

message ChatMessage {
  Peer from = 1;               // wire 2
  Peer to = 2;                 // wire 2
  uint64 type = 3;             // wire 0，抓包值为 1
  uint64 cmid = 4;             // wire 0
  uint64 timestamp = 5;        // wire 0，Unix 毫秒
  Content content = 6;         // wire 2
  uint64 repeated_cmid = 11;   // wire 0，必须等于 field 4
}

message Content {
  uint64 content_type = 1;     // wire 0；文本为 1
  uint64 version = 2;          // wire 0；抓包值为 1
  string text = 3;             // wire 2，UTF-8
}
```

实际层级：

```text
SendRoot
├─ field 1, wire 0 = 1
└─ field 3, wire 2 = ChatMessage
   ├─ field 1, wire 2 = from
   │  ├─ field 1, wire 0 = 当前 userId
   │  └─ field 7, wire 0 = 0
   ├─ field 2, wire 2 = to
   │  ├─ field 1, wire 0 = friendId
   │  ├─ field 2, wire 2 = 对方的 28 字符 peer_key
   │  └─ field 7, wire 0 = 0
   ├─ field 3, wire 0 = 1
   ├─ field 4, wire 0 = cmid
   ├─ field 5, wire 0 = timestamp
   ├─ field 6, wire 2 = Content
   │  ├─ field 1, wire 0 = 1
   │  ├─ field 2, wire 0 = 1
   │  └─ field 3, wire 2 = UTF-8 正文
   └─ field 11, wire 0 = cmid
```

`to.field_2` 与图片上传接口使用的长 `securityId` 不是同一个值，不能互换。

## 7. 图片消息差异

图片消息沿用相同的 `SendRoot` 和 `ChatMessage`，只替换 `Content`：

```protobuf
message Content {
  uint64 content_type = 1;     // 图片为 3
  uint64 version = 2;          // 1
  ImageContent image = 5;      // wire 2
}

message ImageContent {
  ImageInfo thumbnail = 2;     // wire 2
  ImageInfo original = 3;      // wire 2
}

message ImageInfo {
  string url = 1;              // wire 2，带 auth_key 的完整 URL
  uint64 width = 2;            // wire 0
  uint64 height = 3;           // wire 0
}
```

图片发送前依次调用：

```http
POST /wapi/zpupload/quicklyUpload
POST /wapi/zpupload/image/uploadSingle   # 秒传未命中时
```

WS 帧使用上传响应中的完整 `url` 和 `tinyUrl`，而不是相对路径。

## 8. 消息发送成功判定

### 8.1 立即确认

成功发送文本或图片后，服务端返回 20 字节 `0x40` 帧：

```text
40 12
<2-byte request sequence>
<8-byte cmid, big-endian>
<8-byte server mid, big-endian>
```

这里的两个 ID 不是 protobuf Varint。

判断成功至少应满足：

```text
frameType == 0x40
payloadLength == 18
ack.cmid == sent.cmid
ack.mid != 0
```

### 8.2 送达状态推送

服务端随后可能发送：

```text
[0x32][length][chat route + push sequence][DeliveryRoot protobuf]
```

```protobuf
message DeliveryRoot {
  uint64 operation = 1;        // 5
  Delivery delivery = 7;
  uint64 status = 10;          // 成功样本为 1
}

message Delivery {
  uint64 cmid = 1;
  uint64 mid = 2;
}
```

客户端必须对该推送的 sequence 回复：

```text
40 02 <push sequence>
```

## 9. protobuf 编码辅助函数

```js
function encodeVarint(input) {
  let value = BigInt(input);
  const output = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value) byte |= 0x80;
    output.push(byte);
  } while (value);
  return Buffer.from(output);
}

function key(fieldNumber, wireType) {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function varintField(fieldNumber, value) {
  return Buffer.concat([key(fieldNumber, 0), encodeVarint(value)]);
}

function bytesField(fieldNumber, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([
    key(fieldNumber, 2),
    encodeVarint(data.length),
    data,
  ]);
}

function fixed64Field(fieldNumber, value) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(BigInt(value));
  return Buffer.concat([key(fieldNumber, 1), data]);
}

function wrapFrame(frameType, payload) {
  return Buffer.concat([
    Buffer.from([frameType]),
    encodeVarint(payload.length),
    payload,
  ]);
}
```

修改正文、URL、ID 或时间戳后，必须从内向外重新编码所有 wire type `2` 字段长度，最后重新计算外层 payload Varint。

## 10. 已确认与尚未确认

已经由成功抓包确认：

- 认证 payload 的字节布局。
- `token|0` 和 `wt2` 在认证帧中的位置。
- 认证与注册成功响应。
- `pc_device_id` 来自 `attrs[pc_device_id]`，`public_ip` 来自 `getUserInfo.json.zpData.clientIP`。
- 接收方 `peerKey` 是 28 字符的加密用户标识，不是两类 `securityId`。
- 216 字符 `chatSecurityId` 与 124 字符 `uploadSecurityId` 的来源和用途。
- 注册、文本、图片和送达回执的 protobuf field number/wire type。
- `cmid`、时间戳、正文及图片 URL 的嵌套位置。
- 即时 ACK 中 `cmid`/`mid` 的 8 字节大端格式。

仍不能只靠 HAR 确定：

- HTTP `token` 的完整生成算法。
- 注册 `field_7=9019` 是否在其他账号、浏览器或客户端版本中保持不变。
- `cmid` 的官方生成算法；只能确认它是 wire type `0` 的唯一客户端消息 ID。
- 目标会话初始化步骤中每个请求是否都不可省略。
- 服务端所有非零错误码的含义。

这些动态值应取自当前页面运行状态或官方页面生成结果，不应从旧 HAR 长期复用。

## 11. 最小正确时序

```text
刷新 Cookie/zp_token/token/wt2
→ 建立 wss://<host>/chatws
→ 发送 0x10 认证帧
→ 等待 20 02 00 00
→ 发送 0x33 chat 注册帧（operation=2）
→ 等待 40 02 00 01
→ ACK 首次 /message/pull 推送
→ 串行调用 getBossData(peerKey, chatSecurityId)
→ 串行调用 historyMsg(peerKey, chatSecurityId)
→ 发送 operation=6 目标会话状态帧并等待 ACK
→ 发送 /message/suggest 并等待 ACK/响应
→ 调用 geekEnter(chatSecurityId)
→ 构造 0x33 SendRoot（operation=1）
→ 等待包含相同 cmid 和非零 mid 的 20 字节 ACK
→ ACK 后续送达状态推送
```
