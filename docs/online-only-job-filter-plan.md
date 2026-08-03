# 岗位过滤修改方案

## 1. 目标与范围

扩展弹窗在“查看记录总览”按钮下方增加“仅在线”复选框。设置按当前标签页保存，
修改后需要刷新招聘页面才能生效，悬停“仅在线”文字时立即显示自定义刷新提示。

在“仅在线”下方增加“不显示”复选框和关键字输入框。关键字使用 `|` 分隔，例如
`外包|培训|保险`；启用后按公司或招聘者名称过滤包含任一关键字的岗位。

当前支持 BOSS 直聘和猎聘，并按站点使用独立的接口与 DOM 规则。

### BOSS 直聘

- 目标接口：`https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json`
- 离线条件：岗位对象的 `bossOnline === false`
- 关联标识：`encryptJobId`
- 岗位卡片：`.job-card-box`
- 处理方式：卡片或其下级链接的 `href` 包含离线岗位 `encryptJobId` 时，删除整张
  `.job-card-box` 卡片。

### 猎聘

- 目标接口：`POST https://www.liepin.com/api/com.liepin.csearch.home-recommend-job-new`
- 离线条件：记录的 `recruiter.imStatus === false`
- 关联标识：`job.link`
- 岗位卡片：`.pull-up-li`
- 处理方式：读取卡片内 `a[data-nick="job-detail-job-info"][href]` 的岗位详情链接，与离线
  岗位 `job.link` 归一化后匹配时，隐藏整张 `.pull-up-li` 卡片，但不从 DOM 中移除。

## 2. 弹窗交互

在 `overviewBtn` 下方新增复选框：

```text
☐ 仅在线
☐ 不显示 [输入不想看到的关键字，用|分割]
```

交互规则：

1. BOSS 和猎聘页面允许勾选，不支持的网站禁用。
2. 悬停“仅在线”文字时，通过 `data-tooltip` 和 CSS `:hover` 立即显示“修改后需要刷新当前招聘页面才能生效”。
3. 勾选或取消只保存设置，不立即修改当前页面。
4. 勾选后刷新，BOSS 离线岗位卡片会被删除，猎聘离线岗位卡片会被折叠隐藏。
5. 取消后刷新，网站重新渲染完整列表，从而恢复此前被过滤的岗位。
6. “不显示”开关同样按当前标签页保存；输入框内容跨标签页、浏览器重启持久化。
7. 输入框为空时以浅灰色 placeholder 显示“输入不想看到的关键字，用|分割”。
8. 关键字按 `|` 拆分并去除首尾空白，空关键字忽略，英文匹配不区分大小写。
9. “不显示”未勾选或没有有效关键字时，不执行公司名称过滤。

## 3. 标签页状态

使用 `chrome.storage.session` 保存按标签页隔离的状态：

```json
{
  "jobChatOnlineOnlyTabs": {
    "123": true
  }
}
```

“不显示”复选框使用同类的 `chrome.storage.session` 按标签页保存；关键字原始输入使用
`chrome.storage.local` 的 `jobChatCompanyFilterKeywords` 保存，保证关闭弹窗或重启浏览器后
仍然保留。

弹窗通过后台消息读取和写入指定 `tabId`。内容脚本刷新启动时通过后台读取当前
`sender.tab.id` 的状态。标签页关闭时，后台删除对应条目，避免状态长期残留。

## 4. 网络捕获

两站点均在 `document_start`、`MAIN` world 安装网络 Hook：BOSS 复用已有的
`boss-hook.js`，猎聘使用独立的 `liepin-online-job-hook.js`。两者只包装各自页面的
`fetch` 和 `XMLHttpRequest`。

只处理 hostname 为 `www.zhipin.com` 且 pathname 为
`/wapi/zpgeek/pc/recommend/job/list.json` 的响应；查询参数不参与匹配。

Fetch 使用 `response.clone()` 读取 JSON，XHR 在 `load` 事件读取 JSON。读取失败、
`code !== 0` 或 `zpData.jobList` 不是数组时不操作页面。完整响应只存在页面内存，不写入
扩展存储或日志。

猎聘只处理 Liepin 域名、pathname 为
`/api/com.liepin.csearch.home-recommend-job-new` 且 method 为 `POST` 的响应；查询参数不
参与匹配。读取失败、`flag !== 1` 或 `data.data` 不是数组时不操作页面。

## 5. 刷新竞态

页面刷新时，推荐岗位请求可能早于内容脚本完成异步状态读取。为避免漏掉第一批响应：

1. 对应站点 Hook 在 `document_start` 同步安装网络包装。
2. 开关状态确认前，目标响应中提取出的离线岗位 ID 暂存在页面内存。
3. 内容脚本读取状态后通知 Hook。
4. 开启时立即发送缓存 ID；关闭时清空缓存。

只缓存提取后的 `encryptJobId` 或岗位链接，不缓存完整响应。

## 6. 响应解析

离线岗位标识提取规则：

```js
payload.zpData.jobList
  .filter((job) => job?.bossOnline === false)
  .map((job) => String(job?.encryptJobId || '').trim())
  .filter(Boolean)
```

必须使用严格布尔判断。`bossOnline` 缺失、为 `null` 或其他未知值时保留岗位，避免误删。

猎聘离线岗位链接提取规则：

```js
payload.data.data
  .filter((item) => item?.recruiter?.imStatus === false)
  .map((item) => String(item?.job?.link || '').trim())
  .filter(Boolean)
```

分页状态使用 `payload.data.hasNextPage === true`。`imStatus` 缺失、为 `null` 或其他未知
值时保留岗位。

## 7. DOM 过滤

内容脚本维护当前页面已识别的离线岗位 ID 集合。每次收到新 ID 后扫描
`.job-card-box`：

1. 检查卡片自身以及下级所有 `[href]` 元素。
2. 任意 href 包含离线 `encryptJobId` 即命中。
3. 调用 `card.remove()` 删除整张卡片；子元素随父元素一起删除。

使用 `MutationObserver` 处理无限滚动、翻页和前端重新渲染。后续重新插入的同一离线
岗位仍会被过滤。操作保持幂等。

猎聘适配器扫描 `.pull-up-li`，只读取卡片内
`a[data-nick="job-detail-job-info"][href]`。接口返回的绝对链接与页面中的相对/绝对链接
统一通过 `new URL()` 归一化为 pathname，忽略 `pgRef`、`d_sfrom` 等查询参数后精确
匹配。命中时添加扩展专用隐藏类，以 `display: none !important` 折叠整张卡片；未命中时
移除隐藏类，以兼容 React 复用已有节点的情况。

猎聘列表和求职期望 Tab 属于同一 React 渲染树。不能对 React 管理的 `.pull-up-li` 调用
`card.remove()`：切换 `.tab-item-title--XzIyN` 时 React 会再次卸载旧卡片，从而触发
`removeChild` 的 `NotFoundError`。视觉隐藏保留 React 对节点的所有权，同时仍能达到“仅
显示在线”和折叠列表空间的效果。BOSS 适配器继续按原规则删除卡片。

### 7.1 公司关键字过滤

- BOSS：扫描 `.job-card-box`，读取卡片内 `.boss-name` 的文本；包含任一关键字时删除整张
  卡片。
- 猎聘：扫描 `.pull-up-li`，使用 `[class*="company-name-"]` 兼容构建生成的
  `company-name--ZTI3Z` 等类名；包含任一关键字时添加扩展专用隐藏类。
- “仅在线”和“不显示”为或关系，岗位命中任意一个启用的过滤条件就会被过滤。
- `MutationObserver` 同时观察新增节点、岗位链接变化和公司文本变化，继续处理无限滚动和
  React 重新渲染产生的岗位。

### 7.2 过滤后的自动补量

过滤大量离线卡片后，列表可能不足以撑出页面滚动距离，导致网站原有的滚动分页无法
触发。BOSS 传递 `hasMore`，猎聘传递 `hasNextPage`，两者统一为内容脚本中的
`hasMore`，并同时传递请求生命周期。

每批过滤结束后检查 `.job-list-container` 底部和页面底部到视口的距离。如果已经进入
160px 阈值且 `hasMore === true`，向当前站点页面派发滚动信号，触发页面自己的分页逻辑，
而不是由扩展直接拼接分页参数请求接口。下一批响应到达后重复过滤和检查，直到列表足够
滚动、`hasMore === false` 或达到连续自动补量上限。

自动补量使用请求中互斥锁、1.2 秒启动确认、15 秒完成超时和最多连续 10 次补量，避免
重复请求或无限循环。用户正常滚动发起新请求时会重置连续补量计数。

## 8. 兼容性边界

内容脚本的过滤模块按站点适配：

```text
在线岗位过滤控制器
├── 标签页状态与生命周期
├── 离线标识集合
├── MutationObserver
└── 站点适配器
    ├── boss：encryptJobId + .job-card-box
    └── liepin：job.link + .pull-up-li
```

站点适配器负责请求目标、响应标识和 DOM 卡片匹配；通用控制器负责状态、调度和动态
DOM 生命周期。

## 9. 验证清单

- 勾选但不刷新时当前页面不变化。
- 勾选并刷新后捕获目标 Fetch/XHR 请求。
- 只删除 `bossOnline === false` 且能匹配 `encryptJobId` 的岗位。
- 猎聘只隐藏 `recruiter.imStatus === false` 且能匹配 `job.link` 的岗位。
- 猎聘接口必须是指定 pathname 的 POST 请求，GET 和其他接口不处理。
- 猎聘绝对链接与页面相对链接可以正确匹配，其他岗位链接不误删。
- 在线、状态缺失、ID 缺失、接口异常和无效 JSON 均不误删。
- 带查询参数的目标接口仍能命中。
- 无限滚动或重新渲染的离线岗位会继续按站点规则过滤。
- 猎聘过滤后切换求职期望 Tab 不出现 React `removeChild` 异常，新 Tab 的列表继续过滤。
- “不显示”未勾选时不按关键字过滤；勾选但输入为空时不误删岗位。
- `外包|培训` 能分别匹配包含“外包”或“培训”的公司/招聘者名称。
- BOSS 只检查 `.boss-name`，猎聘只检查 `[class*="company-name-"]`，不匹配职位名称等其他文本。
- 关键字输入关闭弹窗或重启浏览器后仍然保留。
- 首批过滤后列表不足一屏且 `hasMore === true` 时会自动触发后续岗位加载。
- 自动补量在列表形成滚动距离、无更多数据或达到安全上限时停止。
- BOSS 与猎聘不同标签页的开关互不影响。
- 取消勾选并刷新后恢复完整列表。
- 两站点只执行自己的接口和 DOM 过滤规则。
- `npm run check` 与 `npm run build` 通过。
