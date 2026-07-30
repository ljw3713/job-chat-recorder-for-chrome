# 项目数据模型

## 1. 文档范围

本文记录当前项目实际使用的数据结构，包括：

- 结果页表格中可见的数据。
- JSON 预览、复制和下载的数据。
- CSV 导入、导出及“内部数据”列。
- 保存在 `chrome.storage.local`、但未直接暴露在结果页或导出文件中的数据。
- BOSS 直聘、猎聘、岗位详情、公司资料、同步进度和日志之间的关系。

本文描述当前代码，不包含已经删除的旧岗位字段兼容方案。

## 2. 数据分层

项目数据分为四层：

| 层级 | 主要结构 | 是否在页面显示 | 是否导出 |
|---|---|---:|---:|
| 业务记录 | `JobChatRecord` | 是 | JSON、CSV |
| 独立业务数据 | `CompanyProfile` | 否 | 否 |
| 同步结果容器 | `PendingRecordsData`、`SyncSummary` | 部分显示 | 否 |
| 运行时状态 | 快照、进度、日志、设置、标签页信息 | 部分显示 | 否 |

核心关系：

```text
jobChatPreparedSourceList
  → 同步提取
    → jobChatPendingRecords.records
      → 用户确认保存
        → jobChatRecords

岗位详情响应
  → record.jobRef + record.jobInfo + record.companyKey
  → jobChatCompanyProfiles[companyKey]
```

## 3. 核心业务记录 `JobChatRecord`

`jobChatRecords`、`jobChatPendingRecords.records` 和
`jobChatIgnoredRecords` 中的单条元素都使用同一核心记录模型。

完整结构示例：

```json
{
  "index": 1,
  "recordKey": "boss|encrypted-boss-id|job-id",
  "siteKey": "boss",
  "sourceName": "BOSS直聘",
  "companyName": "示例公司",
  "jobName": "后端工程师（20-30K）",
  "applicationDate": "2026-07-28 09:05:27",
  "updatedDate": "2026-07-29 10:30:00",
  "time": "2026-07-29 10:30:00",
  "note": "",
  "messageStatus": "0",
  "recruiterName": "张三",
  "recruiterTitle": "HR",
  "lastMessage": "你好，可以进一步沟通。",
  "createdAt": "2026-07-28T01:05:27.000Z",
  "updatedAt": "2026-07-29T02:30:00.000Z",
  "jobRef": {
    "externalId": "平台岗位ID",
    "detailAccessToken": "岗位详情访问凭据"
  },
  "companyKey": "boss|平台公司ID",
  "jobInfo": {
    "title": "后端工程师",
    "category": "后端开发",
    "location": "上海",
    "experience": "5-10年",
    "education": "本科",
    "salary": "20-30K",
    "description": "岗位描述",
    "address": "详细地址",
    "skills": ["Java", "Spring"],
    "fetchStatus": "success",
    "fetchedAt": "2026-07-29T02:30:00.000Z",
    "errorMessage": ""
  },
  "boss": {},
  "liepin": {}
}
```

一条记录只会使用与其来源对应的 `boss` 或 `liepin` 对象。

### 3.1 页面公共字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `recordKey` | string | 项目内部唯一键；JSON、CSV 可见 |
| `siteKey` | string | 站点代码，目前为 `boss` 或 `liepin` |
| `sourceName` | string | 页面显示名称，目前为 `BOSS直聘` 或 `猎聘` |
| `companyName` | string | 聊天列表关联的公司名称 |
| `jobName` | string | 聊天列表关联的岗位名称，可包含薪资 |
| `applicationDate` | string | 首次沟通或申请时间 |
| `updatedDate` | string | 最近沟通更新时间 |
| `note` | string | 用户备注 |
| `messageStatus` | string | 内部通常为 `"0"` 未读、`"1"` 已读 |
| `recruiterName` | string | 招聘者姓名 |
| `recruiterTitle` | string | 招聘者职位 |
| `lastMessage` | string | 最近一条消息文本 |

页面将 `recruiterName` 和 `recruiterTitle` 合并显示为：

```text
招聘者姓名 / 招聘者职位
```

页面将 `messageStatus` 显示为“未读”或“已读”。

### 3.2 内部通用字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `index` | number | 当前数组中的展示顺序，从 1 开始 |
| `time` | string | 来源记录的最近沟通时间，规范化后通常与 `updatedDate` 相同 |
| `createdAt` | ISO string | 首次保存到总记录的时间 |
| `updatedAt` | ISO string | 最近一次同步、导入、岗位更新或发送后的更新时间 |
| `importedAt` | ISO string | CSV 导入时间；仅导入记录可能存在 |
| `ignoredAt` | ISO string | 记录被加入忽略列表的时间 |

这些字段不作为结果页表格列。普通 JSON/CSV 导出不包含它们；总览页 `debug=true`
时会进入调试 JSON 或 CSV 的“内部数据”。

## 4. `recordKey` 生成规则

`recordKey` 用于：

- 合并同步记录。
- CSV 增量导入。

记录已经存在显式 `recordKey` 时，该值是权威且稳定的唯一标识；页面规范化、岗位刷新和
本地存储迁移不会根据后续变化的 `boss.jobId` 重新生成或替换它。仅缺少 `recordKey`
的旧记录才根据下述规则补齐。
- 删除、忽略、发送和更新岗位详情。
- 判断记录是否已存在。

生成优先级如下。

### 4.1 BOSS 直聘

优先使用：

```text
boss|{boss.encryptBossId 或 boss.bossId}|{boss.jobId}
```

没有 `jobId` 时依次降级为：

```text
boss|{boss.encryptBossId 或 boss.bossId}
boss|{boss.chatSecurityId}
boss|{boss.encryptFriendId 或 boss.friendId}
```

### 4.2 猎聘

优先使用：

```text
liepin|{liepin.oppositeImId}
```

### 4.3 最终降级

缺少站点稳定标识时使用：

```text
{sourceName}|{companyName}|{jobName}|{recruiterInfo}
```

生成时会转为小写。已经存在的 `recordKey` 只在无法通过上述稳定字段生成时作为降级值。

## 5. 岗位引用 `jobRef`

```json
{
  "externalId": "平台岗位ID",
  "detailAccessToken": "岗位详情访问凭据"
}
```

| 字段 | 说明 |
|---|---|
| `externalId` | 通用的平台岗位 ID；BOSS 来源为 `encryptJobId`，猎聘来源为 `job-preview.jobId` |
| `detailAccessToken` | 获取岗位详情的临时访问凭据；BOSS 来源为 `getBossData.securityId`，猎聘不需要该字段 |

`detailAccessToken` 在需要凭证的平台属于敏感、可能过期的数据。是否必填由站点适配器
声明；BOSS 必填，猎聘为空。它会出现在 JSON 输出中，但不会进入 CSV。

旧的顶层 `bossJobSecurityId`、`externalJobId`、`jobDetailAccessToken`，以及
`boss.encryptJobId`、`boss.bossJobSecurityId`、`boss.uploadSecurityId` 不属于当前模型，
记录规范化时会删除。

## 6. 岗位信息 `jobInfo`

```json
{
  "title": "",
  "category": "",
  "location": "",
  "experience": "",
  "education": "",
  "salary": "",
  "description": "",
  "address": "",
  "skills": [],
  "fetchStatus": "",
  "fetchedAt": "",
  "errorMessage": ""
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string | 岗位名称 |
| `category` | string | 岗位分类 |
| `location` | string | 工作地点 |
| `experience` | string | 经验要求 |
| `education` | string | 学历要求 |
| `salary` | string | 薪资描述 |
| `description` | string | 岗位描述，保留换行 |
| `address` | string | 详细地址 |
| `skills` | string[] | 技能标签，规范化时去重 |
| `fetchStatus` | string | `success`、`failed` 或空字符串 |
| `fetchedAt` | ISO string | 最近岗位详情请求完成时间 |
| `errorMessage` | string | 失败原因或成功终态说明 |

岗位完整需同时满足：

1. `jobRef.externalId` 非空。
2. `jobInfo.fetchStatus === "success"`。
3. 八个岗位文本属性存在。
4. `skills` 是数组。

属性值允许为空。因此 BOSS 返回 `code=200301` 时保存：

```json
{
  "jobInfo": {
    "title": "",
    "category": "",
    "location": "",
    "experience": "",
    "education": "",
    "salary": "",
    "description": "",
    "address": "",
    "skills": [],
    "fetchStatus": "success",
    "fetchedAt": "当前时间",
    "errorMessage": "该职位已不存在"
  }
}
```

该记录视为岗位信息已同步，不会被“岗位信息未同步”筛选命中。

## 7. BOSS 内部结构 `boss`

`boss` 不显示在结果页表格或普通 JSON/CSV 输出中。总览页 `debug=true` 时会进入调试
JSON 和 CSV 的“内部数据”，用于恢复同步和发送功能。

```json
{
  "ownerUserId": "",
  "friendId": "",
  "relationFriendId": "",
  "peerKey": "",
  "chatSecurityId": "",
  "friendSource": "",
  "bossId": "",
  "encryptBossId": "",
  "encryptFriendId": "",
  "jobId": "",
  "lastMsgId": "",
  "lastMsgTime": 0,
  "contactKey": "",
  "messageStatus": "",
  "lastMessageInfo": {}
}
```

| 字段 | 作用 |
|---|---|
| `ownerUserId` | 当前登录求职者账号 ID；发送消息时校验账号归属 |
| `friendId` | 招聘者数值用户 ID；WebSocket 发送消息 |
| `relationFriendId` | 标签联系人列表中的关系 ID；请求 `getGeekFriendList.json` |
| `peerKey` | 聊天对端加密标识；发送消息 |
| `chatSecurityId` | 联系人/聊天访问凭据；联系人数据匹配和岗位访问准备 |
| `friendSource` | 联系人来源类型；调用 `getBossData` |
| `bossId` | 招聘者 ID；联系人匹配和发送准备 |
| `encryptBossId` | 招聘者加密 ID；稳定匹配、`recordKey` 和发送 |
| `encryptFriendId` | 联系人加密 ID；部分响应下的匹配降级字段 |
| `jobId` | 聊天关联岗位 ID；参与 `recordKey` |
| `lastMsgId` | 最近消息 ID；判断是否出现新消息 |
| `lastMsgTime` | 最近消息时间戳 |
| `contactKey` | 从联系人项生成的内部匹配键 |
| `messageStatus` | 来源侧原始消息状态 |
| `lastMessageInfo` | BOSS 联系人列表返回的最近消息原始对象 |

`lastMessageInfo` 是来源数据的透传快照，具体子字段可能随 BOSS 响应变化。当前代码会用到
其中的 `msgId`、`msgTime`、`showText` 和 `status`。

## 8. 猎聘内部结构 `liepin`

`liepin` 不显示在结果页表格或普通 JSON/CSV 输出中；总览页 `debug=true` 时会进入
调试 JSON 和 CSV 的“内部数据”。

```json
{
  "imId": "",
  "oppositeImId": "",
  "oppositeUserId": "",
  "latestMsgId": "",
  "latestMsgTime": "",
  "oppositeRead": "",
  "contactKey": "",
  "homePage": "",
  "jobId": "",
  "jobKind": "",
  "contactType": "hr",
  "jobDetailUrl": "",
  "jobPreview": {
    "jobId": "",
    "jobKind": "",
    "jobTitle": "",
    "jobDqName": "",
    "reqWorkYear": "",
    "reqEdu": "",
    "jobSalary": "",
    "compStage": "",
    "jobCompany": ""
  }
}
```

| 字段 | 作用 |
|---|---|
| `imId` | 当前登录用户的猎聘 IM ID |
| `oppositeImId` | 聊天对端 IM ID；稳定匹配和 `recordKey` |
| `oppositeUserId` | 聊天对端用户 ID；猎聘发送文本消息使用 |
| `latestMsgId` | 最近消息 ID；判断记录是否更新 |
| `latestMsgTime` | 最近消息时间 |
| `oppositeRead` | 对端读取状态 |
| `contactKey` | 联系人匹配键 |
| `homePage` | 联系人主页地址 |
| `jobId` | `job-preview` 返回的原始岗位 ID；与 `jobRef.externalId` 一致 |
| `jobKind` | 猎聘岗位类型，用于与联系人类型交叉校验 |
| `contactType` | 根据主页识别的 `hr`、`hunter` 或 `unknown` |
| `jobDetailUrl` | HR 或猎头岗位详情地址 |
| `jobPreview` | 规范化后的岗位预览快照，作为详情字段回退 |

猎聘同步聊天记录和通用 `jobInfo`。HR 详情 URL 使用
`/job/19{jobId}.shtml`，猎头详情 URL 使用 `/a/{jobId}.shtml`；`19` 只属于 URL
路由，不进入 `jobId`。

## 9. 公司资料 `CompanyProfile`

公司资料不嵌入聊天记录，独立保存在：

```text
chrome.storage.local.jobChatCompanyProfiles
```

存储结构是以 `companyKey` 为键的对象：

```json
{
  "boss|company-external-id": {
    "companyKey": "boss|company-external-id",
    "siteKey": "boss",
    "externalId": "company-external-id",
    "name": "示例公司",
    "employeeScale": "1000-9999人",
    "industry": "互联网",
    "description": "公司介绍"
  }
}
```

| 字段 | 说明 |
|---|---|
| `companyKey` | `{siteKey}|{externalId}` |
| `siteKey` | 来源站点 |
| `externalId` | 平台公司 ID |
| `name` | 公司名称 |
| `employeeScale` | 企业员工规模 |
| `industry` | 行业 |
| `description` | 公司介绍 |

聊天记录只通过 `record.companyKey` 引用公司资料。结果页通过该引用在公司列悬浮卡中
显示公司名称、行业、规模和介绍。JSON 和 CSV 都不导出 `jobChatCompanyProfiles`；
JSON 只导出记录上的 `companyKey`。

## 10. 页面表格模型

结果页表格显示以下九列：

| 页面列 | 记录来源 |
|---|---|
| 来源 | `sourceName` |
| 公司名 | `companyName` |
| 岗位名 | `jobName` |
| 申请时间 | `applicationDate` |
| 更新时间 | `updatedDate` |
| 备注 | `note` |
| 招聘者 | `recruiterName + recruiterTitle` |
| 状态 | `messageStatus` 转换为已读/未读 |
| 原消息 | `lastMessage` |

岗位详情通过岗位名悬浮卡显示，读取 `jobInfo`。`recordKey` 用于页面操作，但不作为普通
表格列显示。

页面、复制和下载只处理当前筛选后的 `currentRecords`，不一定是存储中的全部记录。

## 11. JSON 输出模型

JSON 预览和复制 JSON 使用同一结构：

```json
[
  {
    "recordKey": "",
    "sourceName": "",
    "companyName": "",
    "jobName": "",
    "applicationDate": "",
    "updatedDate": "",
    "note": "",
    "messageStatus": "已读",
    "recruiterInfo": "姓名 / 职位",
    "lastMessage": "",
    "jobRef": {
      "externalId": "",
      "detailAccessToken": ""
    },
    "companyKey": "",
    "jobInfo": {
      "title": "",
      "category": "",
      "location": "",
      "experience": "",
      "education": "",
      "salary": "",
      "description": "",
      "address": "",
      "skills": [],
      "fetchStatus": "",
      "fetchedAt": "",
      "errorMessage": ""
    }
  }
]
```

普通总览页 JSON 不包含：

- `siteKey`
- `index`
- `time`、`createdAt`、`updatedAt`、`importedAt`、`ignoredAt`
- `boss`
- `liepin`
- 独立公司资料
- 同步进度、日志和设置

JSON 是展示/分析输出，不是完整备份格式。仅凭 JSON 无法恢复发送消息和增量同步所需的
站点内部字段。

总览页 URL 增加 `debug=true` 后进入调试数据模式。JSON 预览、复制及下载会在上述公共
字段基础上保留原记录的 `siteKey`、时间戳、`boss`、`liepin` 及其他内部字段，可用于
完整问题排查和备份。

## 12. CSV 输出模型

普通模式 CSV 列固定为：

```text
唯一索引id
来源
公司名
岗位名
申请时间
更新时间
备注
招聘者
状态
原消息
```

总览页 URL 增加 `debug=true` 后，CSV 追加“内部数据”列。该列是单条记录剔除页面公共
字段后得到的完整 JSON 对象，典型内容如下：

```json
{
  "siteKey": "boss",
  "time": "2026-07-29 10:30:00",
  "createdAt": "2026-07-28T01:05:27.000Z",
  "updatedAt": "2026-07-29T02:30:00.000Z",
  "boss": {
    "ownerUserId": "",
    "friendId": "",
    "relationFriendId": "",
    "peerKey": "",
    "chatSecurityId": "",
    "friendSource": "",
    "bossId": "",
    "encryptBossId": "",
    "encryptFriendId": "",
    "jobId": "",
    "lastMsgId": "",
    "lastMsgTime": 0,
    "contactKey": "",
    "messageStatus": "",
    "lastMessageInfo": {}
  }
}
```

### 12.1 调试 CSV 内部数据

调试 CSV 的“内部数据”保留 `jobRef`、`jobInfo`、`companyKey`、`boss`、`liepin` 和
其他未显示在公共列中的字段。普通模式不生成该列。

### 12.2 CSV 导入合并

CSV 导入是按 `recordKey` 增量合并，不是覆盖全部数据库：

- 新 `recordKey` 新增记录。
- 已存在的 `recordKey` 更新可见字段。
- 仅总览页 `debug=true` 时允许导入“内部数据”；普通模式遇到非空内部数据会拒绝导入。
- 调试模式有有效“内部数据”时，导入值覆盖同名内部字段，并深度合并
  `boss`、`boss.lastMessageInfo` 和 `liepin`。
- 没有“内部数据”时，保留数据库中已有的 `boss` 和 `liepin`。
- 调试内部数据可以新增或覆盖 `jobRef`、`jobInfo`、`companyKey` 等岗位字段。
- 普通模式或没有内部数据时，保留数据库中已有的岗位字段。

CSV 的“内部数据”包含账号和联系人标识，应按敏感备份文件管理。

### 12.3 复制表格

“复制表格”生成制表符分隔文本，字段与 CSV 前十列相同，但不包含“内部数据”：

```text
唯一索引id、来源、公司名、岗位名、申请时间、更新时间、备注、招聘者、状态、原消息
```

该格式只适合粘贴到表格软件，不是完整备份。

## 13. 同步结果容器 `PendingRecordsData`

`jobChatPendingRecords` 和 `bossChatStatsLatest` 使用以下容器：

```json
{
  "pageTitle": "",
  "pageUrl": "",
  "extractedAt": "",
  "siteKey": "boss",
  "siteTitle": "BOSS直聘沟通记录",
  "sourceName": "BOSS直聘",
  "total": 0,
  "records": [],
  "syncSummary": {}
}
```

| 字段 | 说明 |
|---|---|
| `pageTitle` | 来源标签页标题 |
| `pageUrl` | 来源标签页 URL |
| `extractedAt` | 最近写入时间 |
| `siteKey` | 来源站点 |
| `siteTitle` | 同步结果页标题 |
| `sourceName` | 来源显示名称 |
| `total` | `records` 当前数量 |
| `records` | `JobChatRecord[]` |
| `syncSummary` | 本轮同步统计 |
| `savedAt` | 确认保存到总记录的时间；保存后可能存在 |

`jobChatPendingRecords` 是待用户确认的同步结果。用户点击保存后，它与
`jobChatRecords` 按 `recordKey` 合并。

`bossChatStatsLatest` 是结果页使用的最近数据容器别名，名称虽包含 `boss`，当前也可能
暂存猎聘或总览数据，不应据此判断记录来源。

## 14. 同步摘要 `SyncSummary`

```json
{
  "fetched": 10,
  "inserted": 3,
  "updated": 4,
  "updatedMsg": 4,
  "jobDetailSync": 6,
  "jobDetail": {
    "requested": 6,
    "success": 5,
    "failed": 1,
    "skipped": 0,
    "riskPauses": 1,
    "stoppedByRiskControl": false
  },
  "saved": false,
  "interrupted": false,
  "completed": true,
  "synced": 10,
  "sourceTotal": 10
}
```

| 字段 | 说明 |
|---|---|
| `fetched` | 当前结果容器中的记录数 |
| `inserted` | 新增消息记录数 |
| `updated` | 更新数；当前消息更新通常与 `updatedMsg` 相同 |
| `updatedMsg` | 已有记录的消息状态或最近消息更新数 |
| `jobDetailSync` | 准备阶段预计需要同步的岗位详情数 |
| `jobDetail.requested` | 实际发起岗位详情请求数 |
| `jobDetail.success` | 岗位详情成功数，含“该职位已不存在” |
| `jobDetail.failed` | 岗位详情失败数 |
| `jobDetail.skipped` | 跳过数 |
| `jobDetail.riskPauses` | `code=37` 风控暂停次数 |
| `jobDetail.stoppedByRiskControl` | 是否因连续风控停止 |
| `saved` | 是否已确认合并到总记录 |
| `interrupted` | 是否被手动暂停或中断 |
| `completed` | 本轮是否完成 |
| `synced` | 从首次列表累计处理的记录数 |
| `sourceTotal` | 首次待同步列表总数 |

各字段会随阶段出现或消失。例如准备阶段包含 `jobDetailSync`，确认保存后的摘要主要保留
最终新增、更新和岗位统计；读取方必须允许可选字段缺失。

## 15. 首次待更新列表快照

存储键：

```text
jobChatPreparedSourceList
```

结构：

```json
{
  "siteKey": "boss",
  "pageUrl": "https://www.zhipin.com/...",
  "capturedAt": "2026-07-29T00:00:00.000Z",
  "syncSummary": {
    "inserted": 3,
    "updated": 4,
    "updatedMsg": 4,
    "messageSync": 7,
    "jobDetailSync": 6,
    "sourceTotal": 10
  },
  "list": []
}
```

`list` 保存首次准备阶段得到的来源待更新项，是来源接口原始对象数组，不是
`JobChatRecord[]`。

同步页手动暂停、BOSS 标签页周期刷新和 `code=37` 刷新后继续同步时，都复用该快照，
不会重新获取待更新列表。恢复时通过 `jobChatPendingRecords` 和 `jobChatRecords` 过滤
快照中已完成的项。

该快照不在页面展示，也不进入 JSON 或 CSV；其中可能包含来源站点访问标识，应视为
敏感临时数据。

## 16. 提取状态 `jobChatExtractionStatus`

典型结构：

```json
{
  "state": "ready",
  "siteKey": "boss",
  "siteTitle": "BOSS直聘沟通记录",
  "sourceName": "BOSS直聘",
  "startedAt": "",
  "finishedAt": "",
  "synced": 0,
  "total": 10,
  "inserted": 3,
  "updated": 4,
  "updatedMsg": 4,
  "progressCategories": {
    "communication": {
      "completed": 0,
      "total": 7
    },
    "jobDetail": {
      "completed": 0,
      "total": 6
    }
  },
  "jobDetailRequired": true,
  "message": ""
}
```

`state` 当前可能为：

- `loading`
- `ready`
- `done`
- `error`

该对象驱动同步页状态文本、按钮和分类进度条。暂停恢复时，分类完成数与总数会结合
首次快照和 `SyncSummary` 重新计算。

## 17. 公司、日志、进度和设置存储

### 17.1 主要存储键总览

| 存储键 | 类型 | 作用 | 导出 |
|---|---|---|---|
| `jobChatRecords` | `JobChatRecord[]` | 已确认的总记录 | 通过结果页导出 |
| `jobChatPendingRecords` | `PendingRecordsData` | 待确认同步结果 | 仅导出其中当前筛选记录 |
| `jobChatIgnoredRecords` | `JobChatRecord[]` | 忽略记录 | 否 |
| `jobChatCompanyProfiles` | object | 独立公司资料 | 否 |
| `bossChatStatsLatest` | `PendingRecordsData` | 最近结果页容器 | 否 |
| `jobChatPreparedSourceList` | object | 首次来源列表快照 | 否 |
| `jobChatExtractionStatus` | object | 同步页状态与分类进度 | 否 |
| `jobChatLastSourceTab` | object | 上次来源标签页的 `id`、`url`、`title` | 否 |
| `jobChatBossFriendListCapture` | object | BOSS 页面捕获的联系人列表响应 | 否 |
| `jobChatRefreshProgress` | object | 总览页单条岗位详情更新进度 | 否 |
| `jobChatBossSendProgress` | object | 批量发送单条进度 | 否 |
| `jobChatLiepinImClientIds` | object | 按猎聘 `imId` 保存的 `imClientId` | 否 |

`jobChatRefreshProgress` 的典型结构：

```json
{
  "recordKey": "",
  "status": "等待同步",
  "error": "",
  "completed": 0,
  "total": 10,
  "remainingSeconds": 0,
  "retryAt": 0,
  "storageScope": "total",
  "runId": "",
  "record": {},
  "updatedAt": ""
}
```

其中 `status` 可能为“等待同步”“同步中”“重试中”“成功”“失败”或“已停止”。
`record` 仅在单条岗位详情已经形成可保存结果时出现。

`jobChatBossSendProgress` 是兼容旧版本保留的存储键，保存 BOSS 或猎聘最近一次发送
事件，典型字段包括：

```json
{
  "type": "BOSS_SEND_PROGRESS",
  "recordKey": "",
  "status": "成功",
  "errorCode": "",
  "errorMessage": "",
  "updatedAt": ""
}
```

`type` 还可能表示发送开始、完成、停止或整体错误；猎聘事件使用
`LIEPIN_SEND_*`，并带有 `siteKey: "liepin"`。

### 17.2 取消标志

| 存储键 | 类型 | 说明 |
|---|---|---|
| `jobChatCancelRequested` | boolean | BOSS/通用同步取消标志 |
| `jobChatLiepinCancelRequested` | boolean | 猎聘同步取消标志 |

这些标志用于可中断等待和同步循环，不属于业务记录。

### 17.3 日志

岗位及同步请求/响应日志、岗位更新摘要、标签页刷新日志和批量发送日志，都通过运行时
消息发送到当前结果页，仅保存在 `results.js` 的内存数组中。当前页面最多保留最近
1000 条请求日志和 200 条摘要或发送日志；开始新任务时清空，结果页关闭或刷新后
丢失，不写入 `chrome.storage.local`。旧版本遗留的 `jobChatBossSendLogs` 会在后台
启动时删除。

日志仅在页面日志区域按配置显示，不进入 JSON 或 CSV。岗位请求日志可能包含完整 URL、
访问凭据、token、请求头和响应，应视为敏感数据。

### 17.4 设置

| 存储键 | 示例 | 说明 |
|---|---|---|
| `jobChatSyncRateSettings` | `{"unit":"second","count":2}` | 同步页通用速率设置 |
| `jobChatSyncRateLimit` | `2` | 旧版同步速率降级值 |
| `jobChatJobDetailRefreshRate` | `20` | 总览页岗位更新每分钟速率 |
| `jobChatJobDetailRetryDelay` | `60` | `code=37` 重试延时，单位秒 |
| `jobChatJobDetailRetryCount` | `3` | `code=37` 最大重试次数 |
| `jobChatBossSendRate` | `10` | BOSS 批量发送每分钟速率 |
| `jobChatSendRates` | `{"boss":10,"liepin":10}` | 按站点保存的批量发送速率 |
| `jobChatBossPcDeviceId` | string | BOSS 发送协议使用的本地设备 ID |
| `jobChatLiepinImClientIds` | object | 按 `imId` 隔离的猎聘客户端 ID 缓存 |

设置和设备 ID 不随记录导出。

## 18. 数据保存与合并

### 18.1 同步页

```text
来源待更新列表
→ jobChatPreparedSourceList
→ 逐条生成或更新 JobChatRecord
→ jobChatPendingRecords
→ 用户确认
→ jobChatRecords
```

部分同步结果会持续写入 `jobChatPendingRecords`，因此暂停前已完成的数据可以保留。

### 18.2 总记录合并

保存到总记录时按 `recordKey` 合并：

- 新键新增。
- 已有键更新聊天和岗位数据。
- `boss`、`jobRef` 深度合并。
- `jobInfo` 使用本次记录；没有本次值时保留旧值。
- 保留旧备注优先。
- 保留原 `applicationDate`。
- 更新 `updatedAt`。

忽略列表中的 `recordKey` 不会保存到总记录。

### 18.3 总览页岗位更新

岗位详情每完成一条立即写回 `jobChatRecords` 或
`jobChatPendingRecords.records`，无需等待整个批次完成。

## 19. 可恢复性边界

| 数据来源 | 可恢复页面字段 | 可恢复同步/发送字段 | 可恢复岗位信息 | 可恢复公司资料/运行状态 |
|---|---:|---:|---:|---:|
| 普通 JSON 导出 | 是 | 否 | 是 | 否 |
| 普通 CSV 导出 | 是 | 否 | 否 | 否 |
| `debug=true` JSON 导出 | 是 | 是 | 是 | 否 |
| `debug=true` CSV 导出 | 是 | 是 | 是 | 否 |
| 完整 `chrome.storage.local` 备份 | 是 | 是 | 是 | 是 |

如果目标是灾难恢复：

1. 普通 CSV 适合导出可见聊天记录；调试 CSV 可备份站点内部发送、增量同步和岗位字段。
2. 普通 CSV 恢复后需要重新拉取岗位信息。
3. 调试 JSON 可完整导出单条记录，但当前项目没有 JSON 导入功能。
4. 公司资料、忽略列表、设置和同步状态只有完整本地存储备份才能恢复。
   一次性同步日志不进入备份。

## 20. 敏感数据

以下结构可能包含账号或访问凭据：

- `jobRef.detailAccessToken`
- `boss.ownerUserId`
- `boss.friendId`
- `boss.peerKey`
- `boss.chatSecurityId`
- `boss.encryptBossId`
- `liepin.imId`
- `liepin.oppositeImId`
- `liepin.oppositeUserId`
- `jobChatLiepinImClientIds`
- `jobChatPreparedSourceList.list`
- `jobChatBossFriendListCapture`
- 结果页内存中的一次性请求日志
- `jobChatBossPcDeviceId`

JSON、CSV、日志或浏览器本地存储备份均不应发布到公开仓库，也不应发送给不可信第三方。

## 21. 代码来源

本文主要对应：

- `shared-records.js`：核心记录规范化、唯一键及岗位完整性。
- `boss-extractor.js`：BOSS 记录、岗位引用和内部字段。
- `liepin-extractor.js`：猎聘记录和内部字段。
- `job-sync-core.js`：岗位同步结果。
- `background-database.js`：同步结果及总记录合并。
- `results-database.js`：CSV 导入、导出及“内部数据”边界。
- `results.js`：页面、JSON 和 CSV 输出字段。
- `background.js`：公司资料、同步状态、进度、日志和设置。
