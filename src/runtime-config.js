(function () {
  globalThis.JobChatRuntimeConfig = {
    // 工作区默认开启；打包脚本会将发布包改为 false。
    enableDebugLog: true,
    // 正式打包时由环境变量注入；源码保持为空，避免把 GA4 配置提交到仓库。
    // 直连模式的 API Secret 最终仍存在于扩展包内，只能通过独立数据流和定期轮换降低风险。
    analyticsEnabled: true,
    analyticsUserEnabledByDefault: true,
    ga4MeasurementId: '',
    ga4ApiSecret: '',
    ratingPrompt: {
      storageKey: 'jobChatRatingPromptState',
      clickThreshold: 0,
      storeUrl: 'https://chromewebstore.google.com/detail/%E7%9B%B4%E8%81%98%E7%8C%8E%E8%81%98-%E6%B2%9F%E9%80%9A%E5%8A%A9%E6%89%8B/phnaloiemmlklelkahjmpmhemmdidkmj'
    },
    resultsPagePath(mode) {
      const params = new URLSearchParams({ mode: mode === 'sync' ? 'sync' : 'overview' });
      if (this.enableDebugLog) {
        params.set('log', 'true');
        params.set('debug', 'true');
      }
      return `results.html?${params.toString()}`;
    }
  };
})();
