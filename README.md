# 直聘|猎聘 沟通助手

一个用于同步、整理招聘平台沟通记录，并向已有 BOSS 联系人批量发送文本消息的 Chrome 扩展。当前支持 BOSS 直聘 `zhipin.com` 和猎聘 `liepin.com`。

## 功能

- 根据当前标签页网址自动选择提取规则
- 当前支持：BOSS 直聘 `zhipin.com`、猎聘 `liepin.com`
- 暂不支持的网站会提示“暂不支持当前网站”
- 提取字段：公司、岗位、沟通日期、备注、招聘者信息、原消息
- 岗位和备注支持双击编辑
- 支持按来源、公司、消息状态和日期筛选，并按公司、岗位、招聘者和原消息进行多关键词搜索
- 支持“只显示今天沟通”、排序、忽略记录及批量删除
- 支持复制表格、下载 CSV、复制 JSON、下载 JSON
- 支持向当前登录账号下已有的 BOSS 联系人批量发送纯文本消息
- 支持发送速率设置、停止发送、逐条状态和失败备注；调试参数可开启完整流程日志，认证及联系人凭据自动脱敏

## BOSS 批量发送

在总览页选中 BOSS 记录后，点击“发送信息”即可创建发送批次：

1. 输入不超过 1000 字的纯文本消息。
2. 设置每分钟发送数量；默认 10，只限制最小值为 1。
3. 点击“发送”。发送期间按钮变为“停止”，可终止尚未发送的记录。
4. 每条记录只显示“等待”“成功”或“失败”；失败原因显示在最右侧“备注”栏。

扩展会优先复用同步时保存的 `friendId` 和 `peerKey`。旧记录信息不全时，会从当前登录账号的联系人接口自动补齐并回写本地记录；单条记录补全或发送失败不会阻断后续记录。确实无法补齐的记录会提示“标识不全，需要重新同步记录再发送”。

发送不要求打开 BOSS 聊天页。扩展会选择最近访问的 `*.zhipin.com` 标签页并使用该页面的当前登录态；本版本不处理同一浏览器同时登录多个 BOSS 账号的场景。成功收到发送 ACK 后，会更新该记录的原消息和更新时间，并将消息状态设为未读。

发送日志默认隐藏。排查问题时可在总览页地址后添加 `log=enable`，例如 `results.html?mode=overview&log=enable`；移除该参数后恢复隐藏。隐藏日志栏不影响后台继续记录发送日志。

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

## 安装开发版

1. 克隆或下载本项目
2. 打开 Chrome：`chrome://extensions/`
3. 开启右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择本项目根目录

## Chrome 商店打包

运行以下命令生成可上传到 Chrome Web Store 的 zip 包：

```bash
npm run package
```

打包产物会输出到 `dist/job-chat-recorder-v{manifest版本号}.zip`。脚本只会打包扩展运行和商店上传必需的文件，包括 `manifest.json`、页面文件、脚本文件和 manifest 引用的图标，不会包含源码管理文件、README、CHANGELOG、打包脚本或历史产物。

## 使用方式

1. 打开 BOSS 直聘或猎聘页面，并确认已登录
2. 点击 Chrome 工具栏中的扩展图标
3. 点击“同步当前聊天记录”
4. 在同步结果页确认并保存记录
5. 在总览页筛选、搜索、编辑、导出记录；选中 BOSS 记录后可批量发送文本消息

## 项目结构

```text
.
├── package.json
├── manifest.json
├── shared-utils.js
├── shared-records.js
├── content-common.js
├── boss-message-protocol.js
├── boss-hook.js
├── boss-extractor.js
├── liepin-extractor.js
├── popup.html
├── popup.js
├── content.js
├── background-database.js
├── results-database.js
├── results.html
├── results.js
├── scripts/
│   └── package-extension.js
├── docs/
│   ├── zhipin.md
│   └── zhipin_send_msg.md
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

本扩展只读取当前登录态可访问的招聘沟通数据。同步结果、联系人发送标识、发送进度和脱敏日志保存在本地浏览器扩展存储中，不会上传到扩展作者或其他第三方服务器。只有用户主动点击“发送”时，扩展才会通过 BOSS 直聘页面当前登录态向所选已有联系人发送消息；Cookie、HTTP token 和 `wt2` 不写入扩展存储。
