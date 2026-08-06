# 猎聘推荐岗位批量自动打招呼设计与实施方案

## 1. 文档状态

- 计划日期：2026-08-05
- 更新日期：2026-08-06
- 状态：已实施（首期，仅处理首页推荐接口返回的首屏岗位）
- 参考实现：`zhipin-auto-greeting-plan.md`
- 岗位详情参考：`liepin-job-detail-plan.md`
- 已有联系人自定义消息参考：`liepin_send_msg.md`

本文描述从猎聘求职期望读取推荐岗位、获取岗位详情、执行自动消息配置过滤，并对符合
条件且未沟通过的招聘者调用猎聘默认打招呼接口的完整方案。

本文中的“自动打招呼”与现有“批量发送文本消息”是两条不同链路：

- 推荐岗位自动打招呼调用 `chat.open-chat`，由猎聘服务端创建会话并发送账号当前的默认
  招呼语和职位卡片。
- 已有联系人批量发送自定义文本继续调用 `chat.send-push`，不在本文范围内。

本文同时作为当前首期实现说明。推荐接口分页协议仍缺少真实请求样本，因此当前实现只处理
首屏岗位；其余已确认链路已按本文落地。

## 2. 首期范围

首期包含：

1. 读取猎聘有效求职期望并在自动消息面板中生成“目标职位”选项。
2. 按用户选择的求职期望获取首页推荐岗位。
3. 直接使用推荐列表的薪资、年限、在线状态、公司全称、已沟通状态和本地历史完成前置筛选。
4. 请求 `job.link` 对应的岗位详情，只执行仍依赖详情内容的关键词筛选和记录补全。
5. 对明确匹配的岗位调用 `chat.open-chat`，触发猎聘默认招呼语。
6. 按成功数量上限和每分钟请求速率串行处理。
7. 支持暂停、继续、取消、30 分钟自动暂停、进度和发送结果展示。
8. 成功后写入现有 `JobChatRecord`、公司资料和自动打招呼历史。

首期不包含：

- 通过 `open-chat` 发送自定义正文。
- 图片、文件、简历、微信或手机号交换。
- 多个猎聘账号或多个猎聘标签页并行运行。
- 对结果未知的 `open-chat` 自动重试。
- 猎聘推荐算法之外的主动搜索岗位。

## 3. 当前基础

### 3.1 自动消息面板

当前自动消息面板已经支持 BOSS 自动打招呼所需的配置、运行状态、浮动窗口、暂停继续、
30 分钟时限和发送结果列表。猎聘应复用同一套 UI 与任务状态机，根据当前标签页站点选择
平台适配器。

共享配置继续使用：

```js
{
  salaryMinK,
  salaryMaxK,
  experienceMinYears,
  experienceMaxYears,
  technicalKeywords,
  technicalMatchPercent,
  jobKeywords,
  jobMatchPercent,
  jobFilterKeywords,
  companyFilterKeywords,
  greetingCount,
  requestRatePerMinute
}
```

“仅在线”继续按标签页保存。目标职位必须按站点隔离保存，避免 BOSS 的 `encryptId` 与猎聘
的数字 `expectId` 相互覆盖。建议配置结构为：

```js
{
  targetExpectBySite: {
    boss: { id: "...", name: "Java" },
    liepin: { id: "200129234478", name: "Node.js" }
  }
}
```

兼容旧配置时，可读取现有 `targetExpectId`，但保存后应迁移到站点隔离结构。

### 3.2 猎聘岗位详情能力

现有猎聘岗位同步已经能够：

- 在猎聘登录页面环境中发起请求。
- 请求并解析猎头 `/a/{jobId}.shtml` 与公司 HR `/job/19{jobId}.shtml` 页面。
- 识别岗位暂停、登录跳转和安全验证。
- 标准化岗位、公司和招聘者信息。
- 保存 `jobRef`、`jobInfo` 和 `companyProfile`。

自动打招呼优先使用推荐列表直接返回的 `job.link`，不重新推导详情 URL；详情内容解析和
过滤继续复用 `liepin-job-detail-plan.md` 中的实现。

### 3.3 猎聘消息能力

现有 `liepin_send_msg.md` 已实现针对已有联系人的 `chat.send-push`。本文新增的推荐岗位链路
不依赖联系人列表中的 `oppositeUserId`，因为 `open-chat` 直接使用推荐列表中的
`recruiter.recruiterId`。

推荐响应同时返回：

```text
recruiter.imId          对方 IM ID
recruiter.recruiterId   对方用户 ID，也是 open-chat 的 recruiterId
recruiter.imUserType    对方 IM 用户类型
```

这些字段应在成功记录中持久化，便于后续同步或自定义消息发送。

## 4. 核心原则

1. 所有请求绑定启动任务的猎聘登录标签页，并使用页面当前 Cookie、XSRF Token 和运行时
   请求头。
2. 薪资、年限、在线状态和公司名称只使用推荐列表字段判断，不进入详情页后二次判断或覆盖；
   技术、职位和岗位内容等仍依赖详情的条件使用详情页解析结果。
3. 先做本地重复和列表状态判断，再请求详情；发送前再次检查重复。
4. `chat.open-chat` 是有外部副作用的 POST。响应不明确、超时或连接中断时不自动重试。
5. 成功数量只统计明确成功的 `open-chat`，不统计扫描、详情成功、过滤、跳过或失败。
6. 每次成功后立即保存记录、公司资料和历史，再处理下一岗位。
7. 暂停只阻止下一次请求，不强制撤销已经发出的 `open-chat`。
8. 普通日志不写入 Cookie、XSRF Token、`head_id` 或完整请求头；仅在用户显式开启日志模式时输出完整请求体、响应头和响应体，其中 Cookie 与 XSRF Token 必须脱敏。
9. `send-push` 与 `open-chat` 不得混用：前者发送自定义文本，后者触发默认首次招呼。

## 5. 总体调用链

```text
打开猎聘自动消息面板
  → POST get-valid-expect-info
  → 展示 validExpects 为目标职位单选项
  → 用户选择目标职位并点击“一键打招呼”
  → 固化配置和目标期望快照
  → POST home-recommend-job-new
  → 遍历 data.data
    → 候选去重
    → recruiter.chatted=true：跳过
    → 仅在线且 recruiter.imStatus!==true：跳过
    → 非猎头且 job.jobKind=1：跳过
    → 本地已有发送记录或历史：跳过
    → 使用 job.salary 筛选薪资：不匹配则跳过
    → 使用 job.requireWorkYears 筛选年限：不匹配则跳过
    → 使用 comp.fullCompanyName 筛选公司名称：命中则跳过
    → GET job.link
    → 复用猎聘岗位详情解析
    → 执行技术、职位和岗位内容等详情过滤
    → 发送前再次检查重复
    → POST chat.open-chat
    → 明确成功后保存记录和历史
    → 继续下一岗位，直到达到目标数量或候选耗尽
```

## 6. 请求链路与字段来源

### 6.1 步骤一：获取有效求职期望

请求：

```http
POST https://api-c.liepin.com/api/com.liepin.csearch.pc.get-valid-expect-info
Content-Type: application/x-www-form-urlencoded
```

请求 body 为空。成功要求：

- HTTP 成功。
- 响应 JSON 可解析。
- `flag === 1`。
- `data.validExpects` 是数组。

每个有效期望至少保存：

| 字段 | 用途 |
|---|---|
| `expectId` | 推荐列表的目标期望主键 |
| `expectJobtitle` | 猎聘职位编码 |
| `expectJobtitleName` | UI 单选项标题 |
| `expectDq`、`expectDqName` | 期望地区 |
| `expectMonthSalaryLower` | 期望月薪下限 |
| `expectMonthSalaryUpper` | 期望月薪上限 |
| `expectSalmonths` | 期望薪资月数 |
| `expectIndustry`、`expectIndustryName` | 期望行业 |
| `modifytime` | 期望更新时间 |

UI 使用 `expectJobtitleName` 展示单选项，以字符串形式保存 `expectId`。完整期望对象保留在
任务内存和任务快照中，用于推荐请求的 `selectedExpect`。

`invalidExpects` 不进入可选列表。没有有效期望时禁止启动任务，并提示用户先在猎聘维护
求职期望。

### 6.2 步骤二：获取推荐岗位

请求：

```http
POST https://api-c.liepin.com/api/com.liepin.csearch.home-recommend-job-new
Content-Type: application/json;charset=UTF-8
```

首屏请求体：

```json
{
  "data": {
    "operateKind": "LOGIN",
    "sortType": "PC_HP_NEW",
    "selectedExpect": "{序列化后的完整期望对象，包含 tabTitle}",
    "existFallbackResult": false
  }
}
```

自动消息面板在“岗位来源”下方提供“类型”单选项：

- “最新”为默认值，请求发送 `data.sortType=PC_HP_NEW`。
- “综合”请求发送 `data.sortType=PC_HP_MIX`。

选择保存到 `jobChatAutoMessageConfig.liepinRecommendSortType`，并随任务配置形成快照。任务
运行、限速等待、暂停、刷新重试或取消期间，该选项与目标职位、“仅在线”“非猎头”及
其他配置一起禁用。

构造 `selectedExpect` 时：

1. 复制 `get-valid-expect-info` 返回的原始期望对象。
2. 增加 `tabTitle = expectJobtitleName`。
3. 使用 `JSON.stringify` 生成字符串。
4. 不修改数字字段类型，不手工拼接 JSON。

成功要求：

- HTTP 成功。
- JSON 可解析。
- `flag === 1`。
- `data.data` 是数组。

响应顶层候选结构：

```text
data.data[i].job
data.data[i].recruiter
data.data[i].comp
data.data[i].dataInfo
```

### 6.3 推荐岗位字段映射

#### 岗位字段

| 猎聘字段 | 用途 |
|---|---|
| `job.jobId` | 发送参数、岗位外部 ID、运行中去重 |
| `job.jobKind` | `open-chat` 参数；`1` 通常为猎头，`2` 通常为公司 HR |
| `job.link` | 岗位详情 URL，优先直接使用 |
| `job.title` | 列表展示和详情失败日志 |
| `job.salary` | 薪资范围的唯一筛选数据源和发送结果展示 |
| `job.requireWorkYears` | 年限范围的唯一筛选数据源 |
| `job.requireEduLevel` | 记录回退 |
| `job.dq`、`job.dqCityName` | 地区和记录回退 |
| `job.dataPromId` | 提取 `head_id` |

#### 招聘者字段

| 猎聘字段 | 用途 |
|---|---|
| `recruiter.recruiterId` | `open-chat.recruiterId`、`oppositeUserId` |
| `recruiter.imId` | `oppositeImId` |
| `recruiter.imUserType` | 对方 IM 用户类型 |
| `recruiter.recruiterName` | 记录和结果展示 |
| `recruiter.recruiterTitle` | 记录和结果展示 |
| `recruiter.imStatus` | “仅在线”过滤；只有严格等于 `true` 才视为在线 |
| `recruiter.chatted` | 已沟通过预筛；为 `true` 时不调用 `open-chat` |

#### 公司字段

| 猎聘字段 | 用途 |
|---|---|
| `comp.compName` | 公司简称，仅用于展示回退，不参与公司名称过滤 |
| `comp.fullCompanyName` | 公司名称过滤的唯一数据源和公司全称 |
| `comp.link` | 公司资料地址；空值通常表示猎头岗位 |
| `comp.compId` | 公司资料外部 ID |
| `comp.compIndustry` | 公司行业 |
| `comp.compScale` | 公司规模 |
| `comp.compStage` | 融资阶段 |

`comp.link` 为空只能作为猎头岗位提示，发送参数仍以列表明确返回的 `jobKind` 为准。若
`jobKind`、`job.link` 和 `comp.link` 相互冲突，应记录告警并跳过，不能猜测发送参数。

### 6.4 从 dataPromId 提取 head_id

示例：

```text
d_sfrom=pc_hp_mix&head_id=x5UD...&as_from=pc_hp_mix&job_id=77738975...
```

必须使用 `URLSearchParams` 解析：

```js
const headId = new URLSearchParams(String(job.dataPromId || '')).get('head_id') || '';
```

禁止按固定下标或字符串切割提取。`head_id`、`jobId`、`jobKind`、`recruiterId` 任一缺失时
都不发送。

### 6.5 推荐列表分页

已提供样本只确认首屏请求体和响应中的 `hasNextPage=true`，尚未确认加载下一页时
`operateKind`、游标或其他字段如何变化。

实施前必须补充至少一份滚动加载下一页的真实请求样本。没有确认分页协议前：

- 首期只消费一次真实响应中的 `data.data`。
- 不得重复提交同一首屏 body 假装翻页。
- 不得因为 `hasNextPage=true` 无限请求。
- 候选耗尽时以“推荐岗位已处理完毕”正常结束，即使成功数未达到目标。

确认分页协议后，再把分页请求纳入同一串行限速器，并按 `jobId + recruiterId` 跨页去重。

### 6.6 步骤三：请求岗位详情

优先直接请求：

```http
GET {job.link}
```

要求：

- URL 必须是 HTTPS 且 hostname 为 `liepin.com` 或其子域名。
- 请求绑定当前猎聘标签页登录态。
- 支持暂停前检查和取消信号。
- 复用 `fetchLiepinJobDetail`、`normalizeLiepinJobResponse` 和现有风险识别。
- 命中“职位已暂停招聘”时跳过发送。
- 登录页、安全验证、重定向到非岗位页或解析失败均按详情失败处理。

薪资、年限、在线状态和公司名称必须在发起详情请求前完成筛选。岗位详情成功后，只使用
标准化的 `jobInfo.description` 执行技术关键字、职位关键字、岗位关键字过滤器等仍依赖详情内容的规则，
并补全最终保存的岗位与公司资料；不得用详情页字段重新计算前述四项筛选结果。

### 6.7 步骤四：触发猎聘默认招呼语

请求：

```http
POST https://api-c.liepin.com/api/com.liepin.im.c.chat.open-chat
Content-Type: application/x-www-form-urlencoded
```

body：

```text
head_id={从 job.dataPromId 提取}
&ck_id=
&jobId={job.jobId}
&jobKind={job.jobKind}
&recruiterId={recruiter.recruiterId}
&shieldComp=true
```

字段来源：

| 请求字段 | 来源 |
|---|---|
| `head_id` | `job.dataPromId` 中的 `head_id` |
| `ck_id` | 当前已验证样本为空字符串 |
| `jobId` | `job.jobId` |
| `jobKind` | `job.jobKind` |
| `recruiterId` | `recruiter.recruiterId` |
| `shieldComp` | 固定为字符串 `true` |

请求必须复用猎聘页面当前的：

- Cookie。
- `X-XSRF-TOKEN`。
- `X-Fscp-Std-Info`，当前首页样本 `client_id` 为 `40106`。
- 每次新生成的 `X-Fscp-Trace-Id`。
- `X-Fscp-Bi-Stat`、`Origin`、`Referer` 和其他页面请求上下文。

这些值应由页面现有请求桥接或真实请求模板产生，不能把样本中的 Cookie、Token、时间戳或
trace ID 写死在扩展中。

成功判定至少要求：

- HTTP 成功。
- JSON 可解析。
- `flag === 1`。

根据已验证 HAR，`open-chat` 成功时可能只返回 `{"flag":1,"data":{}}`，但服务端会创建
职位卡片、平台提示和默认招呼语。因此不能要求响应中必须有消息 ID 或消息正文。

### 6.8 默认招呼语正文

`open-chat` 响应不直接返回正文。成功记录需要具体消息内容时，有两个实现阶段：

1. 首期使用稳定回退文案“已发送猎聘默认招呼语”，不臆造账号当前招呼语。
2. 后续可在 `open-chat` 明确成功后请求一次 `chat.chat-list`，使用
   `recruiter.imId` 定位最新的本人出站文本消息并保存真实正文。

若增加 `chat-list` 校验：

- 它只用于读取成功结果，不参与 `open-chat` 成功判定。
- 读取失败不能自动重发 `open-chat`。
- 应优先匹配发送时间附近、本人方向、`msgType=txt`、`payload.ext.extType=1` 的消息。
- 过滤职位卡片、安全提示和系统消息。

## 7. 页面请求桥接

猎聘接口跨 `c.liepin.com`、`api-c.liepin.com` 和 `www.liepin.com`。自动任务应复用现有
content script 与页面主世界请求能力，或新增猎聘专用 page request bridge。

允许的自动任务请求范围仅包含：

```text
POST /api/com.liepin.csearch.pc.get-valid-expect-info
POST /api/com.liepin.csearch.home-recommend-job-new
POST /api/com.liepin.im.c.chat.open-chat
POST /api/com.liepin.im.c.chat.chat-list          # 可选结果读取
GET  https://www.liepin.com/a/*.shtml
GET  https://www.liepin.com/job/*.shtml
```

桥接必须：

- 拒绝非猎聘域名和白名单外路径。
- 使用 `credentials: "include"`。
- 仅接受扩展生成的请求 ID。
- 支持请求取消和响应大小上限。
- 调试日志对 Cookie 与 XSRF Token 做脱敏；日志模式可保留完整请求体（含 `head_id`），用于核对自动打招呼请求。

## 8. 过滤规则

过滤语义与 BOSS 自动打招呼保持一致，避免同一配置在不同平台表现相反。

### 8.1 建议顺序

按成本从低到高处理：

1. 候选结构完整性。
2. 运行中 `jobId + recruiterId` 去重。
3. `recruiter.chatted`。
4. 本地历史和同步记录去重。
5. “仅在线”：只读取 `recruiter.imStatus`。
6. 工资范围：只读取 `job.salary`。
7. 年限范围：只读取 `job.requireWorkYears`。
8. 公司关键字过滤器：只读取 `comp.fullCompanyName`。
9. 请求岗位详情。
10. 岗位暂停或详情无效。
11. 岗位关键字过滤器。
12. 技术关键字匹配度。
13. 职位关键字匹配度。
14. 发送前再次检查重复。
15. 调用 `open-chat`。

### 8.2 仅在线

启用“仅在线”时，只有：

```js
recruiter.imStatus === true
```

才通过。`imShowText` 只用于展示，不用自然语言推断在线状态。`inDay=true` 也不等于当前
在线。

### 8.3 工资和年限

工资和年限全部在推荐列表阶段完成，唯一数据源分别是 `job.salary` 和
`job.requireWorkYears`。进入详情页后不再重新判断。

- 工资按 K/月区间比较，`·N薪` 不参与月薪上下限。
- 配置了工资范围但 `job.salary` 缺失或无法解析时，跳过并记录“推荐列表薪资无法解析”。
- 配置了年限范围但 `job.requireWorkYears` 缺失或无法解析时，跳过并记录“推荐列表年限无法解析”。
- “经验不限”与“年限未设置”沿用 BOSS 方案中的边界规则。

### 8.4 公司名称

公司关键字过滤器只匹配推荐列表的：

```text
comp.fullCompanyName
```

不匹配 `comp.compName`、详情页公司介绍或详情页重新解析出的公司名称。多个过滤关键字仍按
`|` 分隔，忽略大小写，命中任意一个即跳过。`fullCompanyName` 为空时按空字符串处理，不为
补齐公司名称而提前进入详情页。

### 8.5 详情关键词

- 多个关键字使用 `|` 分隔，去空白、去空项、忽略大小写。
- 技术关键字、职位关键字和岗位关键字过滤器都只在详情页
  `[data-selector="job-intro-content"]` 解析出的职位介绍正文中检索，不读取标题、技能标签或公司介绍。
- 技术关键字和职位关键字分别按配置的匹配度判断；岗位过滤关键字命中任意一个即跳过。
- 匹配度公式和取整方式与 `zhipin-auto-greeting-plan.md` 保持一致。

## 9. 防重复设计

### 9.1 列表状态

`recruiter.chatted === true` 表示已经沟通过，直接跳过。不能为了再次发送自定义文本而调用
`open-chat`；已有联系人发消息应使用 `send-push` 功能。

### 9.2 本地记录

在 `jobChatRecords`、`jobChatPendingRecords` 和自动打招呼历史中检查：

```text
siteKey=liepin
jobRef.externalId={job.jobId}
oppositeUserId 或 recruiterId={recruiter.recruiterId}
```

建议自动打招呼历史键：

```text
liepin|{recruiterId}|{jobId}
```

同一招聘者的其他岗位是否允许再次打招呼，仍以最新推荐响应的 `chatted` 为准；若已经建立
联系人关系，必须跳过 `open-chat`。

### 9.3 运行中去重

任务内存维护：

```js
seenCandidateKeys = new Set(); // `${recruiterId}|${jobId}`
reservedCandidateKeys = new Set();
```

发送前先向 background 原子预留历史键。只有预留成功才能调用 `open-chat`。明确失败时释放
预留；结果未知时保留 `uncertain` 历史，禁止自动重试。

### 9.4 POST 成功但落库前中断

采用与 BOSS 方案相同的两阶段历史：

```text
reserved → sent → persisted
              └→ uncertain
```

- 发出请求前写 `reserved`。
- 收到 `flag=1` 后立即写 `sent`。
- 记录和公司资料保存成功后写 `persisted`。
- 超时、页面关闭或响应无法解析时写 `uncertain`。
- `sent`、`persisted`、`uncertain` 都阻止自动再次调用 `open-chat`。

## 10. 数量、速率与并发

### 10.1 成功数量

`greetingCount` 表示明确成功的 `open-chat` 数量。达到目标后停止发起新请求。候选耗尽、用户
取消或达到 30 分钟时限也会停止或暂停，即使成功数未达到目标。

### 10.2 请求速率

`requestRatePerMinute` 默认 25，详情 GET 和 `open-chat` POST 共用同一个限速器。期望列表
请求可视为面板初始化请求；推荐列表请求纳入任务限速器。

```js
intervalMs = Math.ceil(60000 / requestRatePerMinute);
```

每次实际网络请求开始时间至少间隔 `intervalMs`。`chat-list` 结果读取若启用，也纳入同一
限速器。

### 10.3 并发

网络并发固定为 1。尤其禁止并行调用多个 `open-chat`，避免触发风控或难以判定单条结果。

## 11. 任务状态与进度

复用当前自动打招呼状态：

```text
idle → running ⇄ paused
              → completed
              → failed
              → cancelling → cancelled
```

猎聘首期不直接复用 BOSS 的 `code=37` 刷新重试状态。猎聘风控应由
`isLiepinJobRiskControlError` 和接口业务响应单独识别；未确认业务码前，出现验证页或业务
拒绝时暂停任务并提示用户处理页面。

任务快照至少包含：

```js
{
  runId,
  siteKey: "liepin",
  tabId,
  status,
  config,
  selectedExpect,
  startedAt,
  deadlineAt,
  processed,
  succeeded,
  skipped,
  failed,
  totalDiscovered,
  currentJobName,
  statusText,
  sentMessages
}
```

状态面板继续显示目标、成功、已处理、跳过、失败、当前岗位、限速等待和最近发送记录。
发送记录展示公司、岗位、薪资和任务开始日期。

30 分钟后自动变为 `paused`，用户手动继续时重新计算 30 分钟时限。

## 12. 成功后的记录

### 12.1 JobChatRecord

明确成功后构造或合并现有通用记录：

```js
{
  siteKey: "liepin",
  sourceName: "猎聘",
  recruiterName: recruiter.recruiterName,
  recruiterTitle: recruiter.recruiterTitle,
  companyName: normalizedCompanyName,
  lastMessage: actualGreetingText || "已发送猎聘默认招呼语",
  lastTime: sentAt,
  jobRef: {
    siteKey: "liepin",
    externalId: String(job.jobId)
  },
  jobInfo: normalizedJobInfo,
  liepin: {
    jobId: String(job.jobId),
    jobKind: String(job.jobKind),
    jobDetailUrl: job.link,
    oppositeImId: recruiter.imId,
    oppositeUserId: recruiter.recruiterId,
    oppositeImUserType: String(recruiter.imUserType || "2"),
    recruiterId: recruiter.recruiterId,
    headId,
    autoGreeting: true
  }
}
```

`headId` 只在确有后续排查需要时保存；普通 UI 和日志不展示完整值。

### 12.2 公司资料

当 `comp.compId` 或详情页解析到稳定公司 ID 时，复用现有公司资料 upsert。`comp.link` 为空
的猎头岗位不创建虚假的公司资料 ID，但记录仍可保存招聘列表返回的公司展示名称。

### 12.3 sentMessages

成功后向任务的 `sentMessages` 追加：

```js
{
  companyName,
  companyDetail,
  jobName,
  jobDetail,
  salary,
  sentAt
}
```

列表最多保留 100 条历史，UI 可视区域最多显示 8 条并内部滚动。

## 13. 组件职责

### 13.1 自动消息面板

- 根据站点请求猎聘期望列表。
- 展示并保存目标职位。
- 展示并保存“最新/综合”推荐排序类型，默认“最新”。
- 校验配置和目标期望。
- 启动、暂停、继续和取消任务。
- 展示进度、日志和最近发送结果。

### 13.2 Background Service Worker

- 校验启动标签页和单任务约束。
- 保存任务快照、历史预留和最终记录。
- 转发控制消息。
- 处理页面关闭、扩展重载和 30 分钟时限。
- 原子保存记录、公司资料与发送历史。

### 13.3 Content Script

- 运行猎聘候选消费循环。
- 调用页面请求桥接。
- 使用推荐列表执行薪资、年限、在线状态和公司名称过滤，再执行详情标准化及详情关键词过滤。
- 遵守暂停、取消和限速。
- 上报结构化进度，不持久化敏感请求凭据。

### 13.4 猎聘页面请求桥接

- 在页面登录上下文中调用猎聘 API 和详情 URL。
- 生成或复用页面所需 XSRF、Fscp 和 trace 请求头。
- 限制允许访问的域名、路径和方法。
- 返回 HTTP 状态、响应文本和可识别的网络异常。

### 13.5 猎聘适配器

建议新增自动打招呼专用方法：

```text
fetchLiepinExpectList
fetchLiepinRecommendedJobs
normalizeLiepinRecommendedJob
fetchAndNormalizeLiepinRecommendedJobDetail
sendLiepinDefaultGreeting
```

共享过滤器不应包含站点请求逻辑。

## 14. 建议消息协议

```text
JOB_CHAT_AUTO_GREETING_EXPECT_LIST_GET
  panel → background → content
  response: { ok, siteKey, expects, error }

JOB_CHAT_AUTO_GREETING_START
  panel → background → content
  payload: { tabId, config, selectedExpect }

JOB_CHAT_LIEPIN_RECOMMEND_REQUEST
  content → page bridge
  payload: { selectedExpect }

JOB_CHAT_LIEPIN_OPEN_CHAT
  content → page bridge
  payload: { headId, jobId, jobKind, recruiterId }

JOB_CHAT_AUTO_GREETING_RESERVE
  content → background
  payload: { runId, siteKey, candidateKey, jobId, recruiterId }

JOB_CHAT_AUTO_GREETING_SUCCESS
  content → background
  payload: { runId, record, companyProfile, sentItem }

JOB_CHAT_AUTO_GREETING_OUTCOME
  content → background
  payload: { runId, candidateKey, outcome, error }

JOB_CHAT_AUTO_GREETING_PROGRESS
  content → background
  payload: { runId, status, counters, currentJobName, statusText }
```

现有协议可扩展 `siteKey` 后复用，避免为猎聘复制整套面板状态机。

## 15. 错误与重试

### 15.1 可安全重试

以下只读请求在尚未产生副作用时可按有限次数重试：

- 期望列表。
- 推荐岗位列表。
- 岗位详情 GET。
- 成功后的 `chat-list` 结果读取。

仅重试明确的网络瞬断、HTTP 429/5xx 或可识别的临时失败。每次重试前检查暂停和取消。

### 15.2 不自动重试

以下情况不自动重试 `open-chat`：

- 请求已经写出但连接中断。
- 请求超时。
- HTTP 响应体为空或无法解析。
- 页面在请求期间关闭或刷新。
- 返回未知业务结果。

这些情况标记 `uncertain` 并进入失败计数，由用户人工核对联系人列表。

### 15.3 明确失败

`open-chat` 返回合法 JSON 且 `flag !== 1` 时为明确失败。是否释放预留取决于业务码：

- 明确表示未发送，可释放预留，但本轮不自动重试。
- 明确表示已经沟通过，按跳过处理并保留历史。
- 风控、验证或频繁操作，暂停整批任务。
- 未知业务码，按 `uncertain` 处理。

实施前需收集脱敏的失败、已沟通过和频繁操作响应样本，建立业务码表。

## 16. 伪代码

```js
async function runLiepinAutoGreeting(run) {
  const candidates = await fetchLiepinRecommendedJobs(run.selectedExpect);

  for (const candidate of candidates) {
    await waitWhilePaused(run);
    assertNotCancelled(run);
    assertWithinDeadline(run);

    const { job, recruiter } = candidate;
    const candidateKey = `${recruiter.recruiterId}|${job.jobId}`;

    if (!isValidCandidate(candidate)) skip("推荐岗位字段不完整");
    if (seen.has(candidateKey)) skip("本轮重复岗位");
    seen.add(candidateKey);
    if (recruiter.chatted === true) skip("已与招聘者沟通过");
    if (run.onlineOnly && recruiter.imStatus !== true) skip("招聘者不在线");
    if (await hasLocalGreeting(candidate)) skip("本地已有沟通记录");
    if (!matchesSalary(job.salary, run.config)) skip("薪资范围不匹配");
    if (!matchesExperience(job.requireWorkYears, run.config)) skip("年限范围不匹配");
    if (matchesCompanyFilter(candidate.comp.fullCompanyName, run.config)) {
      skip("命中公司关键字过滤器");
    }

    await limiter.wait();
    const detail = await fetchLiepinJobDetail(job.link);
    const normalized = normalizeLiepinJobResponse(detail, candidate);
    const reason = filterLiepinDetailKeywords(normalized, run.config);
    if (reason) skip(reason);

    const reservation = await reserve(candidateKey);
    if (!reservation.ok) skip("发送记录已存在");

    let result;
    try {
      await limiter.wait();
      result = await openLiepinChat({
        headId: parseHeadId(job.dataPromId),
        jobId: job.jobId,
        jobKind: job.jobKind,
        recruiterId: recruiter.recruiterId
      });
    } catch (error) {
      await markUncertain(candidateKey, error);
      fail(error);
      continue;
    }

    if (result.flag !== 1) {
      await recordKnownFailure(candidateKey, result);
      fail(result);
      continue;
    }

    await markSent(candidateKey);
    await persistGreetingRecord(candidate, normalized, result);
    await markPersisted(candidateKey);
    succeed(candidate);

    if (run.succeeded >= run.config.greetingCount) break;
  }
}
```

## 17. 实施顺序

### 阶段一：期望岗位与 UI

- 增加猎聘期望列表请求。
- 目标职位按站点隔离保存。
- 校验无有效期望和未选择期望场景。

### 阶段二：推荐候选适配器

- 实现首屏推荐请求和响应标准化。
- 增加薪资、年限、在线状态、公司全称、已沟通、字段完整性和运行中去重筛选。
- 收集并确认下一页请求样本。

### 阶段三：详情与共享过滤

- 直接使用 `job.link` 请求详情。
- 复用猎聘详情解析和公共过滤器。
- 覆盖猎头、公司 HR、职位暂停和详情失败样本。

### 阶段四：open-chat 与防重复

- 实现严格白名单页面请求。
- 增加 `head_id` 解析和发送参数校验。
- 实现 reserved/sent/persisted/uncertain 历史。
- 不对未知结果自动重试。

### 阶段五：记录与状态面板

- 成功后保存记录、公司资料和 IM 字段。
- 接入现有进度、暂停继续、30 分钟时限和 sentMessages。
- 可选接入 `chat-list` 获取真实默认招呼语。

### 阶段六：真实账号小批量验证

- 先以目标数量 1、低速率验证。
- 验证猎头和公司 HR 各一条。
- 验证在线过滤、已沟通过、重复启动和结果未知处理。
- 确认业务失败和风控响应后再扩大数量。

## 18. 验收标准

### 18.1 请求

- 面板能读取并展示 `validExpects`。
- 选择不同期望时，推荐请求中的 `selectedExpect.expectId` 正确。
- 默认排序发送 `sortType=PC_HP_NEW`，选择“综合”后发送 `sortType=PC_HP_MIX`。
- `head_id`、`jobId`、`jobKind` 和 `recruiterId` 均来自同一推荐候选。
- 不把样本 Cookie、XSRF Token、trace ID 写死。
- 非猎聘域名和白名单外请求被拒绝。

### 18.2 过滤

- `imStatus=true` 才通过“仅在线”。
- `chatted=true` 不调用 `open-chat`。
- 工资只读取 `job.salary`，年限只读取 `job.requireWorkYears`。
- 在线状态只读取 `recruiter.imStatus`，公司名称过滤只读取 `comp.fullCompanyName`。
- “非猎头”开启时只根据推荐列表 `job.jobKind=1` 跳过猎头岗位。
- 进入详情页后不重新判断或覆盖上述四项结果。
- 技术、职位和岗位内容过滤使用岗位详情，并与 BOSS 语义一致。
- 职位暂停或详情无效不发送。

### 18.3 防重复

- 相同 `recruiterId + jobId` 在单次运行中只处理一次。
- 本地已有记录或历史时不发送。
- POST 结果未知时不会自动重试。
- 成功但落库前中断时，下次启动不会重复发送。

### 18.4 数量与速率

- 只按明确成功的 `open-chat` 增加成功数。
- 达到目标数量后不再请求详情或发送。
- 推荐、详情、发送和可选结果读取遵守串行限速。
- 30 分钟后暂停，继续后重新计时。

### 18.5 持久化与 UI

- 成功后写入通用猎聘记录和公司资料。
- 保存 `oppositeImId`、`oppositeUserId` 和 `oppositeImUserType`。
- 状态面板持续显示，不在任务结束时自动关闭。
- 已发送列表展示公司、岗位、薪资和任务日期，最多显示 8 条并可滚动。
- 暂停、继续、取消和浮动/停靠不丢失任务状态。
- 任务执行和等待期间不能修改目标职位、排序类型、“仅在线”“非猎头”或双击编辑条件。

## 19. 实施前仍需确认

1. `home-recommend-job-new` 第二页及后续页的真实请求 body、游标和终止条件。
2. `open-chat` 对“已沟通过”“达到次数限制”“操作频繁”“账号受限”的响应样本。
3. `open-chat` HTTP 成功但 `flag !== 1` 时各业务码是否明确未发送。
4. 默认招呼语是否始终由服务端自动写入，还是受账号设置或岗位类型影响。
5. 同一招聘者不同岗位的 `chatted` 状态是否始终一致。
6. `ck_id` 在其他入口或分页候选中是否仍为空。
7. `shieldComp=true` 的业务含义及是否需要根据岗位类型变化。
8. 是否需要把成功后的 `chat-list` 作为首期必选步骤，以保存真实消息正文。
