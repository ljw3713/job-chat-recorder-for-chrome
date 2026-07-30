# GA4 匿名使用统计方案

## 目标

为 Chrome 扩展增加匿名、低频、可审计的使用统计，回答以下问题：

- 插件的安装和活跃安装规模；卸载量继续使用 Chrome Web Store 后台；
- 用户在 BOSS 直聘和猎聘分别保存了多少条记录；
- CSV 下载次数、下载记录数量以及下载范围；
- 各插件版本、地区、操作系统和浏览器版本的使用分布；
- 同步核心流程的成功率及标准化失败类型。

统计只用于产品使用情况和稳定性分析，不上传招聘业务数据、账号信息或聊天内容。

扩展侧事件采集、匿名标识、用户开关和打包接入已经实现。源码中的 GA4 配置保持为空；
开发模式从 Git 忽略的本地配置文件读取，正式打包通过环境变量注入。未配置时不会发送
数据。

## 总体架构

当前项目没有自有服务器，采用以下直连链路：

```text
Chrome 扩展
  ├─ 安装、活跃、保存、下载、同步事件
  ├─ 本地事件和参数白名单
  └─ GA4 Measurement Protocol HTTPS POST
          ↓ 直接发送
Google Analytics 4
```

直连模式存在明确的安全限制：Chrome 扩展安装包可以被下载和反编译，打包阶段注入的
`api_secret` 最终可以被提取；压缩代码不能保护密钥。密钥泄露后，第三方可能向对应
GA4 数据流注入垃圾事件。为降低影响，扩展应使用独立 GA4 数据流并定期轮换 Secret，
不能与网站或其他关键业务共用数据流。

GA4 Measurement Protocol 使用 HTTPS `POST` 上报，并要求 `api_secret`。Google
官方明确说明 API Secret 不应暴露在浏览器客户端，并指出接口返回 `2xx` 只代表请求
已接收，不代表事件字段一定有效。本项目是在没有服务器条件下接受该风险的实现，开发
阶段仍必须使用验证端点检查数据格式：

- [GA4 Measurement Protocol 参考](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference)
- [发送 Measurement Protocol 事件](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events)

### 扩展到 GA4 的请求格式

当前 `src/analytics.js` 直接请求：

```text
POST https://www.google-analytics.com/mp/collect
  ?measurement_id=G-XXXXXXXXXX
  &api_secret=XXXXXXXXXX
```

请求体使用 GA4 Measurement Protocol 结构：

```json
{
  "client_id": "随机安装 UUID",
  "timestamp_micros": 1785400000000000,
  "consent": {
    "ad_user_data": "DENIED",
    "ad_personalization": "DENIED"
  },
  "device": {
    "category": "desktop",
    "language": "zh-CN",
    "operating_system": "MacOS",
    "operating_system_version": "15.5",
    "browser": "Chrome",
    "browser_version": "138.0.0.0"
  },
  "events": [
    {
      "name": "records_saved",
      "params": {
        "site": "zhipin",
        "record_count": 42,
        "record_count_bucket": "11-50",
        "page_mode": "sync",
        "result": "success",
        "extension_version": "5.2.0",
        "architecture": "arm64",
        "session_id": 1785400000000,
        "engagement_time_msec": 1
      }
    }
  ]
}
```

扩展仅允许发送本文列出的事件和参数，设置 5 秒超时，不重试失败请求。Measurement
ID 和 API Secret 只通过打包环境变量进入临时构建目录，不写入仓库源码或构建日志；
但它们仍会出现在最终扩展包中。

## 匿名安装标识

首次安装时生成随机 UUID，存放在 `chrome.storage.local`：

```text
jobChatAnalyticsInstallationId
```

该标识只表示一个 Chrome 配置文件中的一次插件安装：

- 不使用 BOSS、猎聘或 Google 账号 ID；
- 不使用邮箱、手机号、Cookie、机器序列号或设备指纹；
- 不作为 GA4 自定义维度展示，避免产生高基数维度；
- 仅作为 GA4 `client_id` 和本地去重依据；
- 用户清除扩展数据或重新安装后可能生成新的标识；
- 同一用户在多个设备或 Chrome 配置文件中会被计为多个安装实例。

因此本文中的“用户数”实际含义是“匿名安装实例数”，不是自然人数量。

## 事件定义

### 核心事件

| 事件名 | 触发时机 | 主要参数 | 统计用途 |
|---|---|---|---|
| `extension_installed` | `onInstalled.reason === "install"` | `page_mode`、公共参数 | 新安装量 |
| `records_saved` | `saveBtn` 保存成功后 | `site`、`record_count`、`record_count_bucket`、`page_mode`、`result` | 保存次数和记录量 |
| `csv_downloaded` | `downloadCsvBtn` 成功发起下载后 | `record_count`、`record_count_bucket`、`record_scope`、`page_mode`、`site` | 下载次数和下载记录量 |

### 其他必需事件

| 事件名 | 触发时机 | 主要参数 | 统计用途 |
|---|---|---|---|
| `extension_active` | 每个自然日第一次实际打开插件或结果页 | 公共参数 | DAU、WAU、MAU |
| `sync_completed` | 一次同步流程结束且结果成功保存 | `site`、`inserted_count`、`updated_count`、`record_count`、`result` | 核心功能使用量和成功率 |
| `sync_failed` | 一次同步流程失败 | `site`、`error_code`、`result` | 发现平台接口或版本异常 |

以上三个事件与三个核心事件属于同一实施范围，不作为后续可选增强。

`extension_active` 需要在本地保存最后上报日期，同一个匿名安装实例每天最多上报一次：

```text
jobChatAnalyticsLastActiveDate
```

### 保存事件计数规则

`records_saved` 只在 `SAVE_PENDING_TO_TOTAL` 返回成功后发送，不能在点击按钮时提前发送。

如果一次保存中包含两个平台的记录，按平台拆成两个事件：

```json
{
  "name": "records_saved",
  "params": {
    "site": "zhipin",
    "record_count": 80,
    "record_count_bucket": "51-100",
    "result": "success"
  }
}
```

```json
{
  "name": "records_saved",
  "params": {
    "site": "liepin",
    "record_count": 20,
    "record_count_bucket": "11-50",
    "result": "success"
  }
}
```

这样事件数表示保存操作次数，`record_count` 的总和表示保存记录量。失败时可以发送
`result=failed`，但 `record_count` 不计入成功保存记录总量。

### CSV 下载事件计数规则

下载事件使用实际传入 CSV 的记录集合：

- 有选中记录：`record_scope=selected`；
- 没有选中记录：`record_scope=all`；
- `record_count` 为实际下载记录数；
- 记录来自同一平台时，`site=zhipin` 或 `site=liepin`；
- 同时包含两个平台时，`site=mixed`；
- 空数据时不触发下载，或发送 `result=empty`，不能计入成功下载。

示例：

```json
{
  "name": "csv_downloaded",
  "params": {
    "page_mode": "overview",
    "record_scope": "selected",
    "site": "mixed",
    "record_count": 35,
    "record_count_bucket": "11-50",
    "result": "success"
  }
}
```

## 维度和指标

### 公共事件维度

| 参数 | 示例 | 说明 | GA4 配置 |
|---|---|---|---|
| `extension_version` | `5.2.0`、`5.2.0-dev` | `chrome.runtime.getManifest().version`；开发模式追加 `-dev` | 事件级自定义维度 |
| `site` | `zhipin`、`liepin`、`mixed`、`none` | 招聘平台 | 事件级自定义维度 |
| `page_mode` | `sync`、`overview`、`background` | 事件来源页面 | 事件级自定义维度 |
| `result` | `success`、`failed`、`cancelled`、`empty` | 操作结果 | 事件级自定义维度 |
| `record_scope` | `selected`、`all`、`none` | 记录选择范围 | 事件级自定义维度 |
| `record_count_bucket` | `0`、`1-10`、`11-50`、`51-100`、`101-500`、`500+` | 记录数量区间 | 事件级自定义维度 |
| `error_code` | `storage_failed`、`network_failed` | 标准化错误分类 | 事件级自定义维度 |
| `architecture` | `arm64`、`x86-64`、`unknown` | Chrome PlatformInfo 架构 | 事件级自定义维度 |

参数值必须使用上述固定枚举，不能上传原始错误文本、页面 URL 或动态业务值。

### 自定义数值指标

| 参数 | 单位 | 说明 |
|---|---|---|
| `record_count` | 标准 | 本次保存或下载的记录数 |
| `inserted_count` | 标准 | 同步新增记录数 |
| `updated_count` | 标准 | 同步更新记录数 |

以上参数需要在 GA4“自定义定义”中创建事件级自定义指标，聚合方式使用“总和”。
查看保存或下载量时，必须同时筛选 `result=success`。

### 必需的地区和设备维度

优先使用 GA4 内置维度，不重复创建同名自定义维度：

| 逻辑维度 | GA4 内置维度 | Measurement Protocol / 数据来源 |
|---|---|---|
| 国家 | `Country` | GA4 根据事件请求来源 IP 近似推断 |
| 省、州或地区 | `Region` | GA4 根据事件请求来源 IP 近似推断 |
| 城市 | `City` | GA4 根据事件请求来源 IP 近似推断 |
| 操作系统 | `Operating system` | `device.operating_system` |
| 操作系统版本 | `OS version` | `device.operating_system_version`，无法可靠获取时传 `unknown` |
| 浏览器 | `Browser` | `device.browser`，固定为 `Chrome` |
| Chrome 版本 | `Browser version` | `device.browser_version`，至少传主版本 |
| 设备类别 | `Device category` | `device.category`，固定为 `desktop` |
| 系统架构 | 自定义 `architecture` | `chrome.runtime.getPlatformInfo().arch` |

本表中的所有逻辑维度都属于必需统计范围。操作系统版本无法可靠获取时必须明确传
`unknown`，不能因为缺失而取消整个事件。系统架构使用自定义维度，其余字段优先映射
到 GA4 内置维度。

地区不由插件申请地理位置权限，也不上传经纬度或主动读取 IP。直连请求由 GA4 按其
可用信息生成地区维度；由于 Measurement Protocol 官方主要将其定位为常规标签的补充，
直连模式的地区字段不保证完整，可能显示为 `(not set)`。能够生成时，国家、省/州和
城市仍是基于网络出口的近似结果，VPN、代理、企业网络和移动网络都会造成偏差。

Google 官方列出了 `Country`、`Region`、`City`、`Operating system` 和
`OS version` 等预定义维度，并说明地理维度由流量 IP 近似计算：

- [GA4 预定义用户维度](https://support.google.com/analytics/answer/9268042)
- [Measurement Protocol 地区和设备字段](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference#geographic_information)

## 代码接入位置

### 新增 `src/analytics.js`

新增独立模块，负责：

- 生成并读取匿名安装 ID；
- 获取插件版本；
- 调用 `chrome.runtime.getPlatformInfo()` 获取 `os` 和 `arch`；
- 获取操作系统版本，无法可靠获取时统一为 `unknown`；
- 解析 Chrome 版本，至少保留主版本；
- 对事件名、参数名、枚举值和数值范围做白名单过滤；
- 计算 `record_count_bucket`；
- 每日活跃事件去重；
- 将事件直接发送到 GA4 Measurement Protocol；
- 网络失败时静默失败，不影响保存、下载或同步主流程；
- 设置短超时，不无限重试，不在本地积压聊天业务相关数据。

模块只在扩展自身页面和后台 Service Worker 中使用，不注入 BOSS 或猎聘网页。

### `src/background.js`

在 Service Worker 中接入：

1. 使用 `importScripts()` 加载同目录的 `analytics.js`。
2. 监听 `chrome.runtime.onInstalled`：
   - 原因是 `install` 时生成安装 ID 并发送 `extension_installed`；
   - 原因是 `update` 时不重复计算安装；
   - 清除旧版本可能遗留的 `chrome.runtime.setUninstallURL()`。
3. 监听统一消息 `JOB_CHAT_ANALYTICS_EVENT`，由 `src/results.js` 请求上报行为事件。
4. 在同步流程最终成功处发送 `sync_completed`。
5. 在同步流程最终失败处发送 `sync_failed`，只使用标准化 `error_code`。

生命周期 API 和平台信息均由 Chrome `runtime` API 提供：

- [Chrome runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime)

### `src/results.js`

接入以下现有交互点：

- `saveBtn`：
  - 在 `SAVE_PENDING_TO_TOTAL` 成功返回之后统计；
  - 对本次实际保存的记录按 `recordSiteKey()` 分组；
  - 分别发送 `records_saved`；
  - 统计失败不能改变保存成功提示，也不能阻塞后续刷新。
- `downloadCsvBtn`：
  - 复用 `csvExportRecords()` 获取实际导出集合；
  - 在创建下载前确定 `record_count`、`record_scope` 和 `site`；
  - 成功调用下载后发送一次 `csv_downloaded`；
  - 不能上报 CSV 内容、文件名或记录字段。
- 页面初始化：
  - 调用一次每日去重的 `extension_active`；
  - `page_mode` 使用当前已有的 `sync` 或 `overview`。

### `src/runtime-config.js`

增加运行配置：

```text
analyticsEnabled
ga4MeasurementId
ga4ApiSecret
```

源码中的 Measurement ID 和 API Secret 保持为空。正式打包时由
`JOB_CHAT_GA4_MEASUREMENT_ID` 和 `JOB_CHAT_GA4_API_SECRET` 注入临时构建目录。
API Secret 不提交到 Git，但最终仍存在于可被反编译的扩展包内。

开发模式下，`src/background.js` 在加载同目录的 `runtime-config.js` 后自动尝试加载
`src/runtime-config.local.js`。只有 `enableDebugLog=true` 时才执行本地覆盖。该文件：

- 已加入 `.gitignore`；
- 不在 `scripts/package-extension.js` 的正式包文件清单中；
- 只覆盖 `analyticsEnabled`、`ga4MeasurementId` 和 `ga4ApiSecret`；
- 修改后需要在 `chrome://extensions/` 重新加载扩展；
- 对应的无密钥模板为 `src/runtime-config.local.example.js`。

本地文件缺失或配置为空时保持统计关闭，不影响扩展其他功能。

### `manifest.json`

在 `host_permissions` 中加入 GA4 收集域名：

```json
"https://www.google-analytics.com/*"
```

不增加其他无关的宽泛域名权限。

### `scripts/package-extension.js`

`src/analytics.js` 已加入 `packageFiles`。打包流程必须继续满足：

- 确保正式包启用 GA4 直连配置；
- `npm run package` 启动 `scripts/package-with-ga4.js`；
- 交互模式询问 Measurement ID，并以隐藏输入读取 API Secret；
- CI 等非交互模式只从环境变量读取配置，不修改源码；
- Measurement ID 必须符合 `G-XXXXXXXX` 格式，API Secret 不能为空；
- 只有显式使用 `npm run package -- --skip-ga4` 才允许构建统计关闭的包；
- `npm run package:skip-ga4` 提供等价的快捷命令；
- `--skip-ga4` 忽略当前环境中已有的 GA4 变量，避免生成状态不明确的包；
- 打包输出不能打印 API Secret；
- 压缩不改变事件名和固定枚举值；
- 打包后检查清单和 ZIP 内容。

## 卸载统计

扩展被卸载后代码已经无法运行，而 GA4 Measurement Protocol 要求 HTTPS `POST`，
所以在没有服务器或托管卸载页面的条件下，不能发送可靠的 `extension_uninstalled`
事件。

当前实现主动清空 `chrome.runtime.setUninstallURL()`，卸载量继续使用 Chrome Web
Store 后台数据，不在 GA4 中伪造该指标。后续如使用 GitHub Pages 等托管普通网页，
可以在卸载页面中接入 GA4，再单独补充卸载事件。

## GA4 配置步骤

### 1. 创建媒体资源和数据流

1. 登录 [Google Analytics](https://analytics.google.com/)。
2. 创建 GA4 媒体资源。
3. 创建 Web 数据流。
4. 记录 Measurement ID。
5. 在“管理 → 数据流 → 对应数据流 → Measurement Protocol API Secret”中创建密钥。
6. 为该扩展使用独立数据流，不与网站或其他关键业务共用。
7. 在项目目录运行：

```bash
npm run package
```

8. 按提示输入 Measurement ID；API Secret 使用隐藏输入，不会显示在终端。
9. 打包日志显示 `GA4 analytics: enabled` 才表示正式包已注入。
10. CI 等非交互环境需设置：

```text
JOB_CHAT_GA4_MEASUREMENT_ID=G-XXXXXXXXXX
JOB_CHAT_GA4_API_SECRET=Measurement Protocol API Secret
```

11. API Secret 不写入 Git，但必须接受它可从最终扩展包中提取的风险。

如果需要为调试或离线分发明确生成不带统计的包，运行：

```bash
npm run package -- --skip-ga4
# 或
npm run package:skip-ga4
```

未使用 `--skip-ga4` 时，交互终端会询问缺失配置；非交互环境缺少任意一项都会终止打包。

### 2. 注册自定义维度

进入“管理 → 数据显示 → 自定义定义 → 创建自定义维度”，按事件范围注册：

```text
extension_version
site
page_mode
result
record_scope
record_count_bucket
error_code
architecture
```

工作区中的 `src/runtime-config.js` 默认设置 `enableDebugLog=true`，因此本地开发版发送的
`extension_version` 会自动追加 `-dev`，例如 `5.2.0-dev`。正式打包脚本会将
`enableDebugLog` 改为 `false`，正式包仍上报 `5.2.0`。不要直接把 `-dev` 写入
`manifest.version`，该字段只允许一至四段数字。

GA4 标准版支持的自定义定义数量有限，应优先使用内置的地区、系统和浏览器维度，避免
为匿名安装 ID、时间戳等高基数值创建自定义维度。自定义维度通常需要 24～48 小时
才会出现在常规报告中：

- [GA4 自定义维度和指标说明](https://support.google.com/analytics/answer/14240153)
- [创建事件级自定义维度](https://support.google.com/analytics/answer/14239696)

### 3. 注册自定义指标

创建事件级自定义指标：

```text
record_count
inserted_count
updated_count
```

指标单位选择“标准”。后续在探索中使用“总和”查看保存、下载、新增和更新的记录量。

### 4. 验证事件

开发阶段按以下顺序验证：

1. 使用 GA4 Measurement Protocol 验证端点检查参数错误；
2. 在 GA4“报告 → 实时”确认事件名；
3. 在 DebugView 检查开发事件；
4. 等待自定义定义生效后检查常规报告；
5. 验证失败上报不会影响插件保存、下载和同步。

Measurement Protocol 事件需要带 `session_id` 和 `engagement_time_msec`，才能更稳定地
显示在实时报告并参与部分互动指标。

## 在 GA4 中查看

### 查看安装

进入“报告 → 互动 → 事件”，查看：

```text
extension_installed
```

事件次数表示收到的安装事件数量。安装实例数使用 GA4 用户指标辅助查看，不能把事件
次数直接解释为自然人数量。卸载量在 Chrome Web Store 后台查看，不在 GA4 中查看。

### 查看保存记录

进入“探索 → 自由形式”：

- 行：`site`；
- 值：`事件数`、`record_count` 总和；
- 筛选：`事件名称 = records_saved`；
- 筛选：`result = success`；
- 可增加列：`extension_version`。

结果可以回答各平台的保存操作次数和成功保存记录总量。

### 查看 CSV 下载

进入“探索 → 自由形式”：

- 行：`record_scope`、`page_mode`；
- 值：`事件数`、`record_count` 总和；
- 筛选：`事件名称 = csv_downloaded`；
- 筛选：`result = success`；
- 可增加行：`site`、`record_count_bucket`。

结果可以区分下载选中记录和下载全部记录。

### 查看“美国、5.2.0、macOS”用户

进入“探索 → 自由形式”，配置：

- 行：`Country`、`Operating system`、`extension_version`；
- 值：`活跃用户数`、`事件数`、`record_count` 总和；
- 筛选：`Country = United States`；
- 筛选：`Operating system = MacOS`；
- 筛选：`extension_version = 5.2.0`。

可以继续增加：

- `事件名称 = records_saved`：查看该群体的保存情况；
- `事件名称 = csv_downloaded`：查看该群体的下载情况；
- `site = zhipin` 或 `site = liepin`：查看平台差异；
- `Region` 或 `City`：进一步查看地区分布。

地区基于 IP 近似推断，小样本还可能受到 GA4 数据阈值影响，因此不应作为精确的用户
身份或结算数据。

### 查看版本稳定性

进入“探索 → 自由形式”：

- 行：`extension_version`、`site`、`error_code`；
- 值：`事件数`、`活跃用户数`；
- 筛选：`事件名称 = sync_failed`。

对比 `sync_completed` 和 `sync_failed` 可以观察版本升级后某个平台是否出现明显异常。

## 隐私和安全边界

允许上报：

- 随机匿名安装 ID，仅用于 GA4 `client_id` 和去重；
- 插件版本、平台枚举、页面模式和操作结果；
- 保存、下载、新增、更新的记录数量；
- 数量区间、标准化错误码；
- 操作系统、架构和 Chrome 版本；
- GA4 根据网络出口近似生成的地区。

禁止上报：

- BOSS、猎聘用户 ID 及任何账号标识；
- 招聘者、求职者、公司和岗位信息；
- 聊天正文、备注、简历和 CSV 内容；
- Cookie、登录令牌、请求头或接口响应；
- 搜索关键词和完整 URL；
- IP、经纬度、设备指纹；
- 原始异常文本和可能包含业务数据的调试日志。

统计应满足：

- 在隐私政策中明确说明收集项目、用途、处理方和保留时间；
- 关闭广告个性化，不将统计数据用于广告画像；
- 提供关闭匿名统计的设置；
- 用户关闭统计后停止新事件，并按既定策略处理删除请求；
- 扩展侧实施事件和参数白名单、请求超时及无重试策略；
- 扩展使用独立 GA4 数据流并定期轮换 API Secret；
- 统计失败永远不能阻断插件主要功能。

## 验收清单

1. 新安装只发送一次 `extension_installed`，升级不重复计为安装。
2. 每个安装实例每天最多发送一次 `extension_active`。
3. 保存成功后按 `zhipin`、`liepin` 分组统计准确数量。
4. 保存失败不计入成功记录总量。
5. CSV 事件数量与实际导出集合一致，正确区分 `selected` 和 `all`。
6. GA4 可按版本、国家、地区、操作系统、平台和结果组合筛选。
7. 同步失败只包含标准化错误码，不包含原始响应或消息。
8. 源码和 Git 历史中不存在 GA4 API Secret，打包时只从环境变量注入。
9. 构建日志不输出 API Secret，并明确记录最终扩展包可被提取的风险。
10. 未使用 `--skip-ga4` 时，两项构建变量均为必填，缺少任意一项都会打包失败。
11. 使用 `--skip-ga4` 时忽略已有 GA4 变量，并生成统计关闭的包。
12. 开发模式可以读取被 Git 忽略的 `src/runtime-config.local.js`。
13. 正式包不包含 `src/runtime-config.local.js` 或本地 Secret。
14. 不发送自定义卸载事件，卸载量以 Chrome Web Store 后台为准。
15. 断网或 GA4 异常时，保存、下载和同步功能仍正常。
16. Chrome 商店隐私披露和项目隐私政策与实际统计字段一致。
