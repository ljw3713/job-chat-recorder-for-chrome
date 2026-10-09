(function () {
  globalThis.JobChatLocales = globalThis.JobChatLocales || {};

  globalThis.JobChatLocales.cn = {
    messages: {
      popup: {
        syncing: '正在同步，请稍候...',
        syncCurrent: '同步当前聊天记录',
        currentSite: '当前网站：{site}，可以提取。',
        unsupportedSite: '当前网站：暂不支持。目前支持 {sites}。',
        openSupportedSite: '请先打开 BOSS直聘或猎聘页面。',
        saveOnlineOnlyFailed: '无法保存仅在线设置。',
        saveNonHunterFailed: '无法保存非猎头筛选设置。',
        saveCompanyFilterFailed: '无法保存关键字过滤设置。',
        saveKeywordsFailed: '无法保存关键字。'
      },
      autoMessage: {
        target: '目标 {count} 条',
        preparing: '准备中',
        running: '正在运行',
        paused: '已暂停',
        refreshing: '正在刷新重试',
        cancelling: '正在取消',
        cancelled: '已取消',
        completed: '已完成',
        failed: '运行失败',
        recommendedJobsFinished: '当前推荐岗位已处理完毕',
        resume: '继续',
        pause: '暂停',
        noLimit: '不限',
        searchFilter: '搜索{filter}',
        filters: {
          city: '城市',
          jobType: '求职类型',
          salary: '推荐薪资',
          experience: '推荐经验',
          degree: '学历要求',
          industry: '公司行业',
          scale: '公司规模',
          stage: '融资阶段',
          position: '职位类型',
          district: '区域',
          subway: '地铁'
        }
      },
      results: {
        overviewTitle: '招聘沟通记录总览',
        syncTitle: '同步结果',
        source: '来源',
        company: '公司',
        job: '岗位',
        applicationDate: '申请时间',
        updatedDate: '更新时间',
        note: '备注',
        recruiter: '招聘者',
        status: '状态',
        originalMessage: '原消息',
        messageRead: '已读',
        messageUnread: '未读',
        selectAllCurrentPage: '全选当前页面',
        jobNotSynced: '未同步',
        overviewMeta: '总记录共 {total} 条 · 筛选结果：{visible} 条 · 本页：{page} 条 · 今日同步 {today} 条 · 最近同步时间：{time}',
        syncMeta: '本次同步共 {total} 条 · 当前显示：{visible} 条 · 最近同步时间：{time} · 来源：{source}',
        viewAllRecords: '查看总记录',
        refreshOverview: '刷新总览',
        syncPageHint: '同步结果页：可先删除不需要的记录，再保存到总记录。备注列可双击编辑，岗位列可悬浮查看详情。',
        debugDataHint: '调试数据模式：JSON 和 CSV 会包含完整内部数据；CSV 导入会按唯一索引新增记录或覆盖已有记录的内部数据。',
        overviewHint: '记录会自动保存在浏览器本地；同公司、同岗位、同招聘者会合并。备注列可双击编辑，公司、岗位和原消息列可悬浮查看详情。',
        analyticsConsent: '允许匿名使用统计。仅统计功能使用数量、版本、地区和设备类型，不上传聊天或账号信息。',
        analyticsConfiguredHint: '仅统计功能使用数量、版本、地区和设备类型，不上传聊天或账号信息。',
        analyticsUnavailableHint: '当前构建尚未配置 GA4，不会发送统计数据。'
      }
    },
    sourceText: {}
  };
})();
