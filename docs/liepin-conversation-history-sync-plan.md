# 猎聘完整会话同步方案

## 1. 目标与边界

在不改变猎聘现有 `latestMsgId`、消息状态、岗位信息和“是否需要同步”判断逻辑的
前提下，为需要同步的记录补齐当前联系人全部文本会话。

方案复用 BOSS 已落地的通用顶层 `conversation` 结构、后台合并逻辑和结果页左右
气泡展示，不新增猎聘专用会话展示模型。

本次只保存附件中明确要求的消息信息：

- `payload.bodies[].msg`
- `userId`
- `oppositeUserId`
- `msgTime`
- `msgId`

`direction` 只在响应解析时用于判断发送方，不作为业务字段单独保存。接口返回的
其他已读状态、消息扩展、用户类型和 IM ID 继续由现有猎聘记录字段负责，不复制到
`conversation.messages`。

## 2. 接口与请求参数

接口：

```text
POST https://api-c.liepin.com/api/com.liepin.im.c.chat.chat-list
Content-Type: application/x-www-form-urlencoded
```

首页请求：

```text
imUserType=0
imId={当前登录账号的 liepin.imId}
imApp=1
oppositeImId={当前联系人的 liepin.oppositeImId}
maxMessageId=
pageSize=20
```

应继续复用 `postLiepinApi()`，由现有公共请求层生成猎聘请求头、携带 Cookie、记录
请求日志并处理 HTTP/业务错误。不得保存附件中的 Cookie、令牌或跟踪请求头。

必需上下文：

| 参数 | 来源 |
|---|---|
| `imId` | `record.liepin.imId`，缺失时使用当前登录账号 `getLiepinImId()` |
| `oppositeImId` | `record.liepin.oppositeImId` |
| `maxMessageId` | 首页为空；后续页使用上一页全部原始消息中最旧的 `msgId` |
| `pageSize` | 固定请求值 `20` |

缺少 `imId` 或 `oppositeImId` 时，不发起请求，当前记录按会话同步失败处理。

## 3. 响应解析

会话列表位于：

```text
response.data.list
```

其中 `payload` 是 JSON 字符串，正文实际位于：

```text
JSON.parse(item.payload).bodies[].msg
```

解析规则：

1. `payload` 必须安全地执行 `JSON.parse`；单条解析失败时忽略该条正文，但原始
   `msgId` 仍参与分页游标计算。
2. 只读取 `bodies` 中 `msg` 为非空字符串的内容。
3. 同一个 `msgId` 中存在多个有效 `msg` 时，以换行连接为一条通用消息，避免同一
   `msgId` 生成多条记录后无法稳定去重。
4. `msgId`、`userId`、`oppositeUserId` 一律按字符串保存，避免大整数精度丢失。
5. `msgTime` 转换为有限的毫秒时间戳。
6. 没有有效正文的消息不进入 `conversation.messages`，但必须继续参与分页。
7. `revokeFlag=true` 的消息建议不保存正文；其 `msgId` 仍参与分页。实施时应补一个
   撤回消息样本确认平台是否仍返回原文。

## 4. 通用数据映射

沿用现有结构：

```json
{
  "conversation": {
    "version": 1,
    "currentUserId": "current-user-id",
    "messages": [
      {
        "id": "message-id",
        "text": "消息正文",
        "fromUserId": "current-user-id",
        "toUserId": "opposite-user-id",
        "timestamp": 1700000000000
      }
    ],
    "sync": {
      "complete": true,
      "sourceLatestMessageId": "latest-message-id",
      "syncedAt": "2026-07-30T00:00:00.000Z"
    }
  }
}
```

字段映射：

| 猎聘字段 | 通用字段 |
|---|---|
| `msgId` | `id` |
| `payload.bodies[].msg` | `text` |
| `msgTime` | `timestamp` |
| `userId` | 当前账号用户 ID，同时写入 `conversation.currentUserId` |
| `oppositeUserId` | 对端用户 ID |

根据附件样例，发送方映射为：

| `direction` | `fromUserId` | `toUserId` | 展示位置 |
|---|---|---|---|
| `"0"` | `userId` | `oppositeUserId` | 当前用户，右侧 |
| `"1"` | `oppositeUserId` | `userId` | 招聘者，左侧 |

实施前需用一条明确由当前用户发送和一条由招聘者发送的消息再次核对
`direction` 语义。若实测与附件相反，只调整解析映射，不改变存储模型。

每页解析完成后，按 `id` 去重；最终按 `timestamp` 升序、`id` 升序排序。消息 ID
比较使用字符串大整数或 `BigInt`，不能转为 `Number`。

接口返回的 `oppositeUserId` 可同时补全 `record.liepin.oppositeUserId`，但只有整段
会话成功同步后才允许回写。

## 5. 分页与完整性

附件首页请求的 `pageSize=20`，响应却返回 `data.pageSize=0`，因此不能使用响应
`pageSize` 判断是否完成。

推荐分页流程：

1. 首页 `maxMessageId=''`。
2. 从本页全部原始 `data.list` 计算最旧的有效 `msgId`。
3. 下一页将该 ID 作为 `maxMessageId`。
4. 累积原始消息 ID，用于去重和判断实际取得数量。
5. 满足任一条件时结束：
   - `data.list` 为空；
   - 已取得的唯一原始消息数达到 `data.totalCount`；
   - 本页原始数量小于请求的 `pageSize=20`；
   - 最旧 `msgId` 与上一页相同；
   - 本页没有新增原始 `msgId`。
6. 增加最大页数保护，例如 500 页，并在每页前后检查取消信号。

只有命中正常结束条件时才设置 `conversation.sync.complete=true`。重复游标、超过
最大页数、响应结构异常或网络失败均视为同步失败，不得把部分数据标记为完整会话。

需要补充一个超过 20 条消息的真实请求样本，确认猎聘下一页是否包含
`maxMessageId` 对应消息。实现必须按 `msgId` 去重，因此包含或不包含都不会造成
重复保存。

## 6. 是否需要同步

保持现有猎聘联系人同步判断不变：

- `latestMsgId` 变化；
- 消息状态变化；
- 岗位信息缺失；
- 新联系人。

记录已经被上述逻辑选中后，再检查完整会话：

```text
conversation 不存在
或 conversation.sync.complete !== true
或 conversation.sync.sourceLatestMessageId !== item.latestMsgId
```

满足任一条件才请求 `chat-list`，否则复用已有完整会话并计为跳过。

与 BOSS 一致，旧记录不能仅因为缺少 `conversation` 就自动进入普通同步，以免一次
升级触发全部历史联系人请求。旧记录可在后续消息变化时补齐，或由总览页
“更新选中”主动补齐。

总览页手动同步时始终执行上述会话检查：

- 已有完整 `jobInfo`：只同步会话，不请求岗位信息；
- 缺少 `jobInfo`：会话成功后继续现有岗位同步；
- 会话和岗位均已完整且最新：整条记录计为跳过。

## 7. 正常同步接入点

在 `liepin-extractor.js` 中新增：

- `parseLiepinConversationMessage(item)`
- `oldestLiepinMessageId(list)`
- `fetchLiepinConversation(recordOrItem, currentUserId, options)`
- `liepinConversationIsCurrent(record, item)`
- `createConversationSyncStats()`，或抽取为与 BOSS 共用的统计构造器

`extractLiepinChatRecords()` 每条记录的建议顺序：

1. 使用现有逻辑匹配旧记录并构造联系人基础数据。
2. 根据 `liepinConversationIsCurrent()` 决定复用或请求完整会话。
3. 会话请求成功后，把 `conversation` 合入基础记录。
4. 按现有规则决定是否请求岗位详情。
5. 所有必要步骤完成后再替换/插入记录。

必须保持 `lastMessage`、`liepin.latestMsgId`、`messageStatus` 和原同步分类逻辑不变。

## 8. 总览页手动同步接入点

在 `refreshLiepinRecords()` 中复用同一个 `fetchLiepinConversation()`，不要另写一套
解析和分页逻辑。

每条记录建议顺序：

1. 精确匹配联系人，取得最新 `latestMsgId`、`oppositeImId`。
2. 检查并同步完整会话。
3. 会话成功后更新联系人基础字段。
4. 仅当通用 `isCompleteJobInfo(record)` 为 false 时同步岗位详情。
5. 返回统一的逐记录 `results`，供后台按 `recordKey` 统计成功、失败、跳过。

会话同步失败时，该条返回失败并继续其他联系人；不能因为旧 `jobInfo` 已完整就把
会话失败标记为成功。

## 9. 保存、合并与发送消息

现有通用能力应继续复用：

- `shared-records.js` 的 `normalizeConversation()`、`mergeConversation()`；
- `background.js` 的 `mergedConversationFields()`；
- `results-database.js` 的记录保存和导出；
- `results.js` 的完整会话悬浮气泡。

所有猎聘记录合并路径必须显式保留较新的完整 `conversation`，不能被联系人基础
对象或岗位对象中的空字段覆盖。

猎聘发送文本消息成功后，继续更新现有 `latestMsgId` 和最近消息字段，同时将已有：

```text
conversation.sync.complete = false
```

在重新从 `chat-list` 拉取完整上下文前，不应继续展示旧会话为“完整”。

## 10. 失败与恢复

会话同步必须采用整段提交：

- 所有分页成功后才替换 `conversation`；
- 任一页失败时保留旧 `conversation`；
- 不保存本次新的会话游标为完整状态；
- 新记录会话失败时不插入；
- 已有记录会话失败时不更新 `latestMsgId`，保证下一次原判断仍可重试；
- 单条联系人失败不阻断后续联系人；
- 用户暂停时停止新请求，当前未完成记录不保存部分会话。

业务响应校验至少包括：

- HTTP 成功；
- 响应为对象；
- `flag` 表示成功；
- `data.list` 为数组；
- 每页联系人 `oppositeImId` 与请求目标一致；如响应项缺失该字段，可使用请求目标，
  但不能接受明确不一致的记录。

## 11. 展示

无需新增猎聘专用 UI：

- `conversation.currentUserId` 匹配的消息显示在右侧；
- 对端消息显示在左侧；
- 仅 `sync.complete=true` 且存在正文时启用“原消息”悬浮框；
- 时间顺序、弹框定位、分页页内 JSON 预览继续复用现有逻辑。

## 12. 实施文件

| 文件 | 修改内容 |
|---|---|
| `liepin-extractor.js` | 请求、分页、payload 解析、同步判断、正常同步和手动同步接入 |
| `shared-records.js` | 原则上无需改结构；只在发现猎聘 ID 规范化缺口时补通用校验 |
| `background.js` | 复用会话合并、失败保护、发送后失效和逐记录统计 |
| `results.js` | 原则上无需改展示；验证猎聘 `currentUserId` 左右方向 |
| `docs/dataModel.md` | 补充猎聘字段映射和同步完整性说明 |
| `docs/liepin.md` | 补充 `chat-list` 会话同步流程 |

## 13. 验收清单

1. 单页少于 20 条时，保存全部有效 `payload.bodies[].msg`。
2. 超过 20 条时能翻到最早一页，消息无重复、无遗漏。
3. 系统消息或 payload 解析失败不影响分页游标。
4. `msgId` 全程以字符串处理，不出现精度丢失。
5. 当前用户消息在右侧，招聘者消息在左侧。
6. `conversation.sync.sourceLatestMessageId` 与联系人 `latestMsgId` 一致。
7. 会话已完整且 `latestMsgId` 未变化时不重复请求。
8. 普通同步仍只处理原逻辑选中的记录。
9. 总览页“更新选中”可为旧记录补齐会话。
10. 已有完整岗位信息时不请求岗位详情，只处理会话。
11. 任一分页失败不会覆盖旧完整会话。
12. 发送猎聘消息后旧会话被标记为不完整。
13. 后台合并、保存、重新加载后会话不丢失。
14. 悬浮框按时间顺序展示，左右方向正确。
15. 同步统计按唯一记录计算，重试不重复累计成功或失败。

## 14. 实施前待确认

附件只覆盖 15 条消息，无法验证多页行为。编码前最好再取得一份超过 20 条的
`chat-list` 连续两页请求，确认：

- 下一页 `maxMessageId` 的确取上一页最旧 `msgId`；
- 下一页是否重复包含游标消息；
- 最后一页 `totalCount`、空列表和列表长度的表现；
- `direction=0/1` 的发送方语义；
- 撤回消息是否仍携带可见正文。

即使暂时没有补充样本，也可以按本方案实现；游标去重、`totalCount`、短页和最大页数
保护能够覆盖主要边界，但分页语义应作为首轮联调重点。
