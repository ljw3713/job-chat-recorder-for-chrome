# 猎聘批量发送文本消息

本文记录扩展向当前登录猎聘账号的已有联系人批量发送纯文本消息时使用的数据、
接口、执行流程、持久化规则和失败处理。

## 1. 范围

- 仅向已经存在聊天关系的猎聘联系人发送纯文本消息。
- 同一批次只能包含猎聘记录，不能和 BOSS 记录混合。
- 使用最近访问的 `*.liepin.com` 标签页及其当前登录态。
- 按设置的每分钟发送数串行发送。
- 支持停止批次；停止后不再发送尚未开始的记录。
- 单条目标补全或发送失败不会中断后续目标。
- 发送失败不自动重试，避免响应丢失时重复发送。

## 2. 记录和账号数据

发送依赖记录中的：

```json
{
  "liepin": {
    "imId": "",
    "oppositeImId": "",
    "oppositeUserId": ""
  }
}
```

`oppositeUserId` 优先由
`com.liepin.im.c.contact.get-contact-list` 在正常同步时保存。旧记录缺失该字段时，
发送前通过聊天列表补全并回写 `jobChatRecords`。

当前账号的 `imClientId` 使用 `imId` 隔离并保存：

```json
{
  "jobChatLiepinImClientIds": {
    "<imId>": "<imClientId>"
  }
}
```

切换账号后不会复用其他 `imId` 对应的 `imClientId`。Cookie 和认证信息不写入扩展
存储。

## 3. 获取 `imClientId`

缓存中没有当前 `imId` 的值时请求：

```http
POST https://api-im.liepin.com/api/com.liepin.cbp.im.get-user-info
Content-Type: application/x-www-form-urlencoded
```

请求体：

```text
imUserType=0&imId=<当前 imId>&imApp=1&deviceType=0
```

响应必须满足：

- HTTP 成功；
- `flag === 1`；
- `data.imId` 与当前账号一致；
- `data.imClientId` 非空。

校验成功后将 `imClientId` 写入账号级缓存。

## 4. 补全 `oppositeUserId`

记录缺少 `oppositeUserId` 时请求：

```http
POST https://api-c.liepin.com/api/com.liepin.im.c.chat.chat-list
Content-Type: application/x-www-form-urlencoded
```

请求体：

```text
imUserType=0
imId=<当前 imId>
imApp=1
oppositeImId=<对端 IM ID>
maxMessageId=
pageSize=20
```

读取 `data.list[0].oppositeUserId`，并校验第一条消息的 `oppositeImId` 与目标一致。
成功后立即回写当前总记录。聊天列表为空或字段缺失时，仅当前目标失败。

## 5. 发送文本

接口：

```http
POST https://api-c.liepin.com/api/com.liepin.im.c.chat.send-push
Content-Type: application/x-www-form-urlencoded
```

请求字段：

```text
imUserType=0
imId=<当前 imId>
imApp=1
save=
count=1
imClientId=<当前账号客户端 ID>
oppositeImId=<对端 IM ID>
oppositeUserId=<对端用户 ID>
oppositeImUserType=2
chatType=0
msgTime=<Date.now()>
msgType=txt
payload=<JSON>
```

`payload` 的原始 JSON：

```json
{
  "ext": {
    "extType": 1,
    "extBody": {
      "bizType": "1",
      "bizData": {
        "quote": {}
      },
      "bsData": {}
    }
  },
  "bodies": [
    {
      "msg": "<发送内容>",
      "type": "txt"
    }
  ],
  "push": "1"
}
```

实现把 JSON 字符串直接交给 `URLSearchParams`，只执行一次表单编码。

发送成功要求 `flag === 1` 且 `data.msgId` 非空。成功后更新本地记录的原消息、
更新时间、未读状态，以及：

```json
{
  "liepin": {
    "latestMsgId": "<data.msgId>",
    "latestMsgTime": "<data.msgTime 或请求时间>",
    "oppositeRead": "0",
    "oppositeUserId": "<已确认值>"
  }
}
```

## 6. 请求头和权限

请求沿用猎聘同步接口的网页请求头：

- `Accept: application/json, text/plain, */*`
- `Content-Type: application/x-www-form-urlencoded`
- `X-Client-Type: web`
- `X-Requested-With: XMLHttpRequest`
- `X-Fscp-*` 页面和 trace 信息

所有请求使用 `credentials: include`。扩展清单需要同时允许：

```text
https://api-c.liepin.com/*
https://api-im.liepin.com/*
```

## 7. 批次状态

目标状态统一为“等待”“成功”“失败”。批次还会发出开始、完成、停止和整体错误
事件。成功响应才更新聊天记录；网络错误、异常响应和缺少发送标识均保留原记录。

发送日志只描述步骤和结果，不记录 Cookie、完整请求体或联系人标识。

## 8. 验收要点

1. 新记录以及因消息或岗位发生更新的记录能够保存 `oppositeUserId`，缺失该字段本身
   不会使旧记录进入普通同步队列。
2. 首次发送获取并缓存 `imClientId`，同账号后续批次复用缓存。
3. 缺少 `oppositeUserId` 时能通过 `chat-list` 补全和回写。
4. `payload` 解码一次后与本文 JSON 一致。
5. 单条失败不阻断后续目标，停止后不再发送剩余目标。
6. 成功响应更新本地最近消息字段，失败响应不更新。
7. BOSS 原有发送流程保持不变，混合站点批次被拒绝。
