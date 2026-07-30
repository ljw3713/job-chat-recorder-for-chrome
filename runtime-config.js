(function () {
  globalThis.JobChatRuntimeConfig = {
    // 工作区默认开启；打包脚本会将发布包改为 false。
    enableDebugLog: true,
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
