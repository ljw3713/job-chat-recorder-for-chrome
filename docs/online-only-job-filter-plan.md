# “仅在线”岗位过滤修改方案

## 1. 目标与范围

扩展弹窗在“查看记录总览”按钮下方增加“仅在线”复选框。设置按当前标签页保存，
修改后需要刷新招聘页面才能生效，悬停“仅在线”文字时立即显示自定义刷新提示。

第一期根据已提供的 BOSS 直聘接口和页面结构实现：

- 目标接口：`https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json`
- 离线条件：岗位对象的 `bossOnline === false`
- 关联标识：`encryptJobId`
- 岗位卡片：`.job-card-box`
- 处理方式：卡片或其下级链接的 `href` 包含离线岗位 `encryptJobId` 时，删除整张
  `.job-card-box` 卡片。

猎聘暂不执行过滤，但网络捕获、标签页设置和 DOM 过滤采用适配器边界设计，后续获得
猎聘接口和 DOM 样例后可以增加猎聘适配器，而不需要重写弹窗和标签页状态管理。

## 2. 弹窗交互

在 `overviewBtn` 下方新增复选框：

```text
☐ 仅在线
```

交互规则：

1. BOSS 页面允许勾选，猎聘和不支持的网站禁用。
2. 悬停“仅在线”文字时，通过 `data-tooltip` 和 CSS `:hover` 立即显示“修改后需要刷新当前招聘页面才能生效”。
3. 勾选或取消只保存设置，不立即修改当前页面。
4. 勾选后刷新，离线岗位卡片会被删除。
5. 取消后刷新，网站重新渲染完整列表，从而恢复此前被删除的岗位。

## 3. 标签页状态

使用 `chrome.storage.session` 保存按标签页隔离的状态：

```json
{
  "jobChatOnlineOnlyTabs": {
    "123": true
  }
}
```

弹窗通过后台消息读取和写入指定 `tabId`。内容脚本刷新启动时通过后台读取当前
`sender.tab.id` 的状态。标签页关闭时，后台删除对应条目，避免状态长期残留。

## 4. 网络捕获

复用 BOSS 页面在 `document_start`、`MAIN` world 安装的 `boss-hook.js`，避免重复包装
`fetch` 和 `XMLHttpRequest`。

只处理 hostname 为 `www.zhipin.com` 且 pathname 为
`/wapi/zpgeek/pc/recommend/job/list.json` 的响应；查询参数不参与匹配。

Fetch 使用 `response.clone()` 读取 JSON，XHR 在 `load` 事件读取 JSON。读取失败、
`code !== 0` 或 `zpData.jobList` 不是数组时不操作页面。完整响应只存在页面内存，不写入
扩展存储或日志。

## 5. 刷新竞态

页面刷新时，推荐岗位请求可能早于内容脚本完成异步状态读取。为避免漏掉第一批响应：

1. `boss-hook.js` 在 `document_start` 同步安装网络包装。
2. 开关状态确认前，目标响应中提取出的离线岗位 ID 暂存在页面内存。
3. 内容脚本读取状态后通知 Hook。
4. 开启时立即发送缓存 ID；关闭时清空缓存。

只缓存提取后的 `encryptJobId`，不缓存完整响应。

## 6. 响应解析

离线岗位标识提取规则：

```js
payload.zpData.jobList
  .filter((job) => job?.bossOnline === false)
  .map((job) => String(job?.encryptJobId || '').trim())
  .filter(Boolean)
```

必须使用严格布尔判断。`bossOnline` 缺失、为 `null` 或其他未知值时保留岗位，避免误删。

## 7. DOM 过滤

内容脚本维护当前页面已识别的离线岗位 ID 集合。每次收到新 ID 后扫描
`.job-card-box`：

1. 检查卡片自身以及下级所有 `[href]` 元素。
2. 任意 href 包含离线 `encryptJobId` 即命中。
3. 调用 `card.remove()` 删除整张卡片；子元素随父元素一起删除。

使用 `MutationObserver` 处理无限滚动、翻页和前端重新渲染。后续重新插入的同一离线
岗位仍会被删除。操作保持幂等。

### 7.1 过滤后的自动补量

删除大量离线卡片后，左侧列表可能不足以撑出页面滚动距离，导致 BOSS 原有的滚动分页
无法触发。目标响应因此同时向内容脚本传递 `hasMore` 和请求生命周期。

每批过滤结束后检查 `.job-list-container` 底部和页面底部到视口的距离。如果已经进入
160px 阈值且 `hasMore === true`，向 BOSS 页面派发滚动信号，触发页面自己的分页逻辑，
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
    ├── boss：本期实现
    └── liepin：预留
```

站点适配器负责请求目标、响应标识和 DOM 卡片匹配；通用控制器负责状态、调度和动态
DOM 生命周期。

## 9. 验证清单

- 勾选但不刷新时当前页面不变化。
- 勾选并刷新后捕获目标 Fetch/XHR 请求。
- 只删除 `bossOnline === false` 且能匹配 `encryptJobId` 的岗位。
- 在线、状态缺失、ID 缺失、接口异常和无效 JSON 均不误删。
- 带查询参数的目标接口仍能命中。
- 无限滚动或重新渲染的离线岗位会继续删除。
- 首批过滤后列表不足一屏且 `hasMore === true` 时会自动触发后续岗位加载。
- 自动补量在列表形成滚动距离、无更多数据或达到安全上限时停止。
- 两个 BOSS 标签页的开关互不影响。
- 取消勾选并刷新后恢复完整列表。
- 猎聘页面不执行 BOSS 过滤规则。
- `npm run check` 与 `npm run build` 通过。
