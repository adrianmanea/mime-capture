/**
 * Content Script Loader
 *
 * Injected into every page. Dynamically imports the main content script
 * so it runs as an ES module with access to chrome.runtime.getURL().
 * Also tracks injection performance timing.
 */
(function () {
  'use strict';

  const injectTime = performance.now();

  (async () => {
    const { onExecute } = await import(
      /* webpackIgnore: true */
      chrome.runtime.getURL('src/content/main.js')
    );
    onExecute?.({
      perf: { injectTime, loadTime: performance.now() - injectTime },
    });
  })().catch(console.error);
})();
