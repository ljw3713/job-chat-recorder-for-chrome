# 直聘|猎聘 沟通助手

一个用于同步、整理招聘平台沟通记录，并向已有联系人批量发送文本消息的 Chrome 扩展。当前支持 BOSS 直聘 `zhipin.com` 和猎聘 `liepin.com`。

## 功能

- 根据当前标签页网址自动选择提取规则
- 当前支持：BOSS 直聘 `zhipin.com`、猎聘 `liepin.com`
- 暂不支持的网站会提示“暂不支持当前网站”
- 提取字段：公司、岗位、沟通日期、备注、招聘者信息、原消息
- 备注支持双击编辑；公司和岗位悬浮可查看同步到的详情
- 支持按来源、公司、消息状态和日期筛选，并按公司、岗位、招聘者和原消息进行多关键词搜索
- 支持“只显示今天沟通”、排序、忽略记录及批量删除
- 支持复制表格、下载 CSV、复制 JSON
- 支持同步 BOSS 直聘和猎聘岗位详情，并在总览页对选中记录重新获取
- 支持向当前登录账号下已有的 BOSS、猎聘联系人批量发送纯文本消息
- 支持发送速率设置、停止发送、逐条状态和失败备注；调试参数可开启完整流程日志，认证及联系人凭据自动脱敏

## BOSS 批量发送

在总览页选中 BOSS 记录后，点击“发送信息”即可创建发送批次：

1. 输入不超过 1000 字的纯文本消息。
2. 设置每分钟发送数量；默认 10，只限制最小值为 1。
3. 点击“发送”。发送期间按钮变为“停止”，可终止尚未发送的记录。
4. 每条记录只显示“等待”“成功”或“失败”；失败原因显示在最右侧“备注”栏。

扩展会优先复用同步时保存的 `friendId` 和 `peerKey`。旧记录信息不全时，会从当前登录账号的联系人接口自动补齐并回写本地记录；单条记录补全或发送失败不会阻断后续记录。确实无法补齐的记录会提示“标识不全，需要重新同步记录再发送”。

发送不要求打开 BOSS 聊天页。扩展会选择最近访问的 `*.zhipin.com` 标签页并使用该页面的当前登录态；本版本不处理同一浏览器同时登录多个 BOSS 账号的场景。成功收到发送 ACK 后，会更新该记录的原消息和更新时间，并将消息状态设为未读。

开发版结果页标题右侧显示 `log` 和 `debug` 两个开关，默认均开启，也可以通过 URL 参数覆盖，例如 `log=false&debug=false`。打包版不显示开关且默认关闭，但仍可通过 `log=true` 或 `debug=true` 临时启用；`debug` 用于控制总览页内部数据导入导出。

## 猎聘批量发送

在总览页选中同一批猎聘记录后，可以复用“发送信息”弹窗发送纯文本。扩展优先使用
同步保存的 `oppositeUserId`；旧记录缺失时，会从聊天列表补全并回写。当前账号的
`imClientId` 按 `imId` 缓存，切换账号后不会复用其他账号的数据。详细协议见
[猎聘批量发送文本消息](docs/liepin_send_msg.md)。

## 岗位详情同步

同步页会为新增或信息不完整的记录补齐岗位详情；总览页可以选中记录后使用“更新岗位详情”强制刷新。BOSS 直聘刷新时先从当前联系人列表校验目标关系，再获取联系人和岗位详情。同一个招聘者的不同岗位始终按完整 `recordKey` 区分，不会用当前岗位覆盖历史岗位。

如果 BOSS 目标已不在近期联系人列表中，或招聘者当前关联岗位已经变化，原记录会保留并标记为同步成功，岗位信息显示“最近沟通时间超过30天，无法获取详情”。这表示平台当前接口已无法提供该历史岗位，并非根据记录日期在扩展内计算 30 天。

岗位同步日志仅在当前结果页内存中一次性显示，刷新或关闭页面后即丢失，不写入 `chrome.storage.local`。

## 猎聘支持说明

猎聘数据来自当前登录页面可访问的接口：

- `com.liepin.im.c.contact.get-contact-list` 获取最近沟通列表
- `com.liepin.im.c.chat.job-preview` 获取岗位概览

扩展会从当前页面 Cookie / 缓存读取 `imId_0`，仅拉取当天 `latestMsgTime` 的记录，并将 `jobTitle` 与 `jobSalary` 合并显示在“岗位”列中。详情请求会按同步页设置的“每 时/分/秒 同步 N 条”均匀执行，避免过于频繁。

## 导出字段

| 字段       | 说明                                                    |
| ---------- | ------------------------------------------------------- |
| 公司       | 招聘者所属公司                                          |
| 岗位       | 岗位名；猎聘会附带薪资，例如 `后端开发工程师（30-50k）` |
| 沟通日期   | 统一输出为 `YYYY-MM-DD`                                 |
| 备注       | 可手动编辑                                              |
| 招聘者信息 | 名字 / title                                            |
| 原消息     | 沟通列表中的原始消息                                    |

普通模式的 JSON 和 CSV 只导出公开字段。总览页使用 `debug=true` 后，JSON 会包含完整记录，CSV 会增加“内部数据”列；此时导入 CSV 可以按“唯一索引id”新增记录，或覆盖已有记录的内部字段。打包版虽然不显示 `debug` 复选框，仍支持该 URL 参数。

## 安装开发版

1. 克隆或下载本项目
2. 打开 Chrome：`chrome://extensions/`
3. 开启右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择本项目根目录

### 开发版 GA4 配置

本地开发版会在 `enableDebugLog=true` 时自动读取
`src/runtime-config.local.js`。打开该文件并填写：

```js
(function () {
  Object.assign(globalThis.JobChatRuntimeConfig, {
    analyticsEnabled: true,
    ga4MeasurementId: 'G-XXXXXXXXXX',
    ga4ApiSecret: '你的 Measurement Protocol API Secret'
  });
})();
```

保存后回到 `chrome://extensions/`，点击扩展卡片上的“重新加载”。该文件已经加入
`.gitignore`，不会被 Git 提交，也不在正式打包文件清单中。可提交的字段示例保存在
`src/runtime-config.local.example.js`，不要把真实 Secret 写入示例文件。

开发版发送到 GA4 的 `extension_version` 会在 manifest 版本后自动追加 `-dev`，
例如当前开发版为 `5.2.0-dev`；正式打包时会自动关闭开发模式，并上报 `5.2.0`。
`manifest.version` 始终保持 Chrome 要求的纯数字格式，不直接写入 `-dev`。

### 评分提示配置和开发重置

评分提示配置位于 `src/runtime-config.js` 的 `ratingPrompt`：

```js
ratingPrompt: {
  storageKey: 'jobChatRatingPromptState',
  clickThreshold: 10,
  storeUrl: 'Chrome Web Store 插件页地址'
}
```

`clickThreshold: 10` 表示第 11 次点击同步按钮时提示。每个用户实际的点击次数和
是否已经处理弹窗仍保存在 `chrome.storage.local` 的 `jobChatRatingPromptState`
中，不能写在静态配置文件里。

开发时重新加载扩展不会重置该状态。需要重新测试弹窗时，在扩展结果页的
DevTools Console 中执行：

```js
await chrome.storage.local.remove('jobChatRatingPromptState')
```

版本更新同样保留 `chrome.storage.local`，因此不会重新计数或再次提示。卸载扩展会
清除该扩展的本地存储，重新安装后会从 0 开始计数。

需要快速测试时，可以临时把 `src/runtime-config.js` 中的 `clickThreshold` 改为
`0`，并删除已有状态；测试结束后恢复为 `10`。

## Chrome 商店打包

打包环境需要 Node.js 18 或更高版本。首次打包先安装锁定的开发依赖：

```bash
npm ci
```

打包产物会输出到 `dist/job-chat-recorder-v{manifest版本号}.zip`。源码中的 `manifest.name` 带有 `-dev` 后缀，便于区分本地加载的开发版；正式打包时脚本会自动移除该后缀。脚本只会打包扩展运行和商店上传必需的文件，包括 `manifest.json`、页面文件、脚本文件和 manifest 引用的图标，不会包含源码管理文件、README、CHANGELOG、打包脚本或历史产物。

打包阶段使用锁定版本的 `esbuild` 压缩全部 JavaScript：删除注释和多余空白，并进行安全的语法压缩；不生成 source map，也不执行字符串加密、控制流改写等代码混淆。由于扩展的多个脚本通过全局函数协作，压缩过程会保留标识符名称，避免跨文件调用失效。源文件不会被修改，压缩只发生在临时打包目录中。

命令完成后会输出 JavaScript 压缩前后的字节数。正式包还会把 `src/runtime-config.js` 中的 Debug 日志默认值关闭；可以使用以下命令检查压缩包完整性：

```bash
unzip -t dist/job-chat-recorder-v{manifest版本号}.zip
```

匿名统计使用 GA4 Measurement Protocol 直连。执行以下命令后，脚本会询问
Measurement ID，并隐藏输入 API Secret：

```bash
npm run package
```

脚本不会把输入写入源码、命令参数或构建日志。CI 等非交互环境可以提前设置：

```text
JOB_CHAT_GA4_MEASUREMENT_ID=G-XXXXXXXXXX
JOB_CHAT_GA4_API_SECRET=你的 Measurement Protocol API Secret
```

需要明确生成不包含 GA4 配置的包时，使用强制跳过参数：

```bash
npm run package -- --skip-ga4
# 或
npm run package:skip-ga4
```

`--skip-ga4` 会忽略当前环境中已有的 GA4 变量，并输出统计关闭的包。没有该参数时，
非交互环境中任一变量缺失都会导致打包失败。打包脚本不会输出密钥，也不会修改源码中的空配置。
由于 Chrome 扩展可以被下载和反编译，注入后的 API Secret 最终仍能从发布包中提取；
应为扩展使用独立 GA4 数据流，并定期轮换 Secret。完整事件、维度和 GA4 配置参见
[`docs/ga4-analytics-plan.md`](docs/ga4-analytics-plan.md)。

### 构建和 CI 检查

本地构建命令会生成关闭 GA4 的验证包，不要求提供 Measurement ID 或 API Secret：

```bash
npm run build
```

CI 命令会检查 `src/` 和 `scripts/` 下全部 JavaScript 的语法，验证 manifest、HTML
和打包清单引用的文件都存在且会进入发布包，然后执行一次完整构建：

```bash
npm run ci
```

## 使用方式

1. 打开 BOSS 直聘或猎聘页面，并确认已登录
2. 点击 Chrome 工具栏中的扩展图标
3. 在 BOSS 推荐岗位页可勾选“仅在线”并刷新页面，隐藏招聘者不在线的岗位
4. 点击“同步当前聊天记录”
5. 在同步结果页确认并保存记录
6. 在总览页筛选、搜索、编辑、导出记录；选中同一网站的记录后可批量发送文本消息

## 项目结构

```text
.
├── package.json
├── manifest.json
├── popup.html
├── results.html
├── src/
│   ├── analytics.js
│   ├── background.js
│   ├── background-database.js
│   ├── boss-extractor.js
│   ├── boss-hook.js
│   ├── boss-message-protocol.js
│   ├── boss-no-debug-guard.js
│   ├── content.js
│   ├── content-common.js
│   ├── job-sync-core.js
│   ├── liepin-extractor.js
│   ├── popup.js
│   ├── results.js
│   ├── results-database.js
│   ├── runtime-config.js
│   ├── runtime-config.local.example.js
│   ├── shared-records.js
│   ├── shared-utils.js
│   └── site-adapters.js
├── scripts/
│   ├── check-extension.js
│   ├── package-extension.js
│   └── package-with-ga4.js
├── docs/
│   ├── zhipin.md
│   ├── zhipin_send_msg.md
│   ├── liepin.md
│   ├── liepin_send_msg.md
│   └── ga4-analytics-plan.md
├── assets/
│   └── icons/
│       ├── icon-16.png
│       ├── icon-32.png
│       ├── icon-48.png
│       ├── icon-128.png
│       ├── icon-512.png
│       ├── logo-small-48.png
│       └── logo-large-128.png
└── README.md
```

## 推送到 GitHub

```bash
git init
git add .
git commit -m "Initial Chrome extension"
git branch -M main
git remote add origin git@github.com:ljw3713/boss-zhipin-chat-recorder-for-chrome.git
git push -u origin main
```

## 隐私说明

本扩展只读取当前登录态可访问的招聘沟通数据。同步结果、联系人发送标识和发送进度保存在本地浏览器扩展存储中；岗位同步和批量发送日志只在当前结果页内存中临时展示。聊天内容、账号 ID、公司和岗位信息、Cookie、HTTP token、`wt2`、搜索关键词、完整 URL 及原始错误信息不会发送到统计服务。

配置 GA4 后，扩展会直接向 Google Analytics 发送匿名安装、每日活跃、同步结果、保存记录数量和 CSV 下载数量，以及插件版本、招聘平台、页面类型、地区近似值、操作系统、系统架构和 Chrome 版本。匿名安装 ID 不来自招聘网站账号，也不用于识别自然人。用户可以在结果页表格下方关闭“允许匿名使用统计”，关闭后不再发送新事件。

“允许匿名使用统计”默认开启。用户主动关闭后，选择保存在
`chrome.storage.local`，扩展更新不会重新开启。

扩展卸载后无法继续执行代码，因此本实现不向 GA4 发送自定义卸载事件，卸载量继续以 Chrome Web Store 后台统计为准。

只有用户主动点击“发送”时，扩展才会通过当前招聘网站页面的登录态向所选已有联系人发送消息。
