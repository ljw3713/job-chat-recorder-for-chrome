# 通用岗位信息同步重构方案

## 1. 文档状态

- 方案日期：2026-07-27
- 更新日期：2026-07-29
- 状态：已按方案完成主体重构，并持续补充同步稳定性处理
- 首个实现平台：BOSS 直聘
- 后续目标平台：猎聘及其他招聘网站

本方案允许完全重构现有岗位信息同步代码，删除旧接口、旧字段、旧解析逻辑和重复流程，不考虑旧岗位数据结构的兼容。

聊天记录、发送凭据和联系人内部字段不属于本次岗位信息重构范围，必须保持功能正常。

## 2. 重构目标

1. 使用通用岗位数据结构，核心代码不依赖 BOSS 专属字段名。
2. 使用网站适配器隔离 BOSS、猎聘等平台的请求和字段映射。
3. BOSS 岗位详情改为请求 JSON 接口，不再解析 HTML。
4. 岗位详情请求固定按 2 秒一个请求调度。
5. 同步页只同步新增记录及岗位信息缺失的已有记录。
6. 总览页对用户选中的记录执行岗位信息全量刷新。
7. 公司资料独立存储，不嵌入聊天总记录。
8. 同步页和总览页共用同一套岗位同步核心。
9. JSON 输出完整岗位信息；CSV 不导入导出岗位信息。
10. 删除所有旧岗位字段兼容、旧 HTML 解析和无调用方代码。
11. 每完成 4 次岗位详情请求后刷新最近使用的 BOSS 标签页，刷新完成前阻塞后续请求。
12. 同步页暂停后保留首次获取的待更新列表，并从剩余记录继续同步。

## 3. 不在本次范围内

- 猎聘岗位详情接口的实际接入。
- 岗位信息自动定时刷新。
- 公司资料管理页面。
- 公司资料 CSV 或 JSON 导出。
- 旧岗位结构的迁移和兼容读取。
- 旧 HTML 岗位详情接口的降级回退。
- 岗位描述的职责、要求等自然语言分段。

## 4. 总体架构

岗位同步分为三层：

```text
同步入口
  → 通用岗位同步核心
    → 当前网站岗位适配器
      → 网站接口
```

职责划分：

### 4.1 同步入口

同步入口只决定：

- 处理哪些记录。
- 使用缺失补齐还是强制刷新策略。
- 如何显示进度。
- 如何响应中断。

同步入口不直接构造岗位详情 URL，也不解析网站响应。

### 4.2 通用岗位同步核心

通用核心负责：

- 判断岗位信息是否完整。
- 按顺序同步单条或多条岗位信息。
- 处理取消、错误、进度和统计。
- 调用网站适配器。
- 合并岗位结果。
- 触发公司资料独立保存。

通用核心不能出现以下 BOSS 专属名称：

- `securityId`
- `encryptJobId`
- `bossJobSecurityId`
- `brandComInfo`
- BOSS URL

### 4.3 网站岗位适配器

网站适配器负责：

- 获取平台岗位访问上下文。
- 执行平台要求的等待。
- 请求岗位详情。
- 验证平台响应。
- 将平台字段转换为通用岗位和公司结构。

当前已由 `site-adapters.js` 注册 BOSS 和猎聘适配器。BOSS 声明
`supportsJobDetail: true`，猎聘暂时声明 `supportsJobDetail: false`。

## 5. 通用岗位数据模型

每条聊天记录的岗位相关字段统一为：

```json
{
  "jobRef": {
    "externalId": "平台岗位ID",
    "detailAccessToken": "岗位详情访问凭据"
  },
  "companyKey": "boss|平台公司ID",
  "jobInfo": {
    "title": "岗位名称",
    "category": "岗位分类",
    "location": "工作地点",
    "experience": "经验要求",
    "education": "学历要求",
    "salary": "薪资描述",
    "description": "岗位描述",
    "address": "详细地址",
    "skills": [],
    "fetchStatus": "success",
    "fetchedAt": "2026-07-28T00:00:00.000Z",
    "errorMessage": ""
  }
}
```

### 5.1 `jobRef`

`jobRef` 保存网站岗位标识及岗位详情访问凭据：

```js
jobRef.externalId;
jobRef.detailAccessToken;
```

约束：

- 所有标识均按字符串保存。
- 核心代码不得假设 ID 的长度和字符格式。
- `detailAccessToken` 可以为空。
- `detailAccessToken` 可能过期，强制刷新时必须重新获取。

### 5.2 `jobInfo`

`jobInfo` 只保存跨平台通用岗位信息和同步状态。

字段类型：

| 字段           | 类型                           |
| -------------- | ------------------------------ |
| `title`        | string                         |
| `category`     | string                         |
| `location`     | string                         |
| `experience`   | string                         |
| `education`    | string                         |
| `salary`       | string                         |
| `description`  | string                         |
| `address`      | string                         |
| `skills`       | string[]                       |
| `fetchStatus`  | `success`、`failed` 或空字符串 |
| `fetchedAt`    | ISO 时间字符串                 |
| `errorMessage` | string                         |

平台返回空值时仍保留字段，使用空字符串或空数组。

### 5.3 岗位完整性

岗位信息完整需满足：

1. `jobInfo.fetchStatus === "success"`。
2. `jobRef.externalId` 非空。
3. `title`、`category`、`location`、`experience`、`education`、`salary`、`description`、`address` 属性存在。
4. `skills` 是数组。

字段值允许为空，但属性必须存在。

完整性判断集中在通用函数中，例如：

```js
isCompleteJobInfo(record);
```

同步页筛选、未同步筛选和状态展示必须共用该函数。

## 6. 通用公司数据模型

公司资料保存到独立存储：

```js
chrome.storage.local.jobChatCompanyProfiles;
```

推荐使用以 `companyKey` 为键的对象：

```json
{
  "boss|b394a83ff8385edf1XN93NW0E1o~": {
    "companyKey": "boss|b394a83ff8385edf1XN93NW0E1o~",
    "siteKey": "boss",
    "externalId": "b394a83ff8385edf1XN93NW0E1o~",
    "name": "吉利汽车集团",
    "employeeScale": "10000人以上",
    "industry": "汽车研发/制造",
    "description": "公司介绍"
  }
}
```

`companyKey` 生成规则：

```text
{siteKey}|{externalCompanyId}
```

约束：

- 不把完整公司资料写入 `jobChatRecords`。
- 不把完整公司资料写入 `jobChatPendingRecords.records`。
- 岗位记录只保存 `companyKey`。
- 缺少 `externalId` 时不保存公司资料。
- 同一个 `companyKey` 使用最新成功响应覆盖。

## 7. 网站岗位适配器接口

站点适配器增加岗位能力：

```js
{
  (siteKey,
    supportsJobDetail,
    resolveJobAccess(context),
    fetchJobDetail(jobRef, context),
    normalizeJobResponse(response));
}
```

当前返回结构：

```js
{
  (jobRef, jobInfo, companyProfile);
}
```

### 7.1 `resolveJobAccess`

负责：

- 根据聊天记录和联系人数据获取最新岗位标识。
- 获取岗位详情访问凭据。
- 返回通用 `jobRef`。

### 7.2 `fetchJobDetail`

负责：

- 执行平台要求的等待。
- 调用平台岗位详情接口。
- 支持 `AbortSignal`。
- 返回未经通用化的站点响应。

### 7.3 `normalizeJobResponse`

负责：

- 校验站点响应。
- 转换为通用 `jobInfo`。
- 转换为通用 `companyProfile`。
- 不直接写入存储。

## 8. BOSS 岗位详情接口

### 8.1 第一步：获取岗位访问凭据

请求：

```http
GET https://www.zhipin.com/wapi/zpchat/geek/getBossData
```

继续使用聊天联系人数据构造：

```text
bossId
bossSource
chatSecurityId
```

映射：

```text
zpData.data.encryptJobId → jobRef.externalId
zpData.data.securityId   → jobRef.detailAccessToken
```

`getBossData` 失败时不请求岗位详情。

### 8.2 固定等待

成功获得 `jobRef.detailAccessToken` 后，由统一的
`JobDetailSyncSession` 在岗位详情请求前执行固定 2 秒调度：

```text
getBossData 成功
→ 等待 2000 ms
→ job/detail.json
```

要求：

- 等待必须支持同步中断。
- 等待必须支持 `AbortSignal`。
- 等待期间不得发起岗位详情请求。
- 不使用阻塞式忙等待。
- 同步页和总览页共用该固定间隔。
- 总览页设置的“每分钟并发数”不能取消这 2 秒固定间隔。

### 8.3 第二步：请求岗位详情

请求：

```http
GET https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId={detailAccessToken}&_={Date.now()}
```

请求要求：

- `credentials: "include"`。
- `Accept: application/json, text/plain, */*`。
- `X-Requested-With: XMLHttpRequest`。
- 每次生成新的 `traceId`。
- 通过 BOSS 页面上下文取得当前运行时 `token`。
- 支持 `AbortSignal`。
- 检查 HTTP 状态。
- 解析 JSON。
- `code === 0` 时要求 `zpData.jobInfo` 是对象。
- `code === 200301` 按“职位已不存在”的成功终态处理。
- 其他非零业务码进入错误或风控处理。

岗位详情请求通过 `content.js` 与 `boss-hook.js` 的页面请求桥接执行。页面桥接使用
BOSS 页面当前登录态、Cookie、运行时 `token` 和重新生成的 `traceId`，标签页刷新后会
重新注入并读取新的页面运行时信息。

不得回退到 HTML 岗位详情页面。

## 9. BOSS 响应映射

### 9.1 岗位信息

| BOSS 字段                        | 通用字段              |
| -------------------------------- | --------------------- |
| `zpData.jobInfo.encryptId`       | `jobRef.externalId`   |
| `zpData.jobInfo.jobName`         | `jobInfo.title`       |
| `zpData.jobInfo.positionName`    | `jobInfo.category`    |
| `zpData.jobInfo.locationName`    | `jobInfo.location`    |
| `zpData.jobInfo.experienceName`  | `jobInfo.experience`  |
| `zpData.jobInfo.degreeName`      | `jobInfo.education`   |
| `zpData.jobInfo.salaryDesc`      | `jobInfo.salary`      |
| `zpData.jobInfo.postDescription` | `jobInfo.description` |
| `zpData.jobInfo.address`         | `jobInfo.address`     |
| `zpData.jobInfo.showSkills`      | `jobInfo.skills`      |

同步状态由客户端补充：

```js
fetchStatus: 'success';
fetchedAt: new Date().toISOString();
errorMessage: '';
```

若 `jobInfo.encryptId` 非空，以该值更新 `jobRef.externalId`。

### 9.2 职位已不存在

当接口返回：

```json
{
  "code": 200301,
  "message": "该职位已不存在"
}
```

按可正常完成的终态处理：

- `jobInfo` 的岗位内容字段全部写为空字符串，`skills` 写为空数组。
- `jobInfo.fetchStatus` 写为 `success`。
- `jobInfo.fetchedAt` 写为当前时间。
- `jobInfo.errorMessage` 保存“该职位已不存在”。
- 保留 `jobRef`，保证记录身份及请求来源可追踪。
- 计入岗位详情同步成功数量。
- 不暂停、不重试，继续同步下一条记录。
- 因满足统一完整性判断，后续 `missing-only` 同步不会重复请求该职位。

### 9.3 公司信息

| BOSS 字段                            | 通用字段                       |
| ------------------------------------ | ------------------------------ |
| `zpData.brandComInfo.encryptBrandId` | `companyProfile.externalId`    |
| `zpData.brandComInfo.brandName`      | `companyProfile.name`          |
| `zpData.brandComInfo.scaleName`      | `companyProfile.employeeScale` |
| `zpData.brandComInfo.industryName`   | `companyProfile.industry`      |
| `zpData.brandComInfo.introduce`      | `companyProfile.description`   |

同时生成：

```js
companyProfile.siteKey = 'boss';
companyProfile.companyKey = `boss|${companyProfile.externalId}`;
```

## 10. 通用岗位同步核心

已新增：

```text
job-sync-core.js
```

核心接口：

```js
syncRecord(record, context, options);
syncRecords(records, contextForRecord, options);
new JobDetailSyncSession({
  requestIntervalMs: 2000,
  maxRequestsPerPage: 4,
});
```

`options` 至少包含：

```js
{
  policy: ('missing-only' | 'force',
    shouldStop,
    signal,
    onProgress,
    onLog,
    onCompanyProfile);
}
```

`JobDetailSyncSession` 统一维护单页岗位详情请求数和请求间隔。达到 4 次请求后返回
`reloadRequired`，由后台刷新标签页并在刷新完成后继续。

### 10.1 `missing-only`

用于同步页：

- 岗位信息完整时直接跳过。
- 岗位信息缺失时请求岗位详情。

### 10.2 `force`

用于总览页：

- 不检查现有岗位信息。
- 每条选中记录都重新获取岗位访问凭据。
- 每条选中记录都重新请求岗位详情。

### 10.3 单条结果

统一返回：

```js
{
  record,
  companyProfile,
  status: "success" | "failed" | "skipped" | "stopped",
  errorMessage: ""
}
```

## 11. 同步页流程

同步页岗位策略：

1. 新增记录必须同步岗位信息。
2. 已有记录仅在岗位信息不完整时同步岗位信息。
3. 已有记录岗位完整时只同步消息。
4. “新增”复选框控制新增记录。
5. “更新”复选框控制已有记录及缺失岗位补齐。

单条记录流程：

```text
读取联系人项
→ 判断消息同步需求
→ 判断岗位同步需求
→ 必要时 getBossData
→ 等待 2 秒
→ 请求岗位 JSON
→ 合并聊天记录和岗位信息
→ 独立保存公司资料
→ 保存部分同步结果
```

岗位失败不得回滚已成功获取的聊天消息和联系人字段。

### 11.1 首次待更新列表快照

准备同步时，将首次计算出的 BOSS 待更新记录列表写入：

```text
chrome.storage.local.jobChatPreparedSourceList
```

快照同时保存：

- `siteKey`
- `capturedAt`
- `list`
- `syncSummary`
- 首次 `sourceTotal`
- 消息同步和岗位详情同步分类总数

开始同步、手动暂停后继续、`code=37` 刷新后重试以及周期刷新后继续，均优先读取该
快照，不重新请求联系人列表。只有不存在有效快照时才允许网络降级获取。

每轮继续同步时，使用已保存记录和待确认记录从首次快照中过滤已完成项，因此：

- 首次待更新范围保持不变。
- 已完成记录不会重复处理。
- 暂停前保存的记录继续保留。
- 再次点击同步时从剩余记录继续。

### 11.2 分类进度

同步页分别显示：

- 沟通记录完成数 / 首次沟通记录总数。
- 岗位信息完成数 / 首次岗位信息总数。

手动暂停后，后台从 `jobChatPendingRecords.syncSummary` 恢复累计的新增、更新、
岗位成功、失败和跳过数量；自动刷新标签页时也累计当前轮结果。恢复后的状态文本和
两个分类进度条均使用首次总数，不得归零、缩小或超过总数。

仅当首次列表中存在需要获取的岗位信息时显示：

```text
备注：同步过程中会自动刷新最近使用的招聘网站标签页，用于获取必要的数据。如果重试失败，刷新网站后再同步。
```

## 12. 总览页流程

总览页由：

```text
startUpdateDetailsBtn
```

触发。

链路保持：

```text
results.js
→ JOB_CHAT_REFRESH_SELECTED
→ background.js
→ JOB_CHAT_REFRESH_RECORDS
→ content.js
→ 站点适配器与岗位同步核心
```

执行规则：

- 仅支持实现了 `supportsJobDetail` 的站点。
- 按用户选择顺序处理。
- 使用 `force` 策略。
- 每完成一条立即保存记录。
- 每完成一条立即 upsert 公司资料。
- 运行时按钮显示“暂停”，暂停后立即恢复为“同步”。
- 手动暂停时立即中断请求、限速等待和风控倒计时。
- 手动暂停时，“同步中”恢复为“等待同步”，“重试中”改为“失败”。
- 任意记录最终失败时暂停批次，后续记录保持“等待同步”。
- 再次点击“同步”只提交失败和等待同步的记录，已经成功的记录不再处理。
- 重试及关闭后重新打开弹窗时，保留本批次已经成功的记录和“成功”状态，不重建或清空成功列表。
- 更新处于停止状态时关闭弹窗，视为退出本次更新并清空选中记录。
- `code === 200301` 的记录显示为“成功”，说明栏显示“该职位已不存在”。

## 13. 公司资料持久化

新增后台消息：

```text
JOB_CHAT_COMPANY_PROFILE_UPSERT
```

后台负责：

1. 校验 `companyKey`、`siteKey` 和 `externalId`。
2. 读取 `jobChatCompanyProfiles`。
3. 按 `companyKey` 覆盖或新增。
4. 串行执行写入，避免并发覆盖。
5. 返回保存结果。

同步页和总览页通过同一回调触发该消息。

不得通过把 `companyProfile` 临时塞入聊天记录来传递。

## 14. 岗位信息合并规则

### 14.1 成功

岗位请求成功时：

- 完整替换 `jobRef`。
- 完整替换 `jobInfo`。
- 更新 `companyKey`。
- 独立保存公司资料。

不保留旧岗位结构中的多余字段。

### 14.2 失败

新记录失败时：

```js
jobInfo.fetchStatus = 'failed';
jobInfo.fetchedAt = 当前时间;
jobInfo.errorMessage = 安全错误文本;
```

已有记录强制刷新失败时：

- 保留上一次成功的岗位内容。
- 将 `fetchStatus` 更新为 `failed`。
- 更新 `fetchedAt` 和 `errorMessage`。
- 保留本次新获取的 `jobRef`。
- 不写入公司资料。

### 14.3 中断

中断时：

- 不把正在请求的记录标记为成功。
- 不保存不完整岗位响应。
- 保留中断前已成功的记录和公司资料。

### 14.4 职位已不存在

`code === 200301` 不属于失败：

- 清空旧 `jobInfo` 内容，避免继续展示失效岗位资料。
- 保存成功状态及“该职位已不存在”说明。
- 不覆盖聊天记录中的顶层 `jobName`，避免破坏记录展示和身份关联。
- 不生成或更新公司资料。
- 同步流程继续处理下一条。

## 15. 风控和错误处理

删除基于 HTML 内容的风控判断。

新风控判断依据：

- 业务 `code === 37`。
- HTTP 403。
- HTTP 429。
- 响应消息包含安全验证、访问异常、频率限制等明确提示。

其他非零业务码按普通岗位详情错误处理；`code === 200301` 是明确排除在错误和风控
之外的成功终态。

总览页在 `updateDetailsRate` 右侧提供两个可保存设置：

- 重试延时（秒）：默认 `60`。
- 重试次数：默认 `3`。

触发 `code === 37` 后：

1. 立即刷新最近使用的 BOSS 标签页。
2. 等待标签页加载完成；刷新期间阻塞后续同步。
3. 按配置的固定重试延时倒计时。
4. 重新执行当前记录的完整同步流程，包括重新获取岗位访问凭据。
5. 使用刷新后的页面运行时 `token`、Cookie 和请求上下文。

不再请求 `https://www.zhipin.com/web/geek/jobs` 模拟用户行为，也不再使用
`30/60/90` 的递增等待。

除风控刷新外，每完成 4 次岗位详情请求也立即刷新 BOSS 标签页：

- 标签页刷新不计入岗位详情请求次数。
- 第 4 次请求完成后立即触发。
- 刷新期间阻塞后续请求。
- 刷新完成后直接继续剩余记录，不额外显示等待提示。
- 同步页和总览页使用同一规则。

连续失败后：

- 当前记录状态改为“失败”并暂停本轮岗位详情同步。
- 保留聊天同步结果。
- 总览页允许用户稍后从失败记录继续执行，已成功记录不再处理。

手动暂停时：

- 立即终止当前岗位请求。
- 取消标签页刷新等待和重试倒计时。
- 不再处理被取消请求的返回值。
- 清理页面请求监听器、超时句柄和 `AbortController`。

错误文本仍需截断；请求日志则按下述规则保存完整响应。

## 16. 安全和日志

岗位同步日志用于问题排查，必须记录：

- `getBossData` 和岗位详情接口的完整请求 URL。
- 完整请求头。
- 请求方法及 credentials 配置。
- HTTP 状态码。
- 完整响应 JSON；非 JSON 响应保存完整文本。

岗位信息同步日志不对 `securityId`、`zp_token`、运行时 `token` 或其他请求字段做
掩码，并记录标签页刷新开始、完成、取消、错误及重试等待信息。

开发工作区通过 `runtime-config.js` 默认开启日志，并在打开结果页时附加 `log=enable`。打包脚本会将发布包的 `enableDebugLog` 固定替换为 `false`，发布版本不会启用日志，即使 URL 被手动加上该参数。

JSON 结果页可以输出 `jobRef`；CSV 明确不输出岗位相关字段。

## 17. 结果页展示

岗位悬浮信息卡读取：

- `jobInfo.title`
- `jobInfo.salary`
- `jobInfo.location`
- `jobInfo.experience`
- `jobInfo.education`
- `jobInfo.skills`
- `jobInfo.description`
- `jobInfo.address`

行为：

- 技能以标签展示。
- 描述保留换行。
- 同步失败显示 `errorMessage`。
- `fetchStatus === "success"` 且存在说明时也显示 `errorMessage`，用于展示“该职位已不存在”。
- 显示最近同步时间。

“岗位信息未同步”筛选必须调用统一完整性函数。

## 18. JSON 与 CSV

### 18.1 JSON

JSON 记录输出：

```json
{
  "recordKey": "...",
  "sourceName": "BOSS直聘",
  "companyName": "...",
  "jobName": "...",
  "jobRef": {
    "externalId": "...",
    "detailAccessToken": "..."
  },
  "companyKey": "boss|...",
  "jobInfo": {
    "title": "...",
    "category": "...",
    "location": "...",
    "experience": "...",
    "education": "...",
    "salary": "...",
    "description": "...",
    "address": "...",
    "skills": [],
    "fetchStatus": "success",
    "fetchedAt": "...",
    "errorMessage": ""
  }
}
```

### 18.2 CSV

CSV 不导入导出：

- `jobRef`
- `companyKey`
- `jobInfo`
- 任何旧岗位 ID、岗位凭据、岗位关键词和岗位详情字段

CSV 的“内部数据”列必须排除所有岗位相关字段。

CSV 导入同一 `recordKey` 时：

- 保留数据库中已有的岗位字段。
- 深度合并 `boss`、`lastMessageInfo` 和 `liepin`。
- 不用空内部对象覆盖有效发送和同步字段。

## 19. 删除的旧数据结构

新代码不再读取或写入：

```text
encryptJobId
bossJobSecurityId
boss.encryptJobId
boss.bossJobSecurityId
boss.uploadSecurityId（确认无非岗位调用方后删除）
jobInfo.keywords
jobInfo.detail
```

不增加兼容别名，不执行旧字段回填。

## 20. 删除的旧代码

从 `boss-extractor.js` 删除：

- `parseBossJobDetailHtml`
- `DOMParser` 岗位解析
- `/job_detail/{encryptJobId}.html` URL
- HTML Accept 请求头
- `response.text()` 岗位详情处理
- HTML 页面内容识别
- HTML 安全页错误判断
- 旧 `fetchBossJobInfo`
- 同步页和总览页重复的岗位详情控制流

从共享和结果层删除：

- `normalizeJobKeywords`
- 仅服务旧岗位描述的 `normalizeJobDetail`
- `keywords/detail` 存储合并
- `encryptJobId` JSON/CSV 映射
- `bossJobSecurityId` 兼容读取
- 旧岗位 CSV 导入列

删除前必须用全文搜索确认没有非岗位功能调用方。

## 21. 文件修改清单

### 21.1 新增

#### `job-sync-core.js`

- 通用岗位完整性判断。
- 单条和批量岗位同步。
- `missing-only` 与 `force` 策略。
- 统一进度、错误和中断。
- 固定 2 秒请求间隔和单页最多 4 次岗位详情请求。

### 21.2 修改

#### `site-adapters.js`

- 定义通用岗位适配器能力。
- 注册岗位访问、请求和转换接口。

#### `manifest.json`

- 按正确顺序加载 `job-sync-core.js`。

#### `background.js`

- 注入新的岗位同步核心。
- 增加公司资料 upsert 消息。
- 增加公司资料串行写入队列。
- 统一保存总览页逐条进度。
- 统一处理 `code=37` 刷新、周期刷新、重试等待和取消。
- 恢复同步页暂停前的累计进度。

#### `boss-extractor.js`

- 保留联系人和聊天同步。
- 实现 BOSS 岗位适配器。
- 改用 JSON 岗位详情接口。
- 删除 HTML 岗位解析及重复控制流。
- 使用首次待更新列表快照。
- 实现 `code=200301` 成功终态映射。

#### `liepin-extractor.js`

- 保留现有聊天同步。
- 暂时声明 `supportsJobDetail: false`。
- 后续按相同适配器接口接入。

#### `content.js`

- 将同步页和总览页请求转交通用岗位核心。
- 统一传递停止、进度和公司资料回调。
- 将首次待更新列表及统计保存为快照。
- 提供可取消的 BOSS 页面请求桥接。

#### `content-common.js`

- 读写首次待更新记录快照。
- 保留同步请求日志及通用同步辅助函数。

#### `boss-hook.js`

- 在 BOSS 页面上下文执行岗位详情请求。
- 刷新后重新取得页面运行时 `token`。
- 为每次请求生成新的 `traceId`。
- 支持通过请求 ID 立即取消当前页面请求。

#### `shared-records.js`

- 规范化通用 `jobRef` 和 `jobInfo`。
- 删除旧岗位字段兼容。
- 提供岗位完整性判断。

#### `background-database.js`

- 按成功、失败规则合并通用岗位结构。
- 不把公司资料合并进聊天记录。

#### `results.js`

- 使用新岗位字段展示信息卡。
- 更新未同步筛选。
- 更新 JSON 输出。
- 保持 CSV 不包含岗位信息。
- 显示同步页分类进度和暂停恢复累计值。
- 实现总览页暂停、继续、失败续传和已成功结果保留。
- 显示“该职位已不存在”的成功说明。

#### `results-database.js`

- 保持 CSV 岗位字段隔离。
- 导入时保护数据库中已有岗位字段。

#### `results.html`

- 增加同步页沟通记录、岗位信息分类进度条。
- 增加自动刷新 BOSS 标签页备注。
- 增加总览页重试延时和重试次数配置。

#### `runtime-config.js`

- 开发工作区默认使用 `log=enable`。
- 发布包保持日志关闭。

#### `docs/zhipin.md`

- 更新 BOSS 岗位详情接口和字段来源。
- 说明聊天凭据与岗位访问凭据的区别。

## 22. 实施顺序与当前结果

以下阶段均已完成主体实现；后续修改继续遵循相同分层，不在同步页或总览页重新复制
岗位请求逻辑。

### 阶段一：通用模型

1. 定义 `jobRef`、`jobInfo` 和 `companyProfile`。
2. 实现岗位完整性函数。
3. 更新共享记录规范化。
4. 删除旧岗位兼容字段。

### 阶段二：通用同步核心

1. 新建 `job-sync-core.js`。
2. 实现缺失补齐和强制刷新策略。
3. 实现取消、进度、统计和错误模型。
4. 接入站点适配器。

### 阶段三：BOSS 适配器

1. 封装 `getBossData` 岗位访问解析。
2. 实现可中断的 2 秒等待。
3. 请求 `job/detail.json`。
4. 映射岗位和公司字段。
5. 删除 HTML 请求及解析。

### 阶段四：两条同步入口

1. 同步页接入 `missing-only`。
2. 总览页接入 `force`。
3. 合并两处重复的重试、进度和中断逻辑。
4. 增加公司资料独立持久化。

### 阶段五：展示和输出

1. 更新岗位悬浮信息卡。
2. 更新未同步筛选。
3. 更新 JSON 输出。
4. 验证 CSV 不包含岗位字段且不覆盖岗位数据。

### 阶段六：清理

1. 搜索旧字段、旧 URL 和旧函数。
2. 删除无调用方代码。
3. 更新文档。
4. 执行语法检查。

### 阶段七：同步稳定性

1. 页面上下文补齐运行时 `token` 和新 `traceId`。
2. 岗位请求增加 `Date.now()` 防缓存参数。
3. `code=37` 改为刷新标签页后按配置重试。
4. 每 4 次岗位详情请求周期刷新标签页。
5. 同步页固定首次待更新列表并恢复累计进度。
6. `code=200301` 按职位已不存在的成功终态处理。

## 23. 切换步骤

由于不实现旧岗位数据兼容，上线前执行：

1. 使用当前新 CSV 格式导出一次非岗位数据备份。
2. 确认 CSV 存在“内部数据”列。
3. 上线重构版本。
4. 清除旧岗位相关数据，或清空记录后导入 CSV。
5. 通过同步页重新补齐新增及缺失岗位信息。
6. 在总览页对指定记录执行全量岗位刷新。

旧 CSV 没有“内部数据”列时，只能恢复可见字段，不能完整恢复发送和同步内部状态。

## 24. 验收标准

### 24.1 架构

- 核心岗位同步代码不包含 BOSS 专属字段或 URL。
- 同步页和总览页共用同一岗位同步核心。
- BOSS、猎聘通过站点适配器隔离。

### 24.2 BOSS 请求

- 不再请求 `/job_detail/{id}.html`。
- 岗位详情请求固定保持至少 2 秒间隔。
- 请求 `/wapi/zpgeek/job/detail.json`。
- URL 包含 `securityId` 和 `_=Date.now()`。
- 使用本次获取的岗位访问凭据。
- 使用 BOSS 页面当前 Cookie、运行时 `token` 和新 `traceId`。
- 岗位同步调试日志记录完整请求和响应，不掩码岗位凭据。
- `code=37` 刷新标签页并按配置延时重试。
- 每完成 4 次岗位详情请求刷新标签页，刷新期间阻塞后续请求。
- 不请求 `/web/geek/jobs` 作为重试前置步骤。

### 24.3 同步页

- 新增记录请求岗位详情。
- 已有且岗位缺失的记录请求岗位详情。
- 已有且岗位完整的记录不请求岗位详情。
- 岗位失败不回滚聊天同步。
- 暂停后不重新获取待更新列表。
- 恢复时从首次列表的剩余记录继续。
- 沟通记录和岗位信息分类进度保持首次总数及累计完成数。

### 24.4 总览页

- `startUpdateDetailsBtn` 强制刷新所有选中记录。
- 每条成功结果立即持久化。
- 停止后保留已成功记录。
- 再次同步仅处理失败和等待同步记录。
- `code=200301` 显示成功并继续下一条。

### 24.5 数据

- `jobInfo` 包含所有通用字段。
- 公司详情不进入聊天总记录。
- 公司资料按 `companyKey` 去重保存。
- 不再写入旧岗位字段。
- 职位已不存在时保存空岗位内容、`success` 状态及说明文本。

### 24.6 导入导出

- JSON 包含通用岗位结构。
- CSV 不包含岗位信息。
- CSV 导入不覆盖现有岗位信息。
- CSV 往返后聊天同步和发送字段保持一致。

### 24.7 清理

- 代码中不存在旧 HTML 岗位 URL。
- 代码中不存在旧 HTML 解析函数。
- 代码中不存在 `jobInfo.keywords` 和 `jobInfo.detail` 写入。
- 代码中不存在旧岗位字段兼容分支。

## 25. 检查要求

实现完成后：

1. 对所有修改的 JavaScript 文件执行 `node --check`。
2. 搜索旧 URL、旧字段和旧解析函数，确认已删除。
3. 不执行扩展打包。
