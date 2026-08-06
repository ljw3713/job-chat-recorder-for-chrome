# BOSS 直聘批量自动打招呼设计与实现方案

## 1. 文档状态

本文根据当前扩展实现、自动消息侧栏配置，以及已验证的 BOSS 直聘接口请求流程，设计
批量自动打招呼功能。

状态：已实施。2026-08-06 新增推荐筛选、检索模式、执行期配置锁和取消等待修复；详细
请求参数、元数据缓存与 UI 行为见 `zhipin-auto-greeting-recommend-filter-plan.md`。

当前范围包含 BOSS 直聘：

- 从推荐岗位列表或检索接口获取候选岗位。
- 请求岗位详情并执行配置过滤。
- 对满足条件且未沟通过的岗位调用 BOSS 默认打招呼接口。
- 按成功数量上限和每分钟速率串行执行。
- 支持暂停、继续、进度展示和逐条持久化。
- 把成功打招呼时取得的岗位、公司、招聘者信息写入现有同步记录。

首期不包含：

- 猎聘自动打招呼。
- 自定义首条消息正文；`friend/add.json` 使用 BOSS 默认招呼语。
- 对结果未知的 POST 自动重试。
- 多个 BOSS 标签页或多个登录账号并行运行。
- 后台无页面环境运行；请求必须绑定启动任务的 BOSS 标签页。

## 2. 当前基础

### 2.1 自动消息侧栏

当前侧栏已经按标签页打开，只在启动它的标签页显示。已经存在以下配置：

```js
{
  salaryMinK,
  salaryMaxK,
  experienceMinYears,
  experienceMaxYears,
  technicalKeywords,
  jobKeywords,
  jobFilterKeywords,
  companyFilterKeywords,
  greetingCount
}
```

“仅在线”沿用 `jobChatOnlineOnlyTabs`，按当前标签页保存在
`chrome.storage.session`；其他自动消息配置保存在
`chrome.storage.local.jobChatAutoMessageConfig`。

侧栏已有两种配置状态：

- 没有配置时显示完整编辑表单。
- 已有配置时显示只读摘要，左侧为“编辑”，右侧为“一键打招呼”。

只读摘要支持双击单项快速编辑。快速编辑未结束时，“一键打招呼”不启动任务，并提示
“正在编辑”。

### 2.2 推荐岗位响应捕获

`boss-hook.js` 已在页面主世界包装 Fetch/XHR，并识别：

```http
GET /wapi/zpgeek/pc/recommend/job/list.json
```

当前用途是从响应中提取离线岗位 `encryptJobId`，为“仅在线”页面过滤提供数据。自动
打招呼复用同一个网络 Hook，记录页面最近一次推荐岗位请求的完整 URL，并从主动分页响应中
提取候选，至少保留：

```text
securityId
lid
encryptJobId
encryptBossId
bossOnline
jobName
salaryDesc
jobExperience
brandName
bossName
bossTitle
skills
```

候选响应中的长 `securityId` 和 `lid` 只能留在页面/内容脚本运行内存中，不写日志，
也不持久化为任务快照。

### 2.3 岗位详情请求

现有 BOSS 岗位详情同步已经实现：

- 页面登录态请求桥接。
- 当前 Cookie、运行时 `token` 和每次新生成的 `traceId`。
- `AbortSignal` 取消。
- HTTP、JSON、业务码和风控错误处理。
- `jobInfo`、`companyProfile` 标准化。
- 公司资料独立 upsert。

现有岗位详情请求为：

```http
GET /wapi/zpgeek/job/detail.json?securityId={detailAccessToken}&_={Date.now()}
```

自动打招呼的入口凭据来自推荐列表，不经过聊天联系人列表和 `getBossData`，因此需要在
复用现有请求桥接、错误处理和响应映射的同时，为请求补充推荐岗位的 `lid`。

### 2.4 同步记录

总记录保存在：

```text
chrome.storage.local.jobChatRecords
```

BOSS 岗位的通用外部 ID 为：

```text
record.jobRef.externalId
```

其值对应 BOSS 的加密岗位 ID。现有 `recordKey` 优先使用：

```text
boss|{boss.encryptBossId 或 boss.bossId}|{boss.jobId}
```

自动打招呼成功后必须生成同一模型的 `JobChatRecord`，不能另建一套无法与正常同步合并
的数据结构。

## 3. 核心原则

1. 先判断本地重复，再请求岗位详情；发送前再次判断重复，防止运行中的竞态。
2. 所有筛选条件使用岗位详情的权威字段，推荐列表字段只用于预筛和减少请求。
3. `friend/add.json` 是可能产生外部副作用的 POST，响应不明确时绝不自动重试。
4. 打招呼数量只统计明确成功的岗位，不统计扫描、过滤、跳过或失败。
5. 每次成功后先持久化记录，再处理下一候选岗位。
6. 暂停只阻止发起下一次请求，不强制中断已经发出的打招呼 POST。
7. 任务绑定启动标签页和当前登录账号；切换标签页只隐藏侧栏，不改变任务归属。
8. 页面凭据、运行时 token、`securityId` 和 `lid` 不进入普通日志。

## 4. 请求链路与字段来源

### 4.1 三类容易混淆的字段

推荐列表和岗位详情都返回名为 `securityId` 的字段，但用途不同，不能混用：

| 阶段 | 字段 | 来源 | 用途 |
|---|---|---|---|
| 推荐列表 | `listSecurityId` | `jobList[i].securityId` | 请求该岗位详情 |
| 推荐列表 | `listLid` | `jobList[i].lid` | 请求岗位详情；首选岗位项自己的 `lid` |
| 岗位详情 | `addSecurityId` | `detail.zpData.securityId` | 请求 `friend/add.json` |
| 岗位详情 | `jobId` | `detail.zpData.jobInfo.encryptId` | `friend/add.json` 的岗位 ID，也是本地去重主键 |
| 岗位详情 | `detailLid` | `detail.zpData.lid` | `friend/add.json` 的 `lid` |

禁止把岗位详情的 `addSecurityId` 写入 `boss.chatSecurityId`。后者属于聊天联系人接口凭据，
不是岗位打招呼凭据。

### 4.2 步骤一：取得推荐岗位

目标接口：

```http
GET https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json
```

成功要求：

- HTTP 成功。
- JSON 可解析。
- `code === 0`。
- `zpData.jobList` 是数组。

每个候选至少要求：

```text
job.securityId
job.lid
job.encryptJobId
```

列表请求包含由 BOSS 页面生成的查询上下文。实现不得重新拼接筛选参数，而是：

1. 在 `document_start` 捕获页面最近一次真实推荐列表请求的完整 URL。
2. 点击“一键打招呼”时读取该 URL；未捕获到时提示刷新页面且不启动任务。
3. 固定从 `page=1` 主动分页，仅替换 `page` 和 `_` 时间戳，其他参数、顺序和原始编码保持不变。
4. 内容脚本按顺序消费响应候选，批次内和跨批次按 `encryptJobId` 去重。
5. `hasMore === false` 或连续空页达到安全上限时停止取候选。

### 4.3 步骤二：获取岗位详情

使用推荐列表岗位项自己的 `securityId` 和 `lid`：

```http
GET https://www.zhipin.com/wapi/zpgeek/job/detail.json
    ?securityId={listSecurityId}
    &lid={listLid}
    &_={Date.now()}
```

请求要求沿用现有岗位详情实现：

- `credentials: "include"`。
- `Accept: application/json, text/plain, */*`。
- `X-Requested-With: XMLHttpRequest`。
- 页面当前运行时 `token`。
- 每次生成新的 `traceId`。
- 通过 `content.js` 和 `boss-hook.js` 的页面请求桥接执行。
- 支持暂停前的停止检查和 `AbortSignal`。

成功要求：

- HTTP 成功。
- JSON 可解析。
- `code === 0`。
- `zpData.jobInfo`、`zpData.bossInfo` 和 `zpData.brandComInfo` 满足当前记录映射需要。
- `zpData.securityId`、`zpData.lid`、`zpData.jobInfo.encryptId` 非空。

`code === 200301` 表示岗位已不存在。岗位同步可以把它当作已完成终态，但自动打招呼必须
跳过，不调用 `friend/add.json`。

岗位详情的标准字段映射继续复用现有逻辑：

| BOSS 字段 | 本地字段 |
|---|---|
| `jobInfo.encryptId` | `jobRef.externalId` |
| `jobInfo.jobName` | `jobInfo.title` |
| `jobInfo.positionName` | `jobInfo.category` |
| `jobInfo.experienceName` | `jobInfo.experience` |
| `jobInfo.salaryDesc` | `jobInfo.salary` |
| `jobInfo.postDescription` | `jobInfo.description` |
| `jobInfo.showSkills` | `jobInfo.skills` |
| `brandComInfo.brandName` | `companyProfile.name`、`record.companyName` |
| `bossInfo.name` | `record.recruiterName` |
| `bossInfo.title` | `record.recruiterTitle` |

### 4.4 步骤三：触发默认打招呼

只使用本次岗位详情响应中的三个字段：

```http
POST https://www.zhipin.com/wapi/zpgeek/friend/add.json
     ?securityId={detail.zpData.securityId}
     &jobId={detail.zpData.jobInfo.encryptId}
     &lid={detail.zpData.lid}
```

首期不提交自定义正文或表单 body，由 BOSS 使用账号当前默认招呼语。

请求必须在页面主世界执行，并沿用当前登录态、运行时 `token`、新 `traceId` 和
`credentials: "include"`。`boss-hook.js` 的页面请求白名单需要新增：

```text
/wapi/zpgeek/friend/add.json
```

发送成功至少要求：

- HTTP 成功。
- 响应是合法 JSON。
- `code === 0`。

正式实现前还需要保存一份脱敏的成功响应和“已沟通过”响应样本，以确认：

- 成功响应中是否返回真实默认招呼语。
- 是否返回关系 ID、联系人 ID 或消息 ID。
- 已经沟通过时使用的业务码及其是否可以视为“跳过”。

在这些字段确认前，不应臆造联系人数字 ID 或消息 ID。

## 5. 配置模型扩展

### 5.1 本地持久化配置

`jobChatAutoMessageConfig` 扩展为：

```js
{
  salaryMinK: 30,
  salaryMaxK: 50,
  experienceMinYears: 1,
  experienceMaxYears: 3,

  technicalKeywords: "Java|Spring|MySQL",
  technicalMatchPercent: 50,

  jobKeywords: "后端|微服务",
  jobMatchPercent: 50,

  jobFilterKeywords: "外包|驻场",

  companyFilterKeywords: "培训|保险",

  greetingCount: 10,
  requestRatePerMinute: 25
}
```

“仅在线”继续按标签页单独读取，不复制进这份全局配置。

### 5.2 新增 UI 配置

在三个关键字项旁增加百分比输入：

| 配置 | 范围 | 默认值 | 作用 |
|---|---:|---:|---|
| 技术关键字匹配度 | 0–100% | 50% | 达到阈值才通过 |
| 职位关键字匹配度 | 0–100% | 50% | 达到阈值才通过 |
| 每分钟请求数 | 1–60 | 25 | 限制岗位详情和打招呼接口的请求速率 |

配置字段命名为 `requestRatePerMinute`。它是每分钟请求速率，不是真正的并行请求数。
岗位详情 GET 和打招呼 POST 共用同一个限速器，首期网络并发固定为 1，避免
同时发起多个自动请求。若后续确实需要并行 worker，应新增独立的
`maxInFlight` 配置，不能复用每分钟速率字段。

### 5.3 任务配置快照

点击“一键打招呼”时复制一份配置快照到任务状态。运行中修改侧栏配置只影响下一次任务，
不改变正在运行批次的筛选规则、数量上限或速率。

启动前校验：

- 工资、年限最小值不大于最大值。
- 三个匹配度都是 0–100 的数字。
- `greetingCount` 是大于等于 1 的整数。
- `requestRatePerMinute` 是 1–60 的整数。
- 当前标签页是已登录的 BOSS 直聘页面。
- 当前没有其他自动打招呼任务或原有消息发送批次。

## 6. 过滤规则

### 6.1 关键字解析

侧栏关键字输入支持 `|` 和换行。统一解析规则：

```js
function parseKeywords(value) {
  return [...new Set(String(value || '')
    .split(/[|\r\n]+/)
    .map((item) => item.trim().toLocaleLowerCase())
    .filter(Boolean))];
}
```

匹配文本统一执行：

- HTML 解码。
- 转小写。
- `\r\n` 归一化为 `\n`。
- 连续空白归一化。
- 使用子串包含匹配，不使用正则表达式。

每个配置关键字最多计一次，重复出现不会提高匹配度。

### 6.2 匹配度公式

三个关键字组分别计算：

```text
匹配度 = 命中的去重关键字数量 / 该组有效关键字总数 × 100
```

例如：

```text
配置：Java|Spring|MySQL|Redis
命中：Java、MySQL
匹配度：2 / 4 × 100 = 50%
```

阈值比较使用“大于等于”：

```text
score >= configuredPercent
```

不用严格大于，避免阈值为 100% 时永远无法通过。

空关键字组不构成限制：

- 空的正向组直接通过。
- 空的过滤组不淘汰岗位。

### 6.3 技术关键字

匹配对象：

```text
detail.zpData.jobInfo.postDescription
```

规则：

```text
technicalKeywords 为空
  → 通过
否则 technicalScore >= technicalMatchPercent
  → 通过
否则
  → 跳过：技术关键字匹配度不足
```

### 6.4 职位关键字

按本次需求，职位关键字同样匹配：

```text
detail.zpData.jobInfo.postDescription
```

首期不自动把 `jobInfo.jobName` 合入匹配文本，避免改变给定规则。若后续希望职位关键字
专门匹配岗位标题，需要单独调整并迁移既有配置含义。

规则与技术关键字相同。两个非空正向组都必须达到各自阈值，岗位才有效。

### 6.5 岗位关键字过滤器

匹配对象仍为：

```text
detail.zpData.jobInfo.postDescription
```

这是负向条件：

```text
jobFilterKeywords 非空且命中任一关键字
  → 跳过：命中岗位关键字过滤器
```

负向过滤必须在正向匹配前执行，避免已明确不需要的岗位继续进入后续发送判断。

### 6.6 公司关键字过滤器

匹配对象：

```text
recommend.jobList[i].brandName
```

任一有效关键字被推荐列表公司名称包含时直接跳过。公司过滤暂不计算百分比，也不使用
岗位详情中的公司名称二次判断。

### 6.7 工资范围

来源：

```text
recommend.jobList[i].salaryDesc
```

需要解析常见格式：

```text
20-30K
40-70K·16薪
20K以下
30K以上
面议
```

`·13薪`、`·16薪` 等年薪月数不参与月薪 K 区间比较。配置和岗位区间有交集时通过：

```text
jobMaxK >= configMinK
并且 jobMinK <= configMaxK
```

只有一侧配置时只应用该侧约束。配置了工资范围但岗位为“面议”或无法解析时，首期按
“工资无法判断”跳过，不能默认为符合。

### 6.8 年限

来源：

```text
recommend.jobList[i].jobExperience
```

需要支持：

```text
经验不限
1年以内
1-3年
3-5年
10年以上
```

普通年限区间与配置区间有交集时通过。“经验不限”视为无约束并通过；配置了年限但字段
无法解析时按“年限无法判断”跳过。

### 6.9 仅在线

来源：

```text
recommend.jobList[i].bossOnline
```

开启“仅在线”后，只有 `bossOnline === true` 才通过；`false`、缺失、`null` 或未知值均
跳过。

### 6.10 建议的过滤顺序

```text
推荐岗位
  → 批次内 jobId 去重
  → 使用 bossOnline 检查仅在线
  → “非猎头”启用时跳过 goldHunter=1
  → 使用 salaryDesc 检查工资范围
  → 使用 jobExperience 检查年限
  → 使用 brandName 检查公司关键字
  → 请求岗位详情
  → 岗位有效状态与已建立关系检查
  → 岗位关键字负向过滤
  → 技术关键字正向匹配
  → 职位关键字正向匹配
  → 发送前再次去重
  → 等待速率令牌
  → POST friend/add.json
```

每个跳过项都要记录结构化原因，用于结果统计，不进入总同步记录。

## 7. 防重复设计

### 7.1 同步记录去重

推荐列表阶段可先使用 `jobList[i].encryptJobId`，详情阶段使用权威的
`detail.zpData.jobInfo.encryptId`。比较前执行 `trim()`，之后精确比较，不做模糊匹配。

检查范围：

```text
jobChatRecords[].jobRef.externalId
jobChatPendingRecords.records[].jobRef.externalId
```

如果旧记录把同一加密岗位 ID 保存在 `boss.jobId`，迁移期可作为降级比较字段，但新的
自动记录必须写入 `jobRef.externalId`。

### 7.2 页面关系状态去重

即使本地没有记录，岗位详情出现以下状态时也跳过：

```text
zpData.relationInfo.beFriend === true
推荐列表 item.contact === true
```

具体字段以实际响应为准，不能只依赖某一个可选字段。

### 7.3 运行中去重

任务维护：

```js
seenJobIds = new Set();
```

岗位进入处理队列时立即加入，防止推荐接口翻页或重排返回相同岗位。

### 7.4 防止 POST 成功但落库前崩溃

只查 `jobChatRecords` 不能覆盖“服务端已成功、本地尚未保存”窗口。增加轻量账本：

```js
jobChatAutoGreetingHistory[jobId] = {
  runId,
  state: 'sending' | 'success' | 'failed' | 'unknown',
  startedAt,
  finishedAt,
  recordKey,
  errorCode
};
```

发送顺序：

1. POST 前写入 `sending` 预留。
2. 明确成功后，在一次后台持久化队列中写入同步记录并把账本改为 `success`。
3. 明确的业务拒绝改为 `failed`，本次任务不重试。
4. 网络断开、超时或页面关闭导致结果不确定时改为 `unknown`。
5. `sending` 和 `unknown` 都禁止后续自动重发，直到用户同步记录或显式清理该状态。

这比超时后自动重试更安全，因为 `friend/add.json` 可能已经在服务端生效。

## 8. 数量、速率和并发

### 8.1 成功数量上限

```text
successCount >= greetingCount
```

达到后立即进入 `completed`，不再取新候选。以下情况不增加 `successCount`：

- 重复岗位。
- 条件过滤。
- 岗位详情失败。
- 打招呼业务失败。
- 结果未知。

如果推荐列表耗尽但成功数不足，任务仍结束，结果显示“岗位已加载完，共成功 X / N”。

### 8.2 每分钟请求速率

默认：

```text
requestRatePerMinute = 45
minimumRequestInterval = ceil(60_000 / 45) = 1_334 ms
```

岗位详情 GET 与 `friend/add.json` POST 共用请求时间戳，任意两个自动 API 请求的开始时间
至少间隔 `minimumRequestInterval`。暂停等待期间不消耗下一令牌，继续后重新计算剩余等待时间。

### 8.3 网络并发

首期固定：

```text
maxInFlight = 1
```

同一时刻只处理一个候选：详情、过滤、打招呼、落库全部完成后再进入下一项。这样便于：

- 精确暂停。
- 严格成功计数。
- 避免重复。
- 降低风控风险。
- 保证逐条落库顺序。

推荐列表、岗位详情和打招呼接口统一受配置的每分钟请求速率限制。

## 9. 任务状态机

```text
idle
  → preparing
    → running
      ↔ paused
      → cancelling
      → cancelled
      → completed
      → error
```

状态说明：

| 状态 | UI | 可执行操作 |
|---|---|---|
| `idle` | 编辑 + 一键打招呼 | 编辑、启动 |
| `preparing` | 正在检查配置和登录态 | 暂停/取消启动 |
| `running` | 进度条 + 暂停 | 暂停 |
| `paused` | 保留进度 + 取消任务/继续 | 取消、继续 |
| `cancelling` | 正在等待在途请求完成 | 无 |
| `cancelled` | 已取消及完成统计 | 返回配置、再次启动 |
| `completed` | 结果汇总 | 返回配置、再次启动 |
| `error` | 错误与已完成统计 | 返回配置、按条件重新启动 |

### 9.1 暂停

点击“暂停”后：

1. 把任务状态写为 `pause-requested`。
2. 不再发起新的列表、详情或打招呼请求。
3. 已发出的 GET 可以取消；已发出的 `friend/add.json` 不强制取消。
4. 等待当前 POST 明确结束并完成本地落库。
5. 状态变为 `paused`，按钮切换为“继续”。

### 9.2 继续

点击“继续”后：

1. 重新校验原标签页仍存在、仍是 BOSS 页面且账号未切换。
2. 读取持久化成功数和已处理 jobId。
3. 重建页面运行时 token，不复用旧 token。
4. 从最近一次推荐列表 URL 的第 1 页重新读取，并靠 jobId 去重跳过已处理项。
5. 状态切回 `running`。

### 9.3 取消

“取消任务”仅在暂停状态显示，并位于“继续”按钮左侧。点击后不再处理后续岗位；若打招呼
POST 已经发出，则等待响应并完成结果落库后进入 `cancelled`。若只预占了岗位 ID、POST 尚未
发出，则释放该预占，避免下次任务错误地跳过该岗位。

### 9.4 页面和扩展生命周期

- 切换到其他标签页：侧栏隐藏，原标签页内容脚本中的任务可以继续。
- 切回原标签页：侧栏重新读取任务状态和进度。
- 原标签页关闭：任务进入 `error` 或 `paused`，不得切换到其他 BOSS 标签页静默继续。
- `code=37` 触发刷新：当前网络请求终止；任务保留首次捕获的推荐列表 URL 和进度，重新建立
  页面桥接后自动从该 URL 的第 1 页继续。
- 用户主动刷新原标签页：任务保留检查点，重新建立页面桥接后由用户继续。
- 扩展更新/重载：任务标记为中断，不自动恢复有副作用的 POST。

## 10. 运行状态与进度

### 10.1 持久化任务状态

建议使用：

```js
jobChatAutoGreetingRun = {
  version: 1,
  runId,
  tabId,
  ownerUserId,
  status,
  recommendedListUrl,
  configSnapshot,
  targetCount,
  successCount,
  scannedCount,
  detailSuccessCount,
  filteredCount,
  duplicateCount,
  failedCount,
  unknownCount,
  currentJobId,
  currentJobName,
  hasMore,
  startedAt,
  pausedAt,
  finishedAt,
  updatedAt,
  lastError
};
```

不在任务状态中保存：

- 推荐列表 `securityId`。
- 岗位详情 `securityId`。
- `lid`。
- Cookie、token、traceId。
- 完整推荐列表响应。

### 10.2 进度条

打招呼目标数是确定的，因此主进度按成功数计算：

```text
progressPercent = min(100, successCount / targetCount × 100)
```

主文案：

```text
已打招呼 4 / 10
```

辅助统计：

```text
已扫描 28 · 重复 6 · 条件过滤 15 · 失败 3
```

当前项：

```text
正在检查：Java 后端工程师 / 示例公司
```

推荐列表耗尽但未达到目标时，进度条不能伪装成 100% 成功；应显示终态文案：

```text
岗位已加载完，成功 6 / 10
```

### 10.3 结构化跳过原因

至少包含：

```text
DUPLICATE_RECORD
DUPLICATE_RELATION
OFFLINE
JOB_INVALID
SALARY_MISMATCH
SALARY_UNKNOWN
EXPERIENCE_MISMATCH
EXPERIENCE_UNKNOWN
COMPANY_FILTERED
JOB_FILTER_MATCHED
TECHNICAL_SCORE_LOW
JOB_SCORE_LOW
DETAIL_FAILED
ADD_REJECTED
ADD_RESULT_UNKNOWN
RISK_CONTROL
```

侧栏展示汇总数量，调试日志可以显示岗位名称和原因，但不得显示完整凭据。

## 11. 成功后的同步记录

### 11.1 记录构造

明确成功后构造现有 `JobChatRecord`：

```js
{
  recordKey: `boss|${encryptBossId}|${jobId}`,
  siteKey: 'boss',
  sourceName: 'BOSS直聘',
  companyName: detail.zpData.brandComInfo.brandName,
  jobName: `${detail.zpData.jobInfo.jobName}（${detail.zpData.jobInfo.salaryDesc}）`,
  recruiterName: detail.zpData.bossInfo.name,
  recruiterTitle: detail.zpData.bossInfo.title,
  applicationDate: nowLocal,
  updatedDate: nowLocal,
  time: nowLocal,
  lastMessage: responseGreetingText || '已发送 BOSS 默认招呼语',
  messageStatus: '0',
  jobRef: {
    externalId: detail.zpData.jobInfo.encryptId,
    detailAccessToken: detail.zpData.securityId
  },
  jobInfo: normalizedJobInfo,
  companyKey,
  boss: {
    ownerUserId,
    encryptBossId,
    peerKey: validPeerKeyOrEmpty,
    jobId
  },
  autoGreeting: {
    version: 1,
    runId,
    jobId,
    sentAt: nowIso,
    source: 'friend/add',
    result: 'success',
    usedDefaultGreeting: true
  }
}
```

`encryptBossId` 优先取 `jobInfo.encryptUserId`，其次取推荐列表的 `encryptBossId`。只有确认
它满足现有 recruiter peerKey 语义和格式时才写入 `boss.peerKey`。数字 `friendId`、消息
ID 等字段必须由接口真实响应提供，不能猜测。

如果成功响应没有返回默认招呼语，`lastMessage` 使用明确的本地说明文字，不能伪造具体
话术。后续正常聊天同步会用服务端真实最近消息覆盖。

### 11.2 公司资料

继续调用现有公司资料 upsert：

```text
brandComInfo.encryptBrandId → companyProfile.externalId
brandComInfo.brandName      → companyProfile.name
brandComInfo.scaleName      → companyProfile.employeeScale
brandComInfo.industryName   → companyProfile.industry
brandComInfo.introduce      → companyProfile.description
```

### 11.3 逐条原子化持久化

新增后台消息建议命名为：

```text
JOB_CHAT_AUTO_GREETING_RECORD_UPSERT
```

后台使用串行保存队列执行：

1. 重新读取最新 `jobChatRecords`，避免覆盖同步或导入产生的并发更新。
2. 按 `recordKey` 和 `jobRef.externalId` 查找旧记录。
3. 使用现有记录合并语义合并 `boss`、`jobRef`、`jobInfo` 和 conversation。
4. upsert 公司资料。
5. 写入合并后的 `jobChatRecords`。
6. 同一次存储提交更新自动打招呼历史账本和任务成功数。
7. 返回成功后才处理下一候选岗位。

成功记录立即进入总记录，不经过需要用户再次确认的 pending 保存流程。

## 12. 组件职责

### 12.1 Side Panel

`auto-message-panel.html`、`src/auto-message-panel.js`：

- 编辑和只读展示新增的三个匹配度、每分钟速率。
- 启动前保存配置快照。
- 展示进度、暂停、继续、汇总。
- 监听 storage/runtime 进度，不直接执行网络循环。
- 快速编辑状态禁止启动。

侧栏可能因切换标签页而隐藏，不能成为任务状态唯一持有者。

### 12.2 Background Service Worker

`background.js`、`background-database.js`：

- 校验任务互斥、标签页和登录账号。
- 维护权威任务状态和持久化检查点。
- 转发开始、暂停、继续命令。
- 串行 upsert 每条成功同步记录。
- 维护 jobId 历史账本。
- 接收进度并写入 `jobChatAutoGreetingRun`。

Service Worker 可能休眠，因此实际长循环不能只存在于后台内存。

### 12.3 Isolated Content Script

`content.js` 或新的 `boss-auto-greeting.js`：

- 持有当前标签页的任务控制器、候选队列和 `seenJobIds`。
- 接收页面 Hook 的推荐岗位批次。
- 调用岗位详情桥接。
- 执行过滤、限速、暂停检查和发送前去重。
- 把运行进度发送给后台。

### 12.4 Page Main World Hook

`boss-hook.js`：

- 捕获最近一次推荐列表请求的完整 URL。
- 在当前页面登录态执行岗位详情 GET。
- 在白名单内执行 `friend/add.json` POST。
- 读取/刷新当前运行时 token，并生成 traceId。
- 仅通过明确的消息协议返回脱敏结果。

页面 Hook 不写业务记录，不持有持久化状态。

### 12.5 BOSS 适配与共享记录

`boss-extractor.js`、`shared-records.js`：

- 复用岗位详情 JSON 校验和标准化。
- 抽出可供自动打招呼调用的岗位/公司/招聘者映射函数。
- 规范化自动记录并生成稳定 `recordKey`。

不要在侧栏脚本中复制一套岗位详情解析器。

## 13. 建议消息协议

侧栏到后台：

```text
JOB_CHAT_AUTO_GREETING_START
JOB_CHAT_AUTO_GREETING_PAUSE
JOB_CHAT_AUTO_GREETING_RESUME
JOB_CHAT_AUTO_GREETING_STATUS_GET
```

后台到内容脚本：

```text
BOSS_AUTO_GREETING_START
BOSS_AUTO_GREETING_PAUSE
BOSS_AUTO_GREETING_RESUME
```

内容脚本到页面 Hook：

```text
BOSS_AUTO_GREETING_SOURCE_GET
BOSS_AUTO_GREETING_DETAIL_REQUEST
BOSS_AUTO_GREETING_ADD_REQUEST
BOSS_AUTO_GREETING_ABORT_GET
```

点击“一键打招呼”时，页面 Hook 必须返回页面最近一次
`/wapi/zpgeek/pc/recommend/job/list.json` 请求的完整 URL。任务固定从第 1 页开始，
后续请求只替换 `page`，其余查询参数、参数顺序、任务启动时间戳及原始编码保持不变。
若页面 Hook 尚未捕获该 URL，任务不启动，并提示用户刷新 BOSS 推荐岗位页面后重试。

当前实现还支持检索模式，通过 `POST /wapi/zpgeek/search/joblist.json` 获取候选；请求体及
筛选字段见 `zhipin-auto-greeting-recommend-filter-plan.md`。

进度事件：

```text
JOB_CHAT_AUTO_GREETING_PROGRESS
JOB_CHAT_AUTO_GREETING_FINISHED
JOB_CHAT_AUTO_GREETING_ERROR
```

每条消息必须携带 `runId`。后台和内容脚本丢弃不属于当前任务的迟到响应。

## 14. 错误、重试和风控

### 14.1 可安全重试

以下 GET 在未产生外部副作用时可以按现有同步规则有限重试：

- 推荐岗位列表。
- 岗位详情。

重试必须支持暂停。遇到 BOSS `code=37` 时进入统一的刷新重试流程。
任一请求明确返回 `code=1` 且消息包含“操作过于频繁”时，等待 5 秒后重试同一请求；
重试仍需遵守配置的请求速率。该明确限流响应是 `friend/add.json` 不自动重试规则的例外。

### 14.2 不自动重试

以下情况不自动重试 `friend/add.json`：

- 请求超时。
- 请求发出后网络断开。
- 页面刷新或标签页关闭。
- 响应不是合法 JSON。
- 无法判断服务端是否已建立关系。

这些情况记为 `ADD_RESULT_UNKNOWN` 并进入防重复账本。

### 14.3 明确失败

HTTP 明确失败或业务码明确拒绝时记为失败，本次任务继续检查下一岗位。是否允许下次任务
再次尝试，应等成功/失败响应样本确认后按业务码白名单处理。

### 14.4 风控边界

- 默认每分钟 45 次请求，不提供无限速选项。
- 首期并发固定为 1。
- 岗位详情或打招呼响应出现 `code=37` 时，保存当前进度并刷新启动任务的标签页。
- 页面重新加载后使用同一个 `runId`、成功数和去重记录继续执行；前三次异常自动重试。
- 第四次出现 `code=37` 时停止任务，并显示“环境异常已超过 3 次”。
- 打招呼接口返回 37 时先释放失败预占，再刷新重试；请求结果未知仍不重试。
- 普通日志隐藏 token、Cookie 和完整认证标识；显式调试模式可记录完整请求 URL 和响应正文，但不记录请求头、Cookie 或 token，且只保存在标签页级临时存储中。

## 15. UI 流程

### 15.1 空闲

```text
配置摘要

[编辑] [一键打招呼]
```

双击摘要可以快速编辑；快速编辑时点击“一键打招呼”只显示“正在编辑”。

### 15.2 运行中

```text
已打招呼 4 / 10
[████████░░░░░░░░░░░░] 40%
已扫描 28 · 重复 6 · 过滤 15 · 失败 3
正在检查：Java 后端工程师 / 示例公司

[暂停]
```

运行中隐藏“编辑”和“一键打招呼”，避免修改当前配置快照或重复启动。

### 15.3 已暂停

```text
已暂停 · 已打招呼 4 / 10
[████████░░░░░░░░░░░░] 40%

[继续]
```

### 15.4 已完成

```text
自动打招呼完成
成功 10 · 重复 8 · 过滤 32 · 失败 1

[返回配置]
```

## 16. 伪代码

```js
async function runAutoGreeting(task) {
  const sourceUrl = await getLatestRecommendedListUrl();
  if (!sourceUrl) throw new Error('请刷新 BOSS 推荐岗位页面后重试');

  while (task.successCount < task.config.greetingCount) {
    await waitWhilePaused(task);

    const candidate = await nextRecommendedCandidate(task);
    if (!candidate) return finishBecauseListExhausted(task);

    const listJobId = normalizeId(candidate.encryptJobId);
    if (isSeenOrStored(listJobId, task)) {
      recordSkip('DUPLICATE_RECORD');
      continue;
    }
    task.seenJobIds.add(listJobId);

    if (task.onlineOnly && candidate.bossOnline !== true) {
      recordSkip('OFFLINE');
      continue;
    }
    if (!matchesSalary(candidate.salaryDesc, task.config)) continue;
    if (!matchesExperience(candidate.jobExperience, task.config)) continue;
    if (matchesCompanyFilter(candidate.brandName, task.config)) continue;

    await waitForRequestRate(task.config.requestRatePerMinute);
    const detail = await fetchDetail({
      securityId: candidate.securityId,
      lid: candidate.lid
    });

    const jobId = normalizeId(detail.zpData.jobInfo.encryptId);
    if (await isStoredOrReserved(jobId) || isExistingRelation(detail, candidate)) {
      recordSkip('DUPLICATE_RELATION');
      continue;
    }

    const filterResult = evaluateDetail(detail, task.config);
    if (!filterResult.accepted) {
      recordSkip(filterResult.reason);
      continue;
    }

    await reserveJobId(jobId, task.runId);

    await waitForRequestRate(task.config.requestRatePerMinute);
    const addResult = await addFriend({
      securityId: detail.zpData.securityId,
      jobId,
      lid: detail.zpData.lid
    });

    if (!addResult.confirmedSuccess) {
      await recordAddFailureOrUnknown(jobId, addResult);
      continue;
    }

    const record = buildJobChatRecord(candidate, detail, addResult, task);
    const nextSuccessCount = task.successCount + 1;
    await upsertRecordCompanyHistoryAndProgress(record, task, nextSuccessCount);
    task.successCount = nextSuccessCount;
  }

  await finishSuccessfully(task);
}
```

## 17. 实施顺序

### 阶段一：配置与只读摘要

1. 增加三个匹配度字段。
2. 增加“每分钟打招呼数”，默认 10。
3. 更新完整编辑、只读摘要和快速编辑。
4. 增加启动前校验和配置快照。

### 阶段二：推荐候选通道

1. 扩展 `boss-hook.js` 捕获最近一次推荐列表请求的完整 URL。
2. 增加 URL 查询消息，并在任务启动前完成捕获校验。
3. 主动分页时只替换 `page`，并遵循 `hasMore` 生命周期。
4. 增加任务 `runId` 和标签页绑定。

### 阶段三：详情和筛选

1. 复用岗位详情页面请求桥接。
2. 为自动流程传入列表 `lid`。
3. 抽取可复用的岗位详情标准化函数。
4. 实现工资、年限、三个匹配度和公司过滤。
5. 输出结构化跳过原因。

### 阶段四：打招呼与防重复

1. 将 `friend/add.json` 加入页面请求白名单。
2. 实现 POST 成功/失败/未知分类。
3. 实现记录、页面关系、批次 Set 和持久化账本四层去重。
4. 实现串行速率限制和成功数量上限。

### 阶段五：落库和进度

1. 实现自动记录构造和公司资料 upsert。
2. 每条成功记录通过后台串行队列立即落库。
3. 实现任务状态、进度条和分类计数。
4. 实现暂停、继续、页面刷新和标签页关闭处理。

### 阶段六：响应样本与安全验证

1. 保存脱敏的 `friend/add.json` 成功响应样本。
2. 保存已沟通过、风控、业务拒绝响应样本。
3. 固化业务码分类。
4. 确认默认招呼语和联系人字段映射。
5. 执行小数量人工验收后再提高上限。

## 18. 验收标准

### 18.1 请求

- 推荐列表只读取 `code === 0` 的 `zpData.jobList`。
- 详情请求使用同一推荐岗位的 `securityId` 和 `lid`。
- 打招呼请求只使用本次详情响应的 `securityId`、`jobInfo.encryptId` 和 `lid`。
- 页面请求使用当前 Cookie、token 和新 traceId。
- 所有请求绑定启动任务的 BOSS 标签页。
- 日志不泄露任何完整凭据。

### 18.2 过滤

- 工资能解析 `40-70K·16薪` 并忽略月数后缀。
- 年限能解析不限、以内、区间和以上。
- 技术、职位正向组分别达到阈值才通过。
- 岗位过滤组达到阈值即淘汰。
- 三组关键字都匹配 `postDescription`。
- 工资只匹配推荐列表的 `salaryDesc`，年限只匹配推荐列表的 `jobExperience`。
- 公司过滤只匹配推荐列表的 `brandName`。
- 空关键字组不会误过滤。
- “仅在线”开启时只有推荐列表的 `bossOnline === true` 才通过。
- “非猎头”开启时，推荐列表的 `goldHunter === 1` 直接跳过。
- 上述四项在岗位详情请求前完成，详情字段不会覆盖判断结果。

### 18.3 防重复

- 同一推荐批次重复 jobId 只处理一次。
- `jobChatRecords` 或 pending 中已有 jobId 时不请求打招呼。
- 页面显示已建立关系时不请求打招呼。
- POST 结果未知时不会自动重发。
- 成功后重新运行不会再次打同一 jobId。

### 18.4 数量与速率

- 只按明确成功数量累计。
- 成功数达到配置上限后立即停止。
- 默认两个 POST 启动间隔不少于 6 秒。
- 同时最多有一个候选处理链路。
- 列表耗尽时正确显示未达到目标的完成结果。

### 18.5 持久化

- 每次成功后、下一候选开始前，记录已经存在于 `jobChatRecords`。
- 岗位、公司和招聘者字段可在总览中读取。
- 公司资料写入现有 `jobChatCompanyProfiles`。
- 正常同步同一关系时能合并自动记录，而不是产生不可识别的第二种模型。
- 安全凭据不进入普通 CSV 和日志。

### 18.6 状态和 UI

- 运行时显示成功进度和分类统计。
- 运行时显示“暂停”。
- 暂停完成后显示“继续”。
- 暂停期间不发起新请求。
- 继续时从剩余候选开始，不重复已成功岗位。
- 切换标签页后侧栏隐藏，切回原标签页可恢复进度。
- 快速编辑状态点击“一键打招呼”不启动任务并提示“正在编辑”。

## 19. 实施前仍需确认的响应信息

请求路径和请求参数已经明确，但以下响应细节未包含在现有样本中，编码前应通过脱敏样本
确认：

1. `friend/add.json` 成功响应的完整字段结构。
2. 已沟通过岗位再次请求时的业务码和响应字段。
3. 成功响应是否包含默认招呼语、消息 ID、关系 ID、数字 friendId。
4. 失败响应中哪些业务码明确表示“服务端未执行”，可以允许用户下次重新尝试。
5. 推荐岗位后续分页复用页面最近一次请求的完整参数，只修改 `page` 和 `_`。

这些信息只影响响应分类和补充字段映射，不改变本文定义的三步主流程、过滤顺序、成功
计数、逐条落库和未知结果不重试原则。
