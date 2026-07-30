# 猎聘岗位信息同步实施方案与当前状态

## 1. 文档状态

- 计划日期：2026-07-29
- 最近更新：2026-07-29
- 状态：主体实现完成
- 参考实现：现有 BOSS 岗位详情同步
- 本文范围：猎聘岗位预览、详情页、公司资料、同步进度和请求日志
- 剩余事项：HR 公司区块及岗位关键词仍需更多真实 HTML 样本验证

## 2. 目标

在保留猎聘沟通记录同步能力的基础上，将猎聘接入通用岗位同步架构：

1. 从联系列表识别公司 HR 和猎头。
2. 从 `job-preview` 获取岗位 ID 及岗位基础信息。
3. 根据联系人类型构造正确的岗位详情地址。
4. 请求并解析猎聘岗位详情 HTML。
5. 将岗位数据映射到通用 `jobRef`、`jobInfo`。
6. 将具备稳定公司 ID 的公司资料保存到独立公司资料存储。
7. 支持同步页缺失补齐、暂停恢复和总览页强制刷新。
8. 单条失败不阻断整批任务。
9. 将“无关联岗位”和“职位已暂停招聘”作为可成功完成的业务状态。
10. 在猎聘同步页分类显示沟通记录和岗位信息进度。
11. 记录猎聘同步中的全部 HTTP 请求、响应及异常。

## 3. 当前实现

### 3.1 复用的公共能力

- `job-sync-core.js`
  - 顺序同步。
  - 请求间隔。
  - 取消和停止。
  - 成功、失败和跳过状态。
  - 公司资料保存回调。
- `site-adapters.js`
  - 站点适配器注册和查询。
- `shared-records.js`
  - `jobRef`、`jobInfo` 规范化。
  - 岗位完整性判断。
- `background.js`
  - 公司资料独立保存。
  - 总览页强制刷新。
  - 同步状态和分类进度持久化。
- `results.js`
  - 通用岗位信息展示。
  - 同步页分类进度。
  - 岗位详情强制刷新。
  - 请求日志查看。

### 3.2 猎聘适配器

猎聘已经注册为：

```text
supportsJobDetail: true
requiresDetailAccessToken: false
```

已实现以下适配器接口：

```text
resolveLiepinJobAccess(record, context, options)
fetchLiepinJobDetail(jobRef, access, options)
normalizeLiepinJobResponse(payload, jobRef, access)
isLiepinJobRiskControlError(error)
```

### 3.3 通用凭证契约

所有站点均要求 `jobRef.externalId`。是否要求
`jobRef.detailAccessToken` 由适配器的 `requiresDetailAccessToken`
声明：

- BOSS 继续严格要求岗位详情访问凭证。
- 猎聘不要求访问凭证，详情地址由 `jobId` 和联系人类型构造。
- 不使用“把详情 URL 写入 token”之类的伪兼容方案。

## 4. 调用链

```text
用户开始同步猎聘
  → prepareLiepinSync
    → POST get-contact-list
    → 应用时间范围、忽略记录和同步类型筛选
    → 检查消息变化及岗位状态
    → 固化本轮待处理联系人快照
    → 写入沟通记录/岗位信息分类总数
  → extractLiepinChatRecords
    → POST job-preview
    ├─ flag=1 且 data 无 jobId
    │   → jobPreviewStatus=empty
    │   → 标记成功
    │   → 跳过详情请求
    └─ 返回有效 jobId
        → 保存岗位预览和猎聘平台上下文
        → JobDetailSyncSession.syncRecord
          → resolveLiepinJobAccess
            → 校验 jobId
            → 根据 homePage 判断 HR/猎头
            → 使用 jobKind 交叉校验
            → 构造详情 URL
          → 按 2 秒间隔调度
          → fetchLiepinJobDetail
            → GET 详情 HTML
            → 校验 HTTP、跳转、登录和安全验证
          → normalizeLiepinJobResponse
            ├─ 命中 .apply-stop-title
            │   → 保留预览和已有岗位内容
            │   → 追加“该职位已暂停招聘”
            │   → 标记成功
            └─ 正常详情页
                → 解析岗位和公司区块
                → 映射 jobRef、jobInfo、companyProfile
          → 保存单条结果和公司资料
    → 更新分类进度
    → 部分保存
```

总览页强制刷新复用同一适配器调用链，策略为 `force`。

## 5. 联系列表

请求：

```text
POST https://api-c.liepin.com/api/com.liepin.im.c.contact.get-contact-list
```

岗位同步使用以下联系人字段：

| 字段            | 用途                           |
| --------------- | ------------------------------ |
| `imId`          | `job-preview` 请求             |
| `oppositeImId`  | `job-preview` 请求和联系人匹配 |
| `homePage`      | 判断公司 HR 或猎头             |
| `company`       | 公司名称回退                   |
| `latestMsgId`   | 消息增量判断                   |
| `latestMsgTime` | 时间范围过滤                   |
| `oppositeRead`  | 消息状态变化判断               |

联系人分类使用 URL pathname：

```text
/company/{id}/ → hr
/hunter/{id}   → hunter
其他           → unknown
```

解析允许协议、查询参数和尾斜杠变化。无法分类时不猜测详情 URL。

## 6. 岗位预览

请求：

```text
POST https://api-c.liepin.com/api/com.liepin.im.c.chat.job-preview
```

当前请求参数：

```text
imUserType=0
imId={contact.imId 或当前登录 imId}
imApp=1
oppositeImId={contact.oppositeImId}
```

对照猎聘官方 IM 前端脚本已经确认：

- 核心业务参数为当前联系人的 `oppositeImId`。
- `imUserType` 固定为求职者类型。
- 当前实现没有遗漏必须字段。
- `imId` 与 `oppositeImId` 没有传反。

### 6.1 有岗位的预览

| 预览字段      | 通用字段或用途                   |
| ------------- | -------------------------------- |
| `jobId`       | `jobRef.externalId`              |
| `jobKind`     | URL 路由交叉校验                 |
| `jobTitle`    | `jobInfo.title` 回退、`jobName`  |
| `jobDqName`   | `jobInfo.location` 回退          |
| `reqWorkYear` | `jobInfo.experience` 回退        |
| `reqEdu`      | `jobInfo.education` 回退         |
| `jobSalary`   | `jobInfo.salary` 回退、`jobName` |
| `jobCompany`  | `companyName` 回退               |
| `compStage`   | 平台上下文；通用模型暂无独立字段 |

`record.liepin` 保存：

```json
{
  "jobId": "82933035",
  "jobKind": "2",
  "contactType": "hr",
  "jobDetailUrl": "https://www.liepin.com/job/1982933035.shtml",
  "jobPreviewStatus": "available",
  "homePage": "https://www.liepin.com/company/434237/"
}
```

`jobRef.externalId` 始终保存原始 `jobId`，不包含 HR URL 使用的
`19` 前缀。

### 6.2 无关联岗位

以下响应是合法业务结果，并非缺少请求字段：

```json
{
  "flag": 1,
  "data": {}
}
```

处理规则：

- 设置 `record.liepin.jobPreviewStatus = "empty"`。
- 设置 `jobInfo.fetchStatus = "success"`。
- 写入当前 `fetchedAt`，清空错误信息。
- 岗位字段使用空值或已有值。
- 不构造详情 URL。
- 不发出岗位详情 GET。
- 本轮岗位同步按成功计数。
- 普通同步不因缺少 `jobId` 反复入队。
- 联系人消息或消息状态变化时重新检查岗位预览。
- 总览页强制刷新时允许再次检查。
- “岗位详情未同步”筛选不包含该类记录。

请求失败与“请求成功但 `data={}`”必须严格区分：

- HTTP、网络或业务失败：`jobPreviewStatus="failed"`。
- `flag=1,data={}`：`jobPreviewStatus="empty"`，同步成功。

## 7. HR/猎头详情 URL

### 7.1 公司 HR

判据：

```text
homePage.pathname 以 /company/ 开头
```

地址：

```text
https://www.liepin.com/job/19{jobId}.shtml
```

例如：

```text
jobId=82933035
→ https://www.liepin.com/job/1982933035.shtml
```

### 7.2 猎头

判据：

```text
homePage.pathname 以 /hunter/ 开头
```

地址：

```text
https://www.liepin.com/a/{jobId}.shtml
```

### 7.3 校验规则

- `flag=1,data={}`：按无关联岗位成功处理。
- 声称存在岗位但 `jobId` 为空或格式非法：失败，不发详情请求。
- `homePage` 无法分类：失败，不猜测 URL。
- `homePage` 与 `jobKind` 冲突：以 `homePage` 为主并记录告警。
- 当前样本中猎头为 `jobKind="1"`，HR 为 `jobKind="2"`。

### 7.4 猎聘标签页选择

详情刷新查询所有猎聘 HTTPS 子域名：

```text
https://*.liepin.com/*
```

该规则覆盖：

- `https://c.liepin.com/*`
- `https://www.liepin.com/*`
- 其他猎聘子域名

不能只查询 `www.liepin.com`，否则用户已经打开并登录
`c.liepin.com` 时会误报“没有打开猎聘标签页”。

## 8. 详情请求

```text
GET {jobDetailUrl}
credentials: include
redirect: follow
Accept: text/html,application/xhtml+xml
```

请求层支持 `AbortSignal`，并识别：

- HTTP 非 2xx。
- 403、429 等限流响应。
- 登录、验证码或安全检查页面。
- 响应不是 HTML。
- 最终重定向 URL。
- 未知页面缺少岗位主容器。

职位停招页面由业务解析器单独处理，不作为 HTTP 或 DOM 解析失败。

## 9. HTML 解析

使用 `DOMParser` 解析响应字符串，不把 HTML 注入当前页面。所有选择器限制在
目标岗位主区域，避免误读推荐岗位。

### 9.1 正常详情页

已由猎头样本验证：

| 数据             | 选择器或规则                                                  |
| ---------------- | ------------------------------------------------------------- |
| 标题             | `.job-apply-container .name-box > .name`                      |
| 薪资             | `.job-apply-container .salary`                                |
| 地点、经验、学历 | `.job-properties` 直属 `span`，排除分隔符、招聘人数和更新时间 |
| 岗位正文         | `.job-intro-container [data-selector="job-intro-content"]`    |
| 其他信息         | `.job-intro-container .paragraph`                             |
| 页面岗位校验     | `.job-apply-container [data-jobId][data-jobKind]`             |

正常页面必须同时具有：

- `.job-apply-container`
- `.job-intro-container`

未命中停招标识且缺少任意主容器时，返回
`detail_selector_missing`，不能从推荐岗位卡片降级解析。

### 9.2 职位暂停招聘

实际响应样本已确认停招页面包含：

```html
<span class="apply-stop-title">该职位已暂停招聘</span>
```

页面同时具有以下特征：

- 页面类型为 `www/job-expired`。
- 加载 `pages/job-expired.*.js`。
- 不包含 `.job-apply-container`。
- 不包含 `.job-intro-container`。
- 页面中的岗位卡片均为“猜你喜欢”的推荐职位。

处理规则：

1. 在正常主容器校验之前检测 `.apply-stop-title`。
2. 使用 `job-preview` 的标题、地点、经验、学历和薪资。
3. 如果已有岗位正文、分类、地址和技能，继续保留。
4. 在 `jobInfo.description` 末尾追加“该职位已暂停招聘”。
5. 重复刷新时不得重复追加该说明。
6. 不读取推荐职位。
7. 不生成伪造公司资料。
8. 返回完整 `jobInfo`，由通用核心标记
   `fetchStatus="success"`。

### 9.3 公司区块

目标选择器：

- `.company-info-container`
- `.company-intro-container`

处理规则：

1. 不读取推荐职位中的 `.job-detail-company-box`。
2. 从 `/company/{id}/` 链接提取稳定公司 ID。
3. 公司名称优先取详情页，回退到 `job-preview.jobCompany`。
4. 行业和规模按标签文本映射。
5. 公司简介合并两个区块并按段落去重。
6. 缺少稳定公司 ID 时不写入 `jobChatCompanyProfiles`。
7. 沟通记录仍保留 `companyName`。

当前猎头和停招样本均未提供完整正常 HR 公司区块，因此 HR 公司字段仍需真实
样本验证。

### 9.4 岗位关键词

用户最初指出关键词位于 `.labels`，但已提供的猎头样本中
`.recruiter-container .labels` 属于招聘方且为空。

当前规则：

- 只有岗位主区域内的 `.labels` 才能映射到 `skills`。
- 不把招聘方标签映射为岗位技能。
- 空标签数组是合法结果。
- 上线完整关键词解析前需要一个关键词非空的 HR 或猎头详情样本。

## 10. 数据映射

### 10.1 通用岗位

正常详情页值优先，`job-preview` 作为回退：

| 通用字段                   | 猎聘来源                 |
| -------------------------- | ------------------------ |
| `jobRef.externalId`        | `job-preview.jobId`      |
| `jobRef.detailAccessToken` | 空                       |
| `jobInfo.title`            | 详情标题 → `jobTitle`    |
| `jobInfo.category`         | 页面职位职能 → 空字符串  |
| `jobInfo.location`         | 页面地点 → `jobDqName`   |
| `jobInfo.experience`       | 页面经验 → `reqWorkYear` |
| `jobInfo.education`        | 页面学历 → `reqEdu`      |
| `jobInfo.salary`           | 页面薪资 → `jobSalary`   |
| `jobInfo.description`      | 岗位正文或停招说明       |
| `jobInfo.address`          | 页面工作地址 → 空字符串  |
| `jobInfo.skills`           | 岗位主区域关键词         |
| `jobInfo.fetchStatus`      | 通用核心写入             |
| `jobInfo.fetchedAt`        | 当前 ISO 时间            |
| `jobInfo.errorMessage`     | 成功为空，失败写错误原因 |

特殊映射：

| 状态                | 结果                                             |
| ------------------- | ------------------------------------------------ |
| `flag=1,data={}`    | `jobPreviewStatus="empty"`、同步成功、不请求详情 |
| `.apply-stop-title` | `description` 追加停招说明、同步成功             |

### 10.2 公司资料

存在稳定公司 ID 时生成：

```json
{
  "companyKey": "liepin|434237",
  "siteKey": "liepin",
  "externalId": "434237",
  "name": "BYD",
  "employeeScale": "页面规模",
  "industry": "页面行业",
  "description": "合并并去重后的公司简介"
}
```

`compStage` 当前只保存在猎聘预览上下文，不扩展公共公司模型。若产品需要展示，
再评审是否为所有平台增加 `financingStage`。

## 11. 同步选择和保存

### 11.1 待同步筛选

普通同步的入队条件：

```text
新联系人
或 最新消息变化
或 消息状态变化
或 岗位信息不完整
```

例外：

```text
jobPreviewStatus="empty"
且 jobInfo.fetchStatus="success"
```

该状态表示岗位预览已经成功确认无关联岗位，不因缺少
`jobRef.externalId` 重复入队。

### 11.2 暂停恢复

- 准备阶段固化联系人和待处理原因。
- 每个待处理联系人只请求一次 `job-preview`。
- 暂停后保留首次准备的剩余队列。
- 恢复时不重新处理已成功保存的记录。
- 已处理的空岗位预览和停招岗位都属于成功记录。

### 11.3 限速

- 详情请求由 `JobDetailSyncSession` 顺序执行。
- 默认详情请求间隔为 2 秒。
- 猎聘不继承 BOSS 的“每 4 次详情请求刷新页面”规则。
- 猎聘当前将 `maxRequestsPerPage` 设置为足够大的值。
- 后续根据 403/429 数据再决定是否增加猎聘专属限制。

### 11.4 部分保存

每处理一条后保存：

- 沟通记录。
- `jobRef`。
- `record.liepin` 平台上下文。
- 成功或失败的 `jobInfo`。
- 独立公司资料。
- 同步分类统计。

中断、单条失败或公司资料缺失不能丢失此前完成的数据。

## 12. 同步页分类进度

猎聘同步准备和执行期间显示：

```text
沟通记录：completed / total
岗位信息：completed / total
```

准备阶段写入：

```text
progressCategories.communication.total
progressCategories.jobDetail.total
```

执行阶段持续上报：

```text
progressCategories.communication.completed
progressCategories.jobDetail.completed
```

规则：

- 新增沟通记录和消息更新计入沟通记录进度。
- 正常详情成功或失败均完成一个岗位处理项。
- 空岗位预览按岗位成功完成计数。
- 停招页面按岗位成功完成计数。
- 已有空岗位联系人如果本轮仅消息变化，只计入沟通记录进度。
- 结果页对 `siteKey="boss"` 和 `siteKey="liepin"` 都显示分类进度。
- BOSS 专属的“自动刷新 zhipin.com 标签页”备注不在猎聘页面显示。

## 13. 请求日志

猎聘同步记录每次 HTTP 请求、响应和网络异常：

```text
getContactList:request
getContactList:response
jobPreview:request
jobPreview:response
jobPreview:empty
jobPreview:validationError
jobDetail:request
jobDetail:response
对应的 networkError
```

日志内容：

- 请求方法和 URL。
- 表单 body 和结构化 params。
- 显式请求头。
- HTTP 状态和状态文字。
- 最终响应 URL。
- 响应头。
- 完整 JSON 响应。
- 完整岗位详情 HTML。
- 业务校验上下文和异常信息。

日志实现约束：

- 不记录浏览器隐式附加的完整 Cookie。
- 通过运行时消息实时发送到当前结果页，仅保存在页面内存中。
- 不写入 `chrome.storage.local`，不提供历史日志。
- 准备同步开始时清空结果页内存中的上次日志。
- 从准备阶段进入正式同步时不再次清空。
- 当前任务最多保留最近 1000 条日志。
- 结果页关闭或刷新后日志丢失。
- 日志消息发送失败时写入控制台，不再完全静默。

## 14. 错误和业务状态

| 类别/状态                 | 处理                                   |
| ------------------------- | -------------------------------------- |
| `preview_failed`          | 岗位预览 HTTP、网络或业务失败          |
| `job_preview_empty`       | 预览成功但无关联岗位；成功             |
| `job_id_missing`          | 非空岗位响应缺少有效 `jobId`           |
| `contact_type_unknown`    | 无法从 `homePage` 分类                 |
| `contact_type_conflict`   | `homePage` 与 `jobKind` 冲突，记录告警 |
| `detail_http_failed`      | 详情页 403、404、429、5xx              |
| `auth_required`           | 登录或安全验证                         |
| `risk_control`            | 验证码或访问频率限制                   |
| `detail_selector_missing` | 未知页面缺少正常岗位主容器             |
| `job_expired`             | 命中 `.apply-stop-title`；成功         |
| `company_parse_skipped`   | 无稳定公司 ID；不影响岗位成功          |

## 15. 测试计划

### 15.1 纯函数和 HTML 夹具

1. `homePage` 的 HR、猎头、异常 URL 分类。
2. HR 和猎头详情 URL 构造。
3. `jobKind` 冲突行为。
4. 预览字段到通用结构的映射。
5. 详情值优先、预览值回退。
6. 文本清洗、段落保留和技能去重。
7. 公司简介两区块合并去重。
8. `flag=1,data={}` 标记成功且不请求详情。
9. `.apply-stop-title` 保留已有正文并只追加一次停招说明。
10. 停招页和未知页不得读取推荐岗位。

HTML 和响应夹具至少包括：

- 正常猎头详情页。
- 正常 HR 详情页。
- 关键词非空的详情页。
- 职位暂停招聘页。
- 普通 404 页。
- 登录或安全验证页。
- `job-preview` 有岗位响应。
- `job-preview` 空 `data` 响应。

### 15.2 集成测试

1. 新联系人完成“联系列表 → 预览 → 详情 → 保存”。
2. 已有记录消息未变化但岗位缺失时仍补齐。
3. 岗位完整记录在同步页跳过详情请求。
4. 空岗位预览成功保存且后续普通同步不反复入队。
5. 停招页追加说明并标记成功。
6. 总览页强制刷新重新请求岗位预览和详情。
7. 单条失败后继续下一条。
8. 暂停后不发新请求，恢复后从剩余记录继续。
9. 同一公司多个岗位维护同一个 `liepin|companyId`。
10. 猎头页没有公司 ID 时岗位仍可成功保存。
11. `c.liepin.com` 可以被详情刷新流程选择。
12. 猎聘同步页显示两类进度且数值不超总数。
13. 从准备到正式同步的全部请求和响应均保留。
14. BOSS 同步、展示和强制刷新不回归。

### 15.3 手工验收

- 分别同步一个公司 HR 和猎头联系人。
- 核对 URL 分别为 `/job/19{jobId}.shtml` 和 `/a/{jobId}.shtml`。
- 核对标题、地点、经验、学历、薪资、正文和关键词。
- 核对 HR 公司名称、行业、规模、简介和 `companyKey`。
- 验证空岗位预览显示成功且不请求详情。
- 验证停招岗位显示“该职位已暂停招聘”。
- 验证同步页沟通记录和岗位信息进度。
- 验证请求日志包含联系列表、岗位预览和详情页。
- 检查暂停恢复、失败提示、总览展示和 JSON 导出。

## 16. 实施阶段状态

### 阶段 0：样本和通用契约

- [已完成] 分析联系列表和岗位预览响应。
- [已完成] 分析正常猎头详情页。
- [已完成] 分析职位暂停招聘页。
- [已完成] 修正 `detailAccessToken` 适配器契约。
- [待补充] 正常 HR 公司区块和关键词非空样本。

### 阶段 1：平台上下文

- [已完成] 持久化 `jobId`、`jobKind`、`contactType`、`jobDetailUrl`。
- [已完成] 映射岗位预览回退数据。
- [已完成] 将岗位不完整记录纳入同步。
- [已完成] 增加空岗位预览成功状态和防重复入队规则。

### 阶段 2：详情适配器

- [已完成] HR/猎头分类和 URL 构造。
- [已完成] HTML 请求、取消、HTTP、登录和风控校验。
- [已完成] 正常猎头详情解析。
- [已完成] 停招页面识别和成功映射。
- [已完成] 注册 `supportsJobDetail: true`。
- [待验证] 正常 HR 公司资料精确解析。

### 阶段 3：同步流程

- [已完成] 接入 `JobDetailSyncSession`。
- [已完成] 部分保存和暂停恢复。
- [已完成] 猎聘独立限速策略。
- [已完成] 公司资料独立 upsert。
- [已完成] 同步页分类进度。

### 阶段 4：总览和可观测性

- [已完成] 总览页猎聘强制刷新。
- [已完成] `c.liepin.com` 标签页支持。
- [已完成] 全部猎聘请求和响应日志。
- [已完成] 空岗位和停招状态展示。
- [已完成] 空岗位从“岗位详情未同步”筛选中排除。

### 阶段 5：测试和灰度

- [进行中] 使用真实账号进行小批量验证。
- [待完成] 补充自动化纯函数、夹具和集成测试。
- [待观察] 403、429、解析失败率和平均耗时。
- [待同步] 在实现稳定后更新 `docs/liepin.md` 和 `docs/dataModel.md`。

## 17. 验收标准

1. 公司 HR 和猎头能构造正确详情 URL。
2. `jobId` 始终保存原始值，不混入 HR 的 `19` 前缀。
3. 正常详情成功后通用岗位字段完整。
4. 详情失败时预览数据不丢失，且不阻断批次。
5. 岗位缺失但消息未变化的已有记录能够补齐。
6. `flag=1,data={}` 标记成功、不请求详情、不反复入队。
7. `.apply-stop-title` 页面保留岗位数据、追加说明并标记成功。
8. 无稳定公司 ID 时不生成伪 `companyKey`。
9. `c.liepin.com` 可以执行猎聘详情刷新。
10. 暂停、恢复和部分保存行为正确。
11. 猎聘不继承 BOSS 的 token、错误码和每 4 次刷新策略。
12. 猎聘同步页分别显示沟通记录和岗位信息进度。
13. 分类进度完成数不得大于总数。
14. 联系列表、岗位预览和详情请求、响应均可追踪。
15. BOSS 现有同步功能无回归。

## 18. 剩余待确认事项

以下事项不阻塞当前主体功能，但影响 HR 公司资料和关键词解析完整性：

1. 提供包含 `.company-info-container` 和
   `.company-intro-container` 的正常 HR 详情页 HTML。
2. 提供岗位关键词 `.labels` 非空的样本，确认其父容器。
3. 使用更多联系人确认 `/company/` 与 `jobKind=2`、
   `/hunter/` 与 `jobKind=1` 的稳定对应关系。
4. 确认 `compStage` 是否需要成为可展示和导出的通用公司字段。
