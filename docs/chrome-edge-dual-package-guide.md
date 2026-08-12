# Chrome 与 Microsoft Edge 双浏览器打包方案

本文说明如何在不复制源码、不维护长期浏览器分支的前提下，将当前 Chromium
扩展分别打包为 Chrome Web Store 和 Microsoft Edge Add-ons 可上传的 ZIP。

> 当前状态：本方案已实现。使用 `package:chrome`、`package:edge` 或 `package:all`
> 可分别或同时生成两个商店的发布 ZIP。

## 1. 目标

使用同一份 `manifest.json`、HTML、JavaScript 和图标源码，生成：

```text
dist/job-chat-recorder-chrome-v{version}.zip
dist/job-chat-recorder-edge-v{version}.zip
```

两个发布包的业务代码保持一致，只允许构建阶段产生这些差异：

| 项目 | Chrome 包 | Edge 包 |
| --- | --- | --- |
| 目标浏览器 | `chrome` | `edge` |
| 评分链接 | Chrome Web Store 商品页 | Microsoft Edge Add-ons 商品页 |
| 最低版本字段 | 保留 `minimum_chrome_version` | 建议从发布包移除 |
| ZIP 文件名 | 包含 `chrome` | 包含 `edge` |
| 调试日志默认值 | 关闭 | 关闭 |
| GA4 配置 | 根据相同打包参数注入 | 根据相同打包参数注入 |

Microsoft 官方说明，Chrome 支持的扩展 API 和清单键通常与 Edge 代码兼容，
移植工作应先检查 API、删除 `update_url`、处理浏览器品牌文字并旁加载测试：

- [将 Chrome 扩展移植到 Microsoft Edge](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/developer-guide/port-chrome-extension)
- [为 Microsoft Edge 边栏开发扩展](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/developer-guide/sidebar)
- [发布 Microsoft Edge 扩展](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/publish/publish-extension)

当前项目没有 `update_url`，扩展名称也不包含 `Chrome`。`chrome.sidePanel`、工具栏
弹窗、内容脚本和脚本注入均有 Edge 官方支持，因此不需要为 Edge 重写核心功能。

## 2. 设计原则

### 2.1 不维护两套源码

不要创建以下目录：

```text
src-chrome/
src-edge/
manifest.chrome.json
manifest.edge.json
```

浏览器差异应只存在于打包脚本对暂存目录的转换中。源码目录始终保持一个可旁加载的
开发版本，避免修复功能时遗漏另一个浏览器。

### 2.2 不修改源码生成发布包

打包脚本只能修改 `dist/` 下的临时暂存文件，不能覆盖：

- 根目录 `manifest.json`；
- `src/runtime-config.js`；
- 任何业务源码。

打包完成或失败后都应清理对应暂存目录。

### 2.3 默认行为

为了避免现有 CI 和发布流程突然改变：

- `node scripts/package-extension.js` 默认构建 Chrome；
- `npm run build` 构建关闭 GA4 的 Chrome 验证包；
- `npm run ci` 执行语法、引用以及 Chrome 和 Edge 验证构建；
- `build:edge`、`build:all`、`package:edge` 和 `package:all` 提供明确的目标浏览器选择。

## 3. 需要修改的文件

本方案修改以下文件：

```text
package.json
scripts/package-extension.js
scripts/package-with-ga4.js
src/results.js
```

如需在 README 中公开 Edge 安装方式，可额外修改 `README.md`，但这不是生成双包的
必要条件。

## 4. 打包参数设计

### 4.1 浏览器参数

为 `scripts/package-extension.js` 增加：

```text
--browser=chrome
--browser=edge
--browser=all
```

规则：

- 未传 `--browser` 时默认为 `chrome`；
- 不接受其他值，遇到未知值立即失败；
- `all` 按顺序生成 Chrome 和 Edge 两个 ZIP；
- 两个浏览器使用独立暂存目录，避免文件相互污染。

建议暂存目录：

```text
dist/.extension-package-chrome/
dist/.extension-package-edge/
```

### 4.2 商店链接

当前 `src/runtime-config.js` 的 `ratingPrompt.storeUrl` 固定为 Chrome Web Store。
建议通过环境变量向发布包注入对应商店链接：

```text
JOB_CHAT_CHROME_STORE_URL
JOB_CHAT_EDGE_STORE_URL
```

规则：

1. Chrome 未设置环境变量时，可以继续使用源码中的现有 Chrome Web Store 链接。
2. Edge 未设置 `JOB_CHAT_EDGE_STORE_URL` 时，将 Edge 包中的 `storeUrl` 设为空字符串。
3. `src/results.js` 在 `storeUrl` 为空时不得展示评分提示。
4. 不允许 Edge 包回退到 Chrome Web Store 链接。
5. 首次提交 Edge 商店、尚未取得商品链接时，可以生成不显示评分提示的 Edge 包。

`src/results.js` 中的常量也应从浏览器特定名称：

```js
const CHROME_WEB_STORE_URL = String(ratingPromptConfig.storeUrl || '');
```

改为中性名称：

```js
const RATING_STORE_URL = String(ratingPromptConfig.storeUrl || '');
```

`countSyncClickAndMaybeShowRatingPrompt()` 应在计数前检查：

```js
if (!RATING_STORE_URL) return;
```

打开商店页时也统一使用 `RATING_STORE_URL`。

### 4.3 GA4 参数

保留当前变量：

```text
JOB_CHAT_GA4_MEASUREMENT_ID
JOB_CHAT_GA4_API_SECRET
```

`--browser=all` 应只读取或询问一次 GA4 配置，再将相同配置传给两个包。不要为两个
浏览器重复询问，也不要在日志中输出 API Secret。

如果以后需要区分 Chrome 和 Edge 数据，可在匿名事件中增加不含用户信息的
`browser_target=chrome|edge` 维度；双包功能本身不要求立即增加该维度。

## 5. `package-extension.js` 修改步骤

### 5.1 解析并校验目标浏览器

增加一个只接受 `chrome`、`edge`、`all` 的解析函数。不要依赖模糊的字符串包含判断，
避免错误参数静默构建成 Chrome 包。

伪代码：

```js
function parseBrowserTarget(argv) {
  const argument = argv.find((value) => value.startsWith('--browser='));
  const target = argument ? argument.slice('--browser='.length) : 'chrome';
  if (!['chrome', 'edge', 'all'].includes(target)) {
    throw new Error(`Unsupported browser target: ${target}`);
  }
  return target;
}
```

### 5.2 每个浏览器独立复制发布文件

将现有依赖全局 `stageDir` 的函数改为显式接收 `stageDir`：

```text
copyPackageFiles(stageDir, browserTarget)
minifyJavaScriptFiles(stageDir)
createZip(stageDir, outputName)
```

这样 `all` 模式不会让第二个包覆盖第一个包的暂存内容。

### 5.3 转换暂存 Manifest

两个包都继续执行：

- 校验开发版名称以 `-dev` 结尾；
- 删除发布包名称末尾的 `-dev`；
- 保留 Manifest V3；
- 保留当前权限和站点 host permissions。

Edge 包额外执行：

```js
delete packagedManifest.minimum_chrome_version;
```

原因是 Edge 具有自己的产品版本号。该字段通常不会影响 Chromium 兼容性，但从 Edge
发布包移除可以避免用 Chrome 名称描述 Edge 的最低版本要求。

不要修改根目录的开发 Manifest。

### 5.4 转换暂存运行时配置

在现有发布转换之后继续处理：

1. `enableDebugLog: true` 改为 `false`；
2. 根据 `--skip-ga4` 决定是否关闭 GA4；
3. 必要时注入 GA4 Measurement ID 和 API Secret；
4. 根据浏览器目标替换暂存文件中的 `ratingPrompt.storeUrl`；
5. 校验 Edge 包不包含 `chromewebstore.google.com`。

商店链接替换应只在暂存目录进行。若预期的源码配置结构不存在，应立即失败，而不是
继续产生链接错误的发布包。

### 5.5 分别命名输出文件

```js
function outputName(browserTarget, version) {
  return `job-chat-recorder-${browserTarget}-v${version}.zip`;
}
```

最终输出：

```text
dist/job-chat-recorder-chrome-v6.2.1.zip
dist/job-chat-recorder-edge-v6.2.1.zip
```

不要继续覆盖旧的无浏览器名称 ZIP，否则很容易把错误的包上传到商店。

## 6. `package-with-ga4.js` 修改步骤

`package-with-ga4.js` 当前只识别 `--skip-ga4`。修改后应把 `--browser=...` 传递给
`package-extension.js`。

建议流程：

```text
读取 --browser
    |
    +-- --skip-ga4：直接调用 package-extension.js
    |
    +-- 启用 GA4：询问/读取一次 GA4 配置
                      |
                      +-- 调用 package-extension.js，并原样传递 --browser
```

不要把 GA4 Secret 拼进命令行参数；继续通过子进程环境变量传递。

## 7. `package.json` 命令

修改后建议提供：

```json
{
  "scripts": {
    "check": "node scripts/check-extension.js",
    "build": "node scripts/package-extension.js --browser=chrome --skip-ga4",
    "build:edge": "node scripts/package-extension.js --browser=edge --skip-ga4",
    "build:all": "node scripts/package-extension.js --browser=all --skip-ga4",
    "ci": "npm run check && npm run build:all",
    "package": "node scripts/package-with-ga4.js --browser=chrome",
    "package:chrome": "node scripts/package-with-ga4.js --browser=chrome",
    "package:edge": "node scripts/package-with-ga4.js --browser=edge",
    "package:all": "node scripts/package-with-ga4.js --browser=all",
    "package:skip-ga4": "node scripts/package-extension.js --browser=chrome --skip-ga4",
    "package:edge:skip-ga4": "node scripts/package-extension.js --browser=edge --skip-ga4",
    "package:all:skip-ga4": "node scripts/package-extension.js --browser=all --skip-ga4"
  }
}
```

`package` 和 `package:skip-ga4` 保留 Chrome 默认行为，避免已有本地或 CI 调用失效。

## 8. 发布包验证

`scripts/check-extension.js` 继续验证源码语法、扩展引用和打包文件清单。每次执行
`package-extension.js` 时，会在生成 ZIP 后运行 `unzip -t`，并读取包内 Manifest 验证
浏览器目标差异。`npm run ci` 通过 `npm run build:all` 覆盖两个发布包。

发布包验证至少包括：

### Chrome 包

- ZIP 存在且可解压；
- Manifest 名称不含 `-dev`；
- 保留 `minimum_chrome_version`；
- 评分链接不指向 Edge Add-ons；
- Debug 默认关闭；
- `--skip-ga4` 构建中 GA4 默认关闭。

### Edge 包

- ZIP 存在且可解压；
- Manifest 名称不含 `-dev`；
- 不包含 `minimum_chrome_version`；
- 不包含 Chrome Web Store 评分链接；
- Edge 商店链接为空时不会展示评分提示；
- Debug 默认关闭；
- `--skip-ga4` 构建中 GA4 默认关闭。

检查脚本不应依赖机器上已登录 Chrome、Edge、BOSS 或猎聘；浏览器行为继续由手工回归
测试覆盖。

## 9. 修改后的打包方式

### 9.1 安装锁定依赖

```bash
npm ci
```

### 9.2 生成不含 GA4 的本地验证包

只生成 Chrome：

```bash
npm run build
```

只生成 Edge：

```bash
npm run build:edge
```

同时生成两个：

```bash
npm run build:all
```

### 9.3 生成启用 GA4 的正式包

交互式打包：

```bash
npm run package:chrome
npm run package:edge
npm run package:all
```

`package:all` 只询问一次 Measurement ID 和 API Secret。

非交互环境：

```text
JOB_CHAT_GA4_MEASUREMENT_ID=G-XXXXXXXXXX
JOB_CHAT_GA4_API_SECRET=你的 Measurement Protocol API Secret
JOB_CHAT_EDGE_STORE_URL=https://microsoftedge.microsoft.com/addons/detail/<edge-addon-id>
```

然后运行：

```bash
npm run package:all
```

不要把真实 GA4 Secret 写进 `.env` 示例、源码、文档或 CI 日志。

### 9.4 检查 ZIP

```bash
unzip -t dist/job-chat-recorder-chrome-v6.2.1.zip
unzip -t dist/job-chat-recorder-edge-v6.2.1.zip
```

检查包内 Manifest：

```bash
unzip -p dist/job-chat-recorder-chrome-v6.2.1.zip manifest.json
unzip -p dist/job-chat-recorder-edge-v6.2.1.zip manifest.json
```

版本号应从根目录 `manifest.json` 自动读取，命令和文档不应把 `6.2.1` 写入脚本逻辑。

## 10. 浏览器旁加载验证

### Chrome

1. 打开 `chrome://extensions/`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择源码根目录，或把 Chrome ZIP 解压后选择解压目录。

### Edge

1. 打开 `edge://extensions/`。
2. 开启开发人员模式。
3. 点击“加载解压缩的扩展”。
4. 选择源码根目录，或把 Edge ZIP 解压后选择解压目录。

Edge 和 Chrome 使用不同的浏览器 Profile 与 Cookie。即使 Chrome 已登录 BOSS 或猎聘，
Edge 中仍需重新登录。

## 11. 双浏览器回归清单

每个发布包至少验证：

- [ ] Popup 能识别 BOSS 和猎聘页面；
- [ ] 同步准备、提取、暂停、恢复和保存正常；
- [ ] 总览搜索、筛选、备注、删除和导出正常；
- [ ] BOSS 联系人和岗位详情同步正常；
- [ ] BOSS WebSocket 文本发送收到有效 ACK；
- [ ] 猎聘联系人、岗位预览和详情同步正常；
- [ ] 猎聘文本发送正常；
- [ ] 两个平台自动招呼的筛选、暂停、恢复和取消正常；
- [ ] Side Panel 能打开、停靠和浮动；
- [ ] 浏览器重启后本地记录和配置仍存在；
- [ ] 评分按钮打开当前浏览器对应的商店；
- [ ] 正式包默认不显示 Debug 日志；
- [ ] ZIP 中不包含 `runtime-config.local.js`、README、脚本或历史产物；
- [ ] 日志不包含 Cookie、token、用户 ID 或安全标识。

Edge 还应重点验证睡眠标签页、效率模式以及切换标签页后的 Side Panel 恢复。长时间同步
或发送期间，应提示用户保持招聘页面处于活动状态。

## 12. Edge Add-ons 提交材料

通过 Partner Center 提交 Edge 包时，需要准备：

- 扩展名称、简短说明和完整说明；
- 图标和商店截图；
- 隐私政策 URL；
- `tabs`、`scripting`、`storage`、`unlimitedStorage`、`sidePanel` 等权限说明；
- `zhipin.com`、`liepin.com`、猎聘 API 域名的 host permission 说明；
- 是否收集、存储或传输聊天和岗位数据；
- GA4 匿名统计字段和关闭方法；
- 声明不下载或执行远程代码；
- BOSS、猎聘完整测试步骤；
- 无法提供招聘平台测试账号时的明确原因和替代演示方法。

Edge Add-ons 支持 `Public` 和 `Hidden` 可见性。首次验证可以先使用 Hidden，但 Hidden
仍需要通过商店认证，不能绕过权限、隐私和内容政策审核。

## 13. 验收标准

双包改造只有同时满足以下条件才算完成：

1. `npm run check` 成功；
2. `npm run build:all` 成功；
3. 两个 ZIP 都通过 `unzip -t`；
4. 两个 ZIP 的文件清单除允许的构建差异外完全一致；
5. Edge 包不包含 Chrome Web Store 链接；
6. Chrome 包不包含 Edge Add-ons 链接；
7. 源码文件在打包前后没有发生变化；
8. Chrome 和 Edge 旁加载核心回归均通过；
9. 未在源码、ZIP 文件名、构建输出或日志中泄露 GA4 API Secret。
