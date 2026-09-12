// bridge.js — Shared state bridge between controller, ui.js, and sync.js
// Replaces the bare globals that the old monolithic index.html relied on.
// Loaded BEFORE ui.js and sync.js as a regular <script> tag.

window._wl = {
  // State (set by controller)
  running: false,
  currentWallet: null,
  currentSel: null,
  rangeStart: 0n,
  rangeEnd: 0n,
  startPct: 0,
  searchMode: 'random',
  multiGpuCount: 1,
  _sharedWasmModule: null,

  // DOM references (set by controller on connect)
  consoleEl: null,
  consoleEmptyEl: null,

  // Logging (set by controller)
  _logFn: null,
  _logOkFn: null,
  _logErrFn: null,
  _logWarnFn: null,

  // Worker helpers (set by controller)
  getWorkerUrl: null,
  stopAll: null,
  start: null,
  handleFound: null,
  repositionSearch: null,
};

// Safe logging fallbacks — overridden by controller when it connects
function log(msg) {
  if (window._wl._logFn) return window._wl._logFn(msg);
  console.log('[wl]', msg);
}
function logOk(msg) {
  if (window._wl._logOkFn) return window._wl._logOkFn(msg);
  console.log('[wl:ok]', msg);
}
function logErr(msg) {
  if (window._wl._logErrFn) return window._wl._logErrFn(msg);
  console.error('[wl:err]', msg);
}
function logWarn(msg) {
  if (window._wl._logWarnFn) return window._wl._logWarnFn(msg);
  console.warn('[wl:warn]', msg);
}

// Expose as bare globals for legacy code in ui.js / sync.js
window.log = log;
window.logOk = logOk;
window.logErr = logErr;
window.logWarn = logWarn;
window.stopAll = function() { if (window._wl.stopAll) window._wl.stopAll(); };
window.start = function() { if (window._wl.start) window._wl.start(); };
window.handleFound = function(k) { if (window._wl.handleFound) window._wl.handleFound(k); };
window.repositionSearch = function(p) { if (window._wl.repositionSearch) window._wl.repositionSearch(p); };
window.getWorkerUrl = function() { return window._wl.getWorkerUrl ? window._wl.getWorkerUrl() : null; };

// Proxy properties so ui.js bare globals stay in sync with _wl
Object.defineProperty(window, 'running', {
  get: function() { return window._wl.running; },
  set: function(v) { window._wl.running = v; },
  enumerable: true
});
Object.defineProperty(window, 'currentWallet', {
  get: function() { return window._wl.currentWallet; },
  set: function(v) { window._wl.currentWallet = v; },
  enumerable: true
});
Object.defineProperty(window, 'currentSel', {
  get: function() { return window._wl.currentSel; },
  set: function(v) { window._wl.currentSel = v; },
  enumerable: true
});
Object.defineProperty(window, 'rangeStart', {
  get: function() { return window._wl.rangeStart; },
  set: function(v) { window._wl.rangeStart = v; },
  enumerable: true
});
Object.defineProperty(window, 'rangeEnd', {
  get: function() { return window._wl.rangeEnd; },
  set: function(v) { window._wl.rangeEnd = v; },
  enumerable: true
});
Object.defineProperty(window, 'startPct', {
  get: function() { return window._wl.startPct; },
  set: function(v) { window._wl.startPct = v; },
  enumerable: true
});
Object.defineProperty(window, '_smallRange', {
  get: function() { return window._wl._smallRange || false; },
  set: function(v) { window._wl._smallRange = v; },
  enumerable: true
});
Object.defineProperty(window, 'searchMode', {
  get: function() { return window._wl.searchMode; },
  set: function(v) { window._wl.searchMode = v; },
  enumerable: true
});
Object.defineProperty(window, 'multiGpuCount', {
  get: function() { return window._wl.multiGpuCount; },
  set: function(v) { window._wl.multiGpuCount = v; },
  enumerable: true
});
Object.defineProperty(window, '_sharedWasmModule', {
  get: function() { return window._wl._sharedWasmModule; },
  set: function(v) { window._wl._sharedWasmModule = v; },
  enumerable: true
});
