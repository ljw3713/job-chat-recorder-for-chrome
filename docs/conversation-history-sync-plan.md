# 完整会话同步方案

## 目标

BOSS 直聘当前只保存联系人列表中的最新一条消息。本次改造在不改变
`lastMessageInfo`、`lastMsgId`、消息状态及原有“是否需要同步”判断的前提下，
为需要同步的记录补齐当前会话的全部文本消息，并在结果页以左右气泡展示。

数据结构使用平台无关的顶层 `conversation` 字段，后续猎聘可以复用相同的存储、
合并与展示逻辑。

## 数据结构

```json
{
  "conversation": {
    "version": 1,
    "currentUserId": "728098945",
    "messages": [
      {
        "id": "369372371206155",
        "text": "消息正文",
        "fromUserId": "59870550",
        "toUserId": "728098945",
        "timestamp": 1785318001552
      }
    ],
    "sync": {
      "complete": true,
      "sourceLatestMessageId": "369679994945542",
      "syncedAt": "2026-07-30T07:03:58.000Z"
    }
  }
}
```

BOSS 响应映射：

| BOSS 字段 | 通用字段 |
|---|---|
| `mid` | `id`，使用字符串保存 |
| `body.text` | `text` |
| `from.uid` | `fromUserId`，使用字符串保存 |
| `to.uid` | `toUserId`，使用字符串保存 |
| `time` | `timestamp` |

只保存 `body.text` 为字符串的消息。岗位卡片、系统卡片等非文本消息不写入
`messages`，但分页游标必须基于完整原始响应计算。`sync.complete=true` 表示接口
已经翻页到 `hasMore=false`，不是指保存所有非文本消息类型。

## 同步规则

1. `bossItemSyncNeeds()` 和 `shouldSyncBossItem()` 保持不变。
2. 记录被现有逻辑选中后，再检查：
   - 没有 `conversation`；
   - `conversation.sync.complete !== true`；
   - `conversation.sync.sourceLatestMessageId` 与联系人列表的
     `lastMessageInfo.msgId` 不一致。
3. 满足任一条件时请求完整历史，否则沿用已有完整会话。
4. 旧记录不会仅因为缺少 `conversation` 自动进入同步；可等待下一次正常消息变化，
   或通过“更新选中”补齐。

结果页点击“更新选中”（`updateDetailsBtn`）时，也必须执行第 2、3 步。该入口同时
更新岗位与消息：即使岗位详情请求失败，只要完整会话及联系人列表数据获取成功，仍
保存新的会话、`lastMessageInfo` 和消息状态；完整会话请求失败时则保持旧消息游标。

## BOSS 历史接口

使用 `/wapi/zpchat/geek/historyMsg`，首页参数：

- `bossId`：联系人加密 ID；
- `maxMsgId=0`；
- `c=20`；
- `page=1`；
- `src`：`friendSource` / `sourceType`；
- `securityId`：聊天访问凭据。

根据 `zpData.hasMore` 翻页。下一页的 `maxMsgId` 使用本页全部原始消息中最旧的
`mid`，不能只使用文本消息。每页同时推进 `page`，并增加重复游标、空页、
最大页数和取消信号保护。最终按 `timestamp`、消息 ID 升序排序并按 ID 去重。

## 保存与失败处理

历史消息、联系人详情和岗位详情组装成功后，才替换对应记录。历史消息请求失败时：

- 不保存新的 `lastMsgId`、消息状态或岗位完成状态；
- 已有记录保持不变，新记录不插入；
- 当前条计入会话同步失败，其他联系人继续；
- 下一次原有同步判断仍能再次选中该记录。

完整历史成功后，以本次完整结果替换旧 `conversation`。所有后台保存、手动更新和
总记录合并路径必须显式保留 `conversation`，避免被部分对象覆盖。

扩展发送 BOSS 消息成功后仍沿用现有 `lastMessageInfo` 更新方式，同时把已有
`conversation.sync.complete` 标记为 `false`。在下一次从平台重新取得完整历史前，
结果页不会把旧上下文误标为完整会话。

## 结果页展示

只有 `conversation.sync.complete=true` 且存在文本消息时，“原消息”单元格才启用
悬浮和键盘焦点：

- `fromUserId === conversation.currentUserId`：当前用户，右侧；
- 其他消息：招聘者，左侧；
- BOSS 缺少 `currentUserId` 时回退到 `record.boss.ownerUserId`；
- 后续猎聘可回退到 `record.liepin.imId`。

消息按时间升序显示，正文保留换行并经过 HTML 转义。没有完整会话的旧记录继续只
展示 `lastMessage`，不弹出残缺会话。

## 验收项

1. 新联系人同步后保存全部文本消息，非文本卡片被过滤。
2. 多页数据无重复且按时间升序。
3. 完整会话且最新消息未变化时不重复请求历史接口。
4. 最新消息变化时重新获取当前完整会话。
5. 历史请求失败不会覆盖旧同步游标，下次仍可重试。
6. `lastMessageInfo` 和原同步判断逻辑不变。
7. 手动“更新选中”可为旧记录补齐会话。
8. 悬浮框中招聘者居左、当前用户居右。
9. 中断同步时不保存不完整会话。
