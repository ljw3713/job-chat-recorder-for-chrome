# 招聘沟通记录统计器

一个用于统计招聘平台沟通记录的 Chrome 扩展。当前支持 BOSS 直聘 `zhipin.com` 和猎聘 `liepin.com`，可将沟通列表提取为表格、CSV 和 JSON，方便维护求职 / 招聘沟通记录。

## 功能

- 根据当前标签页网址自动选择提取规则
- 当前支持：BOSS 直聘 `zhipin.com`、猎聘 `liepin.com`
- 暂不支持的网站会提示“暂不支持当前网站”
- 提取字段：公司、岗位、沟通日期、备注、招聘者信息、原消息
- 岗位和备注支持双击编辑
- 支持“只显示今天沟通”
- 支持复制表格、下载 CSV、复制 JSON、下载 JSON

## 猎聘支持说明

猎聘数据来自当前登录页面可访问的接口：

- `com.liepin.im.c.contact.get-contact-list` 获取最近沟通列表
- `com.liepin.im.c.chat.job-preview` 获取岗位概览

扩展会从当前页面 Cookie / 缓存读取 `imId_0`，仅拉取当天 `latestMsgTime` 的记录，并将 `jobTitle` 与 `jobSalary` 合并显示在“岗位”列中。岗位详情请求按约每秒 3 次以内执行，避免过于频繁。

## 导出字段

| 字段 | 说明 |
|---|---|
| 公司 | 招聘者所属公司 |
| 岗位 | 岗位名；猎聘会附带薪资，例如 `后端开发工程师（30-50k）` |
| 沟通日期 | 统一输出为 `YYYY-MM-DD` |
| 备注 | 可手动编辑 |
| 招聘者信息 | 名字 / title |
| 原消息 | 沟通列表中的原始消息 |

## 安装开发版

1. 克隆或下载本项目
2. 打开 Chrome：`chrome://extensions/`
3. 开启右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择本项目根目录

## 使用方式

1. 打开 BOSS 直聘或猎聘页面，并确认已登录
2. 点击 Chrome 工具栏中的扩展图标
3. 点击“提取当前页面记录”
4. 在结果页中筛选、编辑岗位 / 备注
5. 复制表格或下载 CSV

## 项目结构

```text
.
├── manifest.json
├── popup.html
├── popup.js
├── content.js
├── results.html
├── results.js
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

本扩展只在用户点击提取时读取当前网页中已展示或当前登录态可访问的沟通记录数据。数据保存在本地浏览器扩展存储中，不会上传到第三方服务器。


## v11 本地记录模式

- 提取结果会自动保存到 Chrome 本地存储。
- 同公司、同岗位、同招聘者视为同一条记录，不重复插入，只更新最新消息和更新时间。
- 每条记录包含申请时间（首次沟通日期）和更新时间（最新消息日期）。
- 支持按申请时间/更新时间排序、按日期区间筛选、按公司下拉筛选。
- CSV / JSON 导出基于当前页面筛选结果。


## v12

- 修复 popup 中 BOSS 消息页跳转按钮缺失导致卡在“正在检查当前网站”的问题。
- 在 BOSS 非消息页时显示“打开 BOSS直聘消息页面”按钮。
