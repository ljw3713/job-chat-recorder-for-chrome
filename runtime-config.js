(function () {
  globalThis.JobChatRuntimeConfig = {
    // 工作区默认开启；打包脚本会将发布包改为 false。
    enableDebugLog: true,
    // 正式打包时由环境变量注入；源码保持为空，避免把 GA4 配置提交到仓库。
    // 直连模式的 API Secret 最终仍存在于扩展包内，只能通过独立数据流和定期轮换降低风险。
    analyticsEnabled: true,
    ga4MeasurementId: '',
    ga4ApiSecret: '',
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
