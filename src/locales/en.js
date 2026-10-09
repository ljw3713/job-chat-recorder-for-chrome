(function () {
  globalThis.JobChatLocales = globalThis.JobChatLocales || {};

  globalThis.JobChatLocales.en = {
    messages: {
      popup: {
        syncing: 'Syncing, please wait...',
        syncCurrent: 'Sync current chat records',
        currentSite: 'Current site: {site}. Ready to extract.',
        unsupportedSite: 'This site is not supported. Supported sites: {sites}.',
        openSupportedSite: 'Please open a BOSS Zhipin or Liepin page first.',
        saveOnlineOnlyFailed: 'Unable to save the online-only setting.',
        saveNonHunterFailed: 'Unable to save the non-hunter setting.',
        saveCompanyFilterFailed: 'Unable to save the keyword filter setting.',
        saveKeywordsFailed: 'Unable to save keywords.'
      },
      autoMessage: {
        target: 'Target: {count}',
        preparing: 'Preparing',
        running: 'Running',
        paused: 'Paused',
        refreshing: 'Refreshing for retry',
        cancelling: 'Cancelling',
        cancelled: 'Cancelled',
        completed: 'Completed',
        failed: 'Run failed',
        recommendedJobsFinished: 'All recommended jobs have been processed',
        resume: 'Resume',
        pause: 'Pause',
        noLimit: 'No limit',
        searchFilter: 'Search {filter}',
        filters: {
          city: 'City',
          jobType: 'Employment type',
          salary: 'Salary range',
          experience: 'Experience',
          degree: 'Education',
          industry: 'Industry',
          scale: 'Company size',
          stage: 'Funding stage',
          position: 'Job category',
          district: 'District',
          subway: 'Metro'
        }
      },
      results: {
        overviewTitle: 'Job Chat Records Overview',
        syncTitle: 'Sync results',
        source: 'Source',
        company: 'Company',
        job: 'Job',
        applicationDate: 'Application date',
        updatedDate: 'Updated date',
        note: 'Note',
        recruiter: 'Recruiter',
        status: 'Status',
        originalMessage: 'Original message',
        messageRead: 'Read',
        messageUnread: 'Unread',
        selectAllCurrentPage: 'Select all on this page',
        jobNotSynced: 'Not synced',
        overviewMeta: '{total} total records · {visible} filtered · {page} on this page · {today} synced today · Last synced: {time}',
        syncMeta: '{total} records synced · {visible} currently shown · Last synced: {time} · Source: {source}',
        viewAllRecords: 'View all records',
        refreshOverview: 'Refresh overview',
        syncPageHint: 'On the sync-results page, remove unneeded records before saving them. Double-click notes to edit; hover over companies, jobs, and original messages for details.',
        debugDataHint: 'Debug-data mode: JSON and CSV include complete internal data. CSV import adds records by unique key or replaces existing internal data.',
        overviewHint: 'Records are saved locally in your browser. Records with the same company, job, and recruiter are merged. Double-click notes to edit; hover over companies, jobs, and original messages for details.',
        analyticsConsent: 'Allow anonymous usage analytics. Only feature usage volume, version, region, and device type are collected; chats and account information are never uploaded.',
        analyticsConfiguredHint: 'Only feature usage volume, version, region, and device type are collected; chats and account information are never uploaded.',
        analyticsUnavailableHint: 'GA4 is not configured for this build, so no analytics data will be sent.'
      }
    },
    sourceText: {
      '招聘沟通统计': 'Job Chat Statistics',
      '直聘 | 猎聘 沟通助手': 'BOSS | Liepin Assistant',
      '正在检查当前网站...': 'Checking the current site...',
      '同步记录': 'Sync records',
      '查看总览': 'View overview',
      '自动消息': 'Auto messages',
      '仅在线': 'Online only',
      '非猎头': 'Non-hunter',
      '不显示': 'Hide',
      '修改后需要刷新当前招聘页面才能生效': 'Refresh the current recruiting page for this change to take effect.',
      '输入不想看到的关键字，用|分割': 'Enter keywords to hide, separated by |',
      '招聘沟通记录': 'Job Chat Records',
      '正在提取沟通记录...': 'Extracting chat records...',
      '沟通记录': 'Chat records',
      '岗位信息': 'Job information',
      '保存到总记录': 'Save to all records',
      '查看总记录': 'View all records',
      '复制表格': 'Copy table',
      '下载 CSV': 'Download CSV',
      '导入 CSV': 'Import CSV',
      '更新选中': 'Update selected',
      '删除选中': 'Delete selected',
      '忽略选中': 'Ignore selected',
      '合并重复': 'Merge duplicates',
      '忽略记录': 'Ignored records',
      '今日沟通': 'Today\'s chats',
      '发送信息': 'Send message',
      '复制 JSON': 'Copy JSON',
      '每': 'Every',
      '秒': 'second',
      '分': 'minute',
      '时': 'hour',
      '同步': 'Sync',
      '中断': 'Stop',
      '继续': 'Resume',
      '新增': 'New',
      '更新': 'Update',
      '查询公司、岗位、招聘者、聊天记录': 'Search companies, jobs, recruiters, or chats',
      '来源': 'Source',
      '全部来源': 'All sources',
      '公司': 'Company',
      '全部公司': 'All companies',
      '消息状态': 'Message status',
      '全部': 'All',
      '未读': 'Unread',
      '已读': 'Read',
      '时间': 'Time',
      '更新时间': 'Updated time',
      '申请时间': 'Application time',
      '开始': 'Start',
      '结束': 'End',
      '排序': 'Sort',
      '更新时间 ↓': 'Updated time ↓',
      '更新时间 ↑': 'Updated time ↑',
      '申请时间 ↓': 'Application time ↓',
      '申请时间 ↑': 'Application time ↑',
      'JSON 数据预览': 'JSON data preview',
      '公司信息': 'Company information',
      '个人信息': 'Personal information',
      '请求日志': 'Request log',
      '支持一下沟通助手': 'Support the assistant',
      '关闭': 'Close',
      '如果觉得这个插件不错，请为插件打个分。': 'If you like this extension, please leave a rating.',
      '好的': 'OK',
      '暂无请求日志。': 'No request logs.',
      '请输入要发送的消息（1–1000 个字符）': 'Enter a message to send (1–1000 characters)',
      '发送': 'Send',
      '每分钟发送数': 'Messages per minute',
      '尚未开始发送。': 'Sending has not started.',
      '更新岗位与消息': 'Update jobs and messages',
      '每分钟并发数': 'Concurrent requests per minute',
      '重试延时（秒）': 'Retry delay (seconds)',
      '重试次数': 'Retry attempts',
      '自动消息配置': 'Auto Message Settings',
      '浮动': 'Float',
      '岗位来源': 'Job source',
      '推荐模式': 'Recommended',
      '检索模式': 'Search',
      '正在读取…': 'Loading…',
      '输入职位关键词，例如：工程师': 'Enter job keywords, e.g. engineer',
      '类型': 'Type',
      '最新': 'Latest',
      '综合': 'Relevance',
      '推荐岗位筛选条件': 'Recommended job filters',
      '工资范围': 'Salary range',
      '未设置': 'Not set',
      '年限范围': 'Experience range',
      'AI匹配': 'AI matching',
      '我的简历': 'My resume',
      '简历匹配提示词': 'Resume matching prompt',
      '期待岗位': 'Desired job',
      '期待岗位提示词': 'Desired job prompt',
      '其他': 'Other',
      '预览': 'Preview',
      '技术关键字': 'Technical keywords',
      '匹配度': 'Match rate',
      '职位关键字': 'Job keywords',
      '岗位关键字过滤器': 'Job keyword filter',
      '公司关键字过滤器': 'Company keyword filter',
      '打招呼数量': 'Greeting count',
      '请求速率': 'Request rate',
      '一键打招呼': 'Send greetings',
      '正在运行': 'Running',
      '成功：': 'Succeeded:',
      '已处理：': 'Processed:',
      '跳过：': 'Skipped:',
      '失败：': 'Failed:',
      '已发送信息': 'Sent messages',
      '取消任务': 'Cancel task',
      '暂停': 'Pause',
      '关闭状态面板': 'Close status panel',
      '自动消息日志': 'Auto message log',
      '清空': 'Clear',
      '暂无日志': 'No logs',
      '任务执行中无法编辑': 'Editing is disabled while the task is running',
      '双击快速编辑': 'Double-click to edit',
      '多个关键字使用 | 分割': 'Separate multiple keywords with |',
      '暂无可用目标职位': 'No target jobs are available',
      '公司详情': 'Company details',
      'AI匹配结果': 'AI match result',
      '岗位详情': 'Job details',
      '暂无已发送信息': 'No messages have been sent',
      '未知公司': 'Unknown company',
      '未知岗位': 'Unknown job',
      '薪资未提供': 'Salary not provided',
      '匹配通过': 'Match passed',
      '准备中': 'Preparing',
      '同步中': 'Syncing',
      '重试中': 'Retrying',
      '成功': 'Succeeded',
      '失败': 'Failed',
      '已停止': 'Stopped',
      '等待同步': 'Waiting to sync',
      '跳过': 'Skipped',
      '已发送': 'Sent',
      '结果未知': 'Result unknown',
      '等待': 'Waiting',
      '无需同步': 'No sync needed',
      '提取失败。': 'Extraction failed.',
      '已获取待同步列表。': 'The records awaiting sync are ready.',
      '已获取待同步列表，请点击“同步”。': 'The records awaiting sync are ready. Click “Sync”.',
      '暂无同步日志。': 'No sync logs.',
      '查看同步进度': 'View sync progress',
      '刷新总览': 'Refresh overview',
      '没有符合条件的记录。': 'No records match the current filters.',
      '正在加载数据，请稍候...': 'Loading data, please wait...',
      '暂无公司介绍。': 'No company description is available.',
      '暂无岗位详情。': 'No job details are available.',
      '暂无公司详情，请先同步岗位信息。': 'No company details are available. Sync job information first.',
      '暂无岗位详情，可勾选后点击“更新详情”。': 'No job details are available. Select it and click “Update details”.',
      '请稍后重试。': 'Please try again later.',
      '无法启动自动打招呼。': 'Unable to start auto greetings.',
      '无法控制任务。': 'Unable to control the task.',
      '无法取消任务。': 'Unable to cancel the task.',
      '无法读取目标职位。': 'Unable to read target jobs.',
      '无法读取仅在线设置。': 'Unable to read the online-only setting.',
      '无法保存仅在线设置。': 'Unable to save the online-only setting.',
      '正在启动…': 'Starting…',
      '正在编辑。': 'Editing…',
      '停靠': 'Dock',
      '收起 AI匹配配置': 'Collapse AI matching settings',
      '展开 AI匹配配置': 'Expand AI matching settings',
      '已暂停': 'Paused',
      '正在刷新重试': 'Refreshing for retry',
      '正在取消': 'Cancelling',
      '已取消': 'Cancelled',
      '已完成': 'Completed',
      '运行失败': 'Run failed',
      '目标 0 条': 'Target: 0',
      '备注：同步过程中会自动刷新最近使用的 zhipin.com\n              标签页，用于获取必要的数据。': 'Note: During sync, the most recently used zhipin.com tab is refreshed to retrieve the required data.',
      '备注：同步过程中会自动刷新最近使用的招聘网站标签页，用于获取必要的数据。如果重试失败，刷新网站后再同步。': 'Note: During sync, the most recently used recruiting-site tab is refreshed to retrieve required data. Refresh the site and retry if a retry fails.',
      '自动消息日志，按 Ctrl+A 或 Command+A 全选': 'Auto message log. Press Ctrl+A or Command+A to select all.',
      '点击聚焦，按 Ctrl+A 或 Command+A 全选日志': 'Click to focus, then press Ctrl+A or Command+A to select all logs.'
    },
    filterOptionNames: {
      '不限': 'No limit',
      '全职': 'Full-time',
      '兼职': 'Part-time',
      '实习': 'Internship',
      '校招': 'Campus recruitment',
      '社招': 'Experienced hire',
      '经验不限': 'No experience requirement',
      '应届生': 'Fresh graduate',
      '1年以内': 'Less than 1 year',
      '1-3年': '1–3 years',
      '3-5年': '3–5 years',
      '5-10年': '5–10 years',
      '10年以上': '10+ years',
      '学历不限': 'Any education level',
      '初中及以下': 'Middle school or below',
      '高中': 'High school',
      '中专/中技': 'Technical secondary school',
      '大专': 'Associate degree',
      '本科': 'Bachelor’s degree',
      '硕士': 'Master’s degree',
      '博士': 'Doctorate',
      '未融资': 'Pre-funding',
      '天使轮': 'Angel round',
      'A轮': 'Series A',
      'B轮': 'Series B',
      'C轮': 'Series C',
      'D轮及以上': 'Series D or later',
      '已上市': 'Publicly listed',
      '不需要融资': 'Not seeking funding',
      '互联网': 'Internet',
      '计算机软件': 'Computer software',
      '电子商务': 'E-commerce',
      '人工智能': 'Artificial intelligence',
      '企业服务': 'Enterprise services',
      '信息安全': 'Information security',
      '通信/网络设备': 'Telecom / network equipment',
      '游戏': 'Games',
      '金融': 'Financial services',
      '教育培训': 'Education and training',
      '医疗健康': 'Healthcare',
      '广告/公关/会展': 'Advertising / PR / events',
      '文化/体育/娱乐': 'Culture / sports / entertainment',
      '零售/批发': 'Retail / wholesale',
      '物流/仓储': 'Logistics / warehousing',
      '汽车': 'Automotive',
      '制造业': 'Manufacturing',
      '房地产/建筑': 'Real estate / construction',
      '能源/矿产/环保': 'Energy / mining / environmental protection',
      '政府/公共事业': 'Government / public services',
      '北京': 'Beijing',
      '上海': 'Shanghai',
      '广州': 'Guangzhou',
      '深圳': 'Shenzhen',
      '杭州': 'Hangzhou',
      '成都': 'Chengdu',
      '武汉': 'Wuhan',
      '南京': 'Nanjing',
      '西安': 'Xi’an',
      '重庆': 'Chongqing',
      '苏州': 'Suzhou',
      '天津': 'Tianjin',
      '郑州': 'Zhengzhou',
      '长沙': 'Changsha',
      '厦门': 'Xiamen',
      '青岛': 'Qingdao',
      '合肥': 'Hefei',
      '福州': 'Fuzhou',
      '济南': 'Jinan',
      '大连': 'Dalian',
      '产品': 'Product',
      '技术': 'Technology',
      '开发': 'Development',
      '设计': 'Design',
      '运营': 'Operations',
      '市场': 'Marketing',
      '销售': 'Sales',
      '人力资源': 'Human resources',
      '行政': 'Administration',
      '财务': 'Finance',
      '法务': 'Legal',
      '客服': 'Customer service'
    },
    translateFilterOption(source) {
      const name = String(source || '').trim();
      if (!name) return '';
      if (this.filterOptionNames[name]) return this.filterOptionNames[name];
      let match = name.match(/^(\d+)K以下$/i);
      if (match) return `Below ¥${match[1]}K/month`;
      match = name.match(/^(\d+)K-(\d+)K$/i);
      if (match) return `¥${match[1]}K–¥${match[2]}K/month`;
      match = name.match(/^(\d+)K以上$/i);
      if (match) return `¥${match[1]}K+/month`;
      match = name.match(/^(\d+)-(\d+)人$/);
      if (match) return `${match[1]}–${match[2]} employees`;
      match = name.match(/^(\d+)人以下$/);
      if (match) return `Fewer than ${match[1]} employees`;
      match = name.match(/^(\d+)人以上$/);
      if (match) return `${match[1]}+ employees`;
      return name;
    },
    translateDynamic(source) {
      let match = source.match(/^目标 (\d+) 条$/);
      if (match) return `Target: ${match[1]}`;
      match = source.match(/^(\d+) 人$/);
      if (match) return `${match[1]} recipients`;
      match = source.match(/^(\d+) 次\/分钟$/);
      if (match) return `${match[1]} requests/min`;
      match = source.match(/^下载 CSV（(\d+)）$/);
      if (match) return `Download CSV (${match[1]})`;
      match = source.match(/^删除选中（(\d+)）$/);
      if (match) return `Delete selected (${match[1]})`;
      match = source.match(/^更新选中（(\d+)）$/);
      if (match) return `Update selected (${match[1]})`;
      match = source.match(/^忽略选中（(\d+)）$/);
      if (match) return `Ignore selected (${match[1]})`;
      match = source.match(/^忽略记录（(\d+)）$/);
      if (match) return `Ignored records (${match[1]})`;
      match = source.match(/^发送信息（(\d+)）$/);
      if (match) return `Send message (${match[1]})`;
      match = source.match(/^确认忽略选中的 (\d+) 条记录？$/);
      if (match) return `Ignore the ${match[1]} selected record(s)?`;
      match = source.match(/^剩余 (\d+) 秒$/);
      if (match) return `${match[1]} seconds remaining`;
      return source;
    },
    sourceForDynamic(translated) {
      let match = translated.match(/^Target: (\d+)$/);
      if (match) return `目标 ${match[1]} 条`;
      match = translated.match(/^(\d+) recipients$/);
      if (match) return `${match[1]} 人`;
      match = translated.match(/^(\d+) requests\/min$/);
      if (match) return `${match[1]} 次/分钟`;
      match = translated.match(/^Download CSV \((\d+)\)$/);
      if (match) return `下载 CSV（${match[1]}）`;
      match = translated.match(/^Delete selected \((\d+)\)$/);
      if (match) return `删除选中（${match[1]}）`;
      match = translated.match(/^Update selected \((\d+)\)$/);
      if (match) return `更新选中（${match[1]}）`;
      match = translated.match(/^Ignore selected \((\d+)\)$/);
      if (match) return `忽略选中（${match[1]}）`;
      match = translated.match(/^Ignored records \((\d+)\)$/);
      if (match) return `忽略记录（${match[1]}）`;
      match = translated.match(/^Send message \((\d+)\)$/);
      if (match) return `发送信息（${match[1]}）`;
      match = translated.match(/^Ignore the (\d+) selected record\(s\)\?$/);
      if (match) return `确认忽略选中的 ${match[1]} 条记录？`;
      match = translated.match(/^(\d+) seconds remaining$/);
      if (match) return `剩余 ${match[1]} 秒`;
      return translated;
    }
  };
})();
