# BOSS 直聘自动招呼推荐岗位筛选与检索模式实施方案

## 1. 文档状态

状态：已实施（2026-08-06）。本文同时记录推荐模式筛选和检索模式的最终行为。

本次范围：

- 在自动消息配置中增加城市、求职类型、薪资待遇、工作经验、学历要求、公司行业、
  公司规模、融资阶段、职位类型、区域和地铁选项。
- 将配置转换为 BOSS 推荐岗位列表接口的查询参数。
- 增加通过关键词主动检索岗位的第二种岗位来源模式。
- 为城市、通用筛选条件、行业和职位类型元数据增加一个月本地缓存；区域和地铁按所选
  城市动态读取。
- 保留现有岗位详情请求、本地条件过滤、任务状态、风控恢复和打招呼流程。

猎聘不使用本方案中的 BOSS 筛选元数据；猎聘推荐接口仅独立增加“最新/综合”排序配置。

## 2. 当前实现

BOSS 自动招呼通过目标职位的 `encryptExpectId` 请求推荐岗位列表：

```http
GET https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json
```

当前生成的 URL 已包含下列空参数：

```text
city=
jobType=
salary=
experience=
degree=
industry=
scale=
```

任务从第一页开始请求，后续分页复用保存的推荐列表 URL，只替换 `page`。遇到
`code=37` 时，后台保存该 URL，刷新 BOSS 页面后继续任务。

自动消息面板现有的“工资范围”和“年限范围”是取得推荐岗位后的本地过滤条件；本次新增
的薪资和工作经验是推荐列表接口的服务端查询条件，两组条件同时生效。

## 3. 筛选条件

| 显示名称 | 配置字段 | URL 参数 | 选择方式 | 数据来源 |
| --- | --- | --- | --- | --- |
| 城市 | `city` | `city` | 单选 | 城市接口 |
| 求职类型 | `jobType` | `jobType` | 单选 | `jobTypeList` |
| 推荐薪资 | `salary` | `salary` | 单选 | `salaryList` |
| 推荐经验 | `experience` | `experience` | 多选 | `experienceList` |
| 学历要求 | `degree` | `degree` | 多选 | `degreeList` |
| 公司行业 | `industry` | `industry` | 分组多选 | 行业接口 |
| 公司规模 | `scale` | `scale` | 多选 | `scaleList` |
| 融资阶段 | `stage` | `stage` | 多选 | `stageList`，仅检索模式 |
| 职位类型 | `position` | `position` | 分组多选 | 职位类型接口，仅检索模式 |
| 区域 | `multiBusinessDistrict` | `multiBusinessDistrict` | 层级多选 | 区域接口，仅检索模式 |
| 地铁 | `multiSubway` | `multiSubway` | 层级多选 | 地铁接口，仅检索模式 |

`experience`、`degree`、`industry`、`scale`、`stage`、`position`、
`multiBusinessDistrict`、`multiSubway` 支持多选；城市、求职类型和推荐薪资为单选。

所有条件都支持“不限”。单选条件选择“不限”后保存为空值；多选条件选择“不限”后清空
其他选择，选择任意具体选项时取消“不限”。编码 `0` 不写入最终 URL，统一转换为空参数。

首期不人为限制多选数量。多选编码按照接口选项顺序输出，不依赖用户点击顺序，以保证
生成的 URL 稳定。

## 4. 元数据接口

### 4.1 城市

```http
GET https://www.zhipin.com/wapi/zpgeek/common/data/city/site.json
```

主要读取 `zpData.siteGroup[].cityList`，映射为：

```js
{
  code: "101010100",
  name: "北京"
}
```

不同分组可能包含相同城市，写入缓存前按 `code` 去重。城市排序优先保留接口中的字母
分组及原始顺序。

### 4.2 通用筛选条件

```http
GET https://www.zhipin.com/wapi/zpgeek/pc/all/filter/conditions.json?_=1785984743976
```

使用以下字段：

```text
jobTypeList
salaryList
experienceList
degreeList
scaleList
stageList
```

不使用 `payTypeList`、`partTimeList` 等无关字段。

### 4.3 公司行业

```http
GET https://www.zhipin.com/wapi/zpCommon/data/industryFilterExemption?_=1785992074619
```

保留一级行业分组以及 `subLevelModelList` 中的具体行业。选中项使用具体行业的 `code`，
一级分组仅用于界面展示，不直接写入查询参数。

### 4.4 职位类型

```http
GET https://www.zhipin.com/wapi/zpCommon/data/getCityShowPosition?_=1785985736347
```

保留职位分组和最内层岗位编码。分组只用于界面展示，最终 `position` 使用最内层编码并以
字面逗号连接。

### 4.5 区域和地铁

选择城市后按需请求：

```http
GET https://www.zhipin.com/wapi/zpgeek/businessDistrict.json?cityCode={cityCode}&_={timestamp}
GET https://www.zhipin.com/wapi/zpCommon/data/getSubwayByCity?cityCode={cityCode}&_={timestamp}
```

父节点编码表示整个区域或整条线路；子节点在请求体中按
`父编码:子编码1_子编码2` 合并。区域与地铁选择互斥。

### 4.6 页面请求桥接

`src/boss-hook.js` 的页面请求白名单增加：

```text
/wapi/zpgeek/common/data/city/site.json
/wapi/zpgeek/pc/all/filter/conditions.json
/wapi/zpCommon/data/industryFilterExemption
/wapi/zpCommon/data/getCityShowPosition
/wapi/zpgeek/businessDistrict.json
/wapi/zpCommon/data/getSubwayByCity
/wapi/zpgeek/search/joblist.json
```

请求继续使用 BOSS 页面当前登录态、运行时 token、`traceId` 和现有请求桥接，不从扩展
页面直接跨域请求。

`src/boss-auto-greeting.js` 增加元数据读取消息：

```text
JOB_CHAT_AUTO_GREETING_FILTER_OPTIONS_GET
JOB_CHAT_AUTO_GREETING_LOCATION_FILTER_OPTIONS_GET
```

`src/background.js` 参照目标职位列表消息，将请求转发至对应的 BOSS 标签页。猎聘标签页
不得处理该消息。

## 5. 元数据缓存

### 5.1 存储结构

元数据保存在 `chrome.storage.local`，与用户的筛选选择分开：

```js
const BOSS_FILTER_OPTIONS_CACHE_KEY = 'jobChatBossFilterOptionsCache';
const BOSS_FILTER_OPTIONS_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
```

缓存结构：

```js
{
  version: 2,
  fetchedAt: 1785984743976,
  expiresAt: 1788576743976,
  data: {
    cities: [],
    jobTypes: [],
    salaries: [],
    experiences: [],
    degrees: [],
    industries: [],
    scales: [],
    stages: [],
    positions: []
  }
}
```

`industries` 保留一级分组结构，其余列表使用统一的 `{ code, name }` 结构。缓存的
`version` 用于后续结构升级；版本不匹配、必要数组缺失或数据类型错误时视为缓存失效。

### 5.2 读取和刷新

BOSS 自动消息面板初始化时：

1. 读取 `jobChatBossFilterOptionsCache`。
2. 校验版本、时间和数据结构。
3. `Date.now() < expiresAt` 时直接使用缓存，不发送四个全局元数据请求。
4. 缓存不存在、损坏或已超过 30 天时，并行请求四个全局元数据接口。
5. 四个响应均通过 HTTP、JSON、`code === 0` 和数据结构校验后，标准化并原子替换整个
   缓存。
6. `fetchedAt` 使用四个请求全部成功的时间，`expiresAt` 为该时间加 30 天。

每次真实刷新时，两个支持时间戳的接口都使用当前 `Date.now()` 生成 `_` 参数。

### 5.3 刷新失败

四个全局接口中的任意一个失败时，不允许使用部分新数据覆盖完整旧缓存：

- 存在结构完整的旧缓存时，临时使用过期缓存，并提示“筛选数据更新失败，当前使用上次
  缓存数据”。
- 使用过期缓存时不修改 `fetchedAt` 和 `expiresAt`，下次打开面板继续尝试刷新。
- 没有可用旧缓存时，禁用新增的推荐岗位筛选区域并显示加载错误。
- 元数据失败不影响现有目标职位、原有本地过滤条件和猎聘功能。

猎聘面板不读取、不刷新这个缓存。扩展升级时不主动清除缓存；需要强制更新数据结构时
提升 `version`。

## 6. 用户配置

筛选选择继续保存在 `jobChatAutoMessageConfig`，增加 BOSS 专属节点：

```js
{
  // 现有通用配置保持不变
  salaryMinK: null,
  salaryMaxK: null,
  experienceMinYears: null,
  experienceMaxYears: null,

  bossRecommendFilters: {
    city: { code: "101010100", name: "北京" },
    jobType: { code: "1901", name: "全职" },
    salary: { code: "405", name: "10-20K" },
    experience: [
      { code: "106", name: "5-10年" },
      { code: "105", name: "3-5年" }
    ],
    degree: [
      { code: "204", name: "硕士" },
      { code: "203", name: "本科" }
    ],
    industry: [
      { code: "100020", name: "互联网" },
      { code: "100012", name: "在线教育" }
    ],
    scale: [
      { code: "302", name: "20-99人" },
      { code: "303", name: "100-499人" }
    ],
    stage: [{ code: "803", name: "A轮" }],
    position: [{ code: "100121", name: "后端开发" }],
    multiBusinessDistrict: [],
    multiSubway: []
  }
}
```

配置同时保存编码和名称，使元数据接口临时不可用时仍可显示上次选择。旧配置不存在
`bossRecommendFilters` 时补齐空结构，所有新增条件按“不限”处理，无需单独迁移。

加载配置时对数组去重并过滤无效结构。若已保存的编码不在最新元数据中，保留原名称并
标记为“已失效”；用户确认或重新选择前禁止用该失效值启动新任务，避免静默扩大或缩小
查询范围。

启动任务时将当前 `bossRecommendFilters` 作为配置快照写入运行状态。任务开始后修改面板
配置，不影响正在执行或风控恢复中的任务。

## 7. 面板设计

在 `auto-message-panel.html` 的“目标职位”之后增加“推荐岗位筛选”区域。仅当前标签页为
BOSS 时展示；当前标签页为猎聘时隐藏，并且不加载 BOSS 元数据。

交互参考 BOSS 网站的筛选条件，最终实现为：

- 整个筛选区域默认收起，单个条件也使用可展开下拉层。
- 收起状态直接显示具体已选名称，不显示选中数量。
- 选项使用勾选状态，点击面板外或再次点击标题收起。
- 勾选多选项后不立即关闭，并保持当前下拉滚动位置。
- 城市使用支持搜索的单选弹层，避免在侧栏一次展示数百个城市。
- 行业按一级行业分组，并支持按具体行业名称搜索。
- 求职类型和推荐薪资使用单选列表。
- 工作经验、学历、行业、公司规模、融资阶段和职位类型使用对应单选或多选列表。
- 区域和地铁按父级分组逐层展开；选择子节点会取消父节点“全区域/全线路”。
- 区域和地铁互斥，选择其中一类的有效条件会清空另一类。

现有“工资范围”和“年限范围”继续保留。新增字段使用“推荐薪资”和“推荐经验”名称，并
提示它们控制推荐列表接口，现有范围条件会在列表返回后再次过滤，最终结果取交集。

选择变更后立即更新 `jobChatAutoMessageConfig`。任务运行、限速等待、暂停、刷新重试和
取消期间，筛选下拉仍可展开、收起和滚动，但所有选项禁止修改；岗位来源、目标岗位、
检索关键词、“仅在线”“非猎头”和普通双击编辑同样锁定。双击普通条件时显示
“任务执行中无法编辑”。

## 8. 推荐岗位 URL

将 URL 构造函数扩展为：

```js
recommendedListUrlForExpect(encryptExpectId, bossRecommendFilters)
```

示例配置生成：

```text
city=101010100
jobType=1901
salary=405
experience=106,105
degree=204,203
industry=100020,100012
scale=302,303
```

完整请求示例：

```text
https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1&pageSize=15&city=101010100&encryptExpectId={encryptExpectId}&mixExpectType=&expectInfo=&jobType=1901&salary=405&experience=106,105&degree=204,203&industry=100020,100012&scale=302,303&_=1785992074619
```

多选值通过原始查询参数替换逻辑写入，逗号保持字面形式，例如 `experience=106,105`，
不会输出为 `%2C`。

没有选择的参数仍保留为空值，不删除参数名称：

```text
&salary=&experience=&degree=&industry=&scale=
```

`encryptExpectId` 始终来自当前选择的目标职位，不能从筛选配置覆盖。

## 9. 分页、暂停和风控恢复

第一页根据任务配置生成完整推荐列表 URL。任务开始后，后续分页只替换：

```text
page
```

其他查询参数、参数顺序和任务配置保持不变。

后台运行状态继续保存完整 `recommendedListUrl`。`code=37` 刷新恢复、手动暂停后继续以及
页面重新注入内容脚本时，使用保存的 URL 恢复。为兼容旧运行记录，恢复启动时可使用运行
配置再次覆盖筛选参数；旧任务没有 `bossRecommendFilters` 时使用空参数。取消暂停任务时，
内容脚本会唤醒限速等待并中止当前可取消的页面请求；环境异常刷新后的后台暂停任务可直接
取消，不依赖页面中仍存在运行实例。

## 9.1 检索模式

岗位来源切换为“检索模式”后，请求：

```http
POST https://www.zhipin.com/wapi/zpgeek/search/joblist.json?_=<任务启动时间>
Content-Type: application/x-www-form-urlencoded
```

请求体包含 `page`、`pageSize=15`、`query`、`city`、`jobType`、`experience`、`degree`、
`scale`、`stage`、`salary`、`industry`、`multiSubway`、`multiBusinessDistrict`、`position`
和固定的 `scene=1`。分页只修改 body 中的 `page`；调试日志同时输出请求 URL 和原始
`Request payload`。区域、地铁和职位类型元数据在选择城市后按需读取，并复用 30 天缓存。

## 10. 猎聘隔离

猎聘与 BOSS 筛选保持隔离：

- 猎聘不请求 BOSS 城市、筛选条件或行业接口。
- 猎聘推荐岗位请求不增加 BOSS 筛选参数；只按“最新/综合”写入自身的 `data.sortType`。
- 猎聘面板不显示推荐岗位筛选区域。
- 切换至猎聘不会清除 BOSS 已保存的筛选选择。
- 切回 BOSS 后恢复 BOSS 的选择和元数据缓存。

## 11. 文件修改范围

| 文件 | 修改内容 |
| --- | --- |
| `auto-message-panel.html` | 增加推荐岗位筛选区域、下拉层和对应样式 |
| `src/auto-message-panel.js` | 配置规范化、缓存读取、筛选渲染、交互、保存和启动快照 |
| `src/boss-auto-greeting.js` | 元数据请求、响应标准化、推荐 URL、检索 POST、分页、恢复和取消处理 |
| `src/boss-hook.js` | 增加元数据与检索接口的页面请求白名单 |
| `src/background.js` | 转发筛选元数据读取消息 |
| `docs/zhipin-auto-greeting-plan.md` | 实施完成后同步主自动招呼文档中的配置和 URL 说明 |

实现时必须保留工作区内 `src/auto-message-panel.js` 和 `src/background.js` 已存在的未提交
修改，在其基础上增量合并。

## 12. 验收标准

### 12.1 配置和界面

1. BOSS 面板显示推荐及检索模式对应条件，猎聘面板不显示 BOSS 筛选。
2. 城市、求职类型、推荐薪资只能单选。
3. 工作经验、学历、行业、公司规模支持多选。
4. “不限”与具体选项互斥，重新打开面板后选择正确恢复。
5. 城市和行业搜索不会改变未确认的已选项。
6. 旧配置能够正常加载，新增条件默认不限。

### 12.2 缓存

1. 首次打开 BOSS 面板请求四个全局元数据接口并写入缓存。
2. 30 天内再次打开不请求元数据接口。
3. 超过 30 天后重新请求并替换缓存。
4. 刷新中任一接口失败时不写入部分缓存。
5. 过期缓存存在时可以回退使用，并保持原过期时间。
6. 没有可用缓存且请求失败时禁用新增筛选，但不影响其他功能。
7. 缓存版本不匹配时触发重新请求。

### 12.3 推荐列表请求

1. 全部不限时生成的查询行为与当前版本一致。
2. 示例配置生成全部七个参数及正确编码。
3. 多选参数使用逗号连接且输出顺序稳定。
4. 第二页及后续页保留全部筛选参数。
5. 暂停继续及 `code=37` 刷新恢复后参数不丢失。
6. 任务运行期间修改面板配置不会改变当前任务 URL。
7. 猎聘推荐岗位请求不携带任何 BOSS 筛选参数。

### 12.4 工程验证

完成实现后执行：

```bash
npm run check
npm run build
```

同时在日志模式下核对实际推荐列表请求 URL、缓存命中、缓存过期刷新和过期缓存回退行为。
