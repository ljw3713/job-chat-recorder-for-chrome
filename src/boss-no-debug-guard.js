(() => {
  'use strict';

  if (window.__JOB_CHAT_BOSS_NO_DEBUG_GUARD__) return;
  window.__JOB_CHAT_BOSS_NO_DEBUG_GUARD__ = true;

  const NO_DEBUG_EXPORT_PATTERN = /noDebug\s*:\s*\(\)\s*=>/;

  function noDebugDisabled(_options, onReady) {
    // The caller uses this callback to mark its noDebug initialization as
    // complete. Calling it prevents the caller's fallback memory-exhaustion
    // branch while leaving the rest of the application running.
    try {
      if (typeof onReady === 'function') onReady();
    } catch (_) {}
    return { success: true, disabled: true };
  }

  function replaceNoDebugModule(modules) {
    if (!modules || typeof modules !== 'object') return;

    for (const moduleId of Object.keys(modules)) {
      const factory = modules[moduleId];
      if (typeof factory !== 'function') continue;

      let source = '';
      try {
        source = Function.prototype.toString.call(factory);
      } catch (_) {
        continue;
      }

      if (!NO_DEBUG_EXPORT_PATTERN.test(source)) continue;

      modules[moduleId] = function safeNoDebugModule(module, exports, webpackRequire) {
        webpackRequire.d(exports, { noDebug: () => noDebugDisabled });
      };
    }
  }

  function protectChunk(chunk) {
    if (Array.isArray(chunk)) replaceNoDebugModule(chunk[1]);
  }

  // BOSS bundles register modules through this queue. Creating it here lets us
  // wrap every later chunk before its runtime can require the noDebug module.
  const queue = window.webpackChunkgeek = window.webpackChunkgeek || [];
  for (const chunk of queue) protectChunk(chunk);

  // The webpack runtime replaces queue.push while it starts. Keep a property
  // setter here, otherwise that replacement would silently remove our guard.
  let currentPush = queue.push;
  let forwardingToWebpackParent = false;
  const guardedPush = function guardedChunkPush(...chunks) {
    for (const chunk of chunks) protectChunk(chunk);

    // Webpack saves the current push as its parent callback. Once its runtime
    // callback is installed, that parent is this guard itself. Delegate the
    // nested call to the native Array implementation to avoid recursion.
    if (forwardingToWebpackParent) {
      return Array.prototype.push.apply(this, chunks);
    }

    forwardingToWebpackParent = true;
    try {
      return currentPush.apply(this, chunks);
    } finally {
      forwardingToWebpackParent = false;
    }
  };

  Object.defineProperty(queue, 'push', {
    configurable: true,
    enumerable: false,
    get() {
      return guardedPush;
    },
    set(nextPush) {
      if (typeof nextPush === 'function' && nextPush !== guardedPush) {
        currentPush = nextPush;
      }
    }
  });
})();
