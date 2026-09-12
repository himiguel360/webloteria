// gpu-manager.js — Unified GPU/CPU backend manager
// Cascade: WebGPU (Vulkan/DX12/Metal) → WebGL 2.0 Compute → CPU (WASM Workers)
// Provides a single interface for the controller to use.

const GPUManager = (() => {
  let activeBackend = null;  // 'webgpu' | 'webgl' | 'cpu' | null
  let preferredBackend = 'auto'; // 'auto' | 'webgpu' | 'webgl' | 'cpu'
  let backends = {};
  let deviceInfo = null;

  const BACKENDS = {
    webgpu: { label: 'WebGPU', desc: 'Vulkan / DX12 / Metal', priority: 1 },
    webgl:  { label: 'WebGL 2.0', desc: 'ANGLE OpenGL ES 3.0', priority: 2 },
    cpu:    { label: 'CPU (WASM)', desc: 'WebAssembly multi-thread', priority: 3 }
  };

  // ── Detection ──────────────────────────────────────────────────

  async function detectWebGPU() {
    if (!navigator.gpu) return null;
    try {
      let adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
      if (!adapter) adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;

      let adapterInfo = {};
      try {
        if (typeof adapter.requestAdapterInfo === 'function') {
          adapterInfo = await adapter.requestAdapterInfo();
        } else if (adapter.info) {
          adapterInfo = adapter.info;
        }
      } catch (e) {}

      const device = await adapter.requestDevice();
      device.lost.then(() => {});

      // Detect backend API (Vulkan, DX12, Metal)
      let api = 'unknown';
      const desc = ((adapterInfo.description || '') + ' ' + (adapterInfo.architecture || '')).toLowerCase();
      if (desc.includes('vulkan') || desc.includes('mesa') || desc.includes('radv') || desc.includes('swiftshader')) api = 'Vulkan';
      else if (desc.includes('d3d') || desc.includes('direct') || desc.includes('dx12')) api = 'Direct3D 12';
      else if (desc.includes('metal') || desc.includes('apple') || desc.includes('m1') || desc.includes('m2') || desc.includes('m3') || desc.includes('m4')) api = 'Metal';
      else if (desc.includes('opengl') || desc.includes('ANGLE')) api = 'OpenGL ES (via ANGLE)';
      else {
        // Platform-based guess
        const ua = navigator.userAgent.toLowerCase();
        const pf = (navigator.platform || '').toLowerCase();
        if (pf.includes('linux') || ua.includes('linux')) api = 'Vulkan (Mesa)';
        else if (pf.includes('mac') || ua.includes('mac')) api = 'Metal';
        else if (ua.includes('windows') || pf.includes('win')) api = 'Direct3D 12';
        else if (ua.includes('android')) api = 'Vulkan';
        else if (ua.includes('iphone') || ua.includes('ipad')) api = 'Metal';
      }

      return {
        type: 'webgpu',
        adapter, device, adapterInfo,
        api,
        vendor: adapterInfo.vendor || 'unknown',
        architecture: adapterInfo.architecture || 'unknown',
        deviceName: adapterInfo.device || adapterInfo.description || 'unknown',
        limits: adapter.limits || {},
        features: adapter.features ? Array.from(adapter.features) : []
      };
    } catch (e) {
      console.warn('[GPU] WebGPU detection failed:', e);
      return null;
    }
  }

  async function detectWebGL() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
      if (!gl) return null;

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown';
      const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';
      const version = gl.getParameter(gl.VERSION);
      const shadingLang = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);

      // Check for compute-like capability (EXT_color_buffer_float)
      const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
      const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const maxVaryings = gl.getParameter(gl.MAX_VARYING_VECTORS);

      // Cleanup
      const loseCtx = gl.getExtension('WEBGL_lose_context');
      if (loseCtx) loseCtx.loseContext();

      return {
        type: 'webgl',
        vendor, renderer, version, shadingLang,
        hasFloat,
        maxTextureSize,
        maxVaryings,
        limits: { maxTextureSize, maxVaryings }
      };
    } catch (e) {
      return null;
    }
  }

  function detectCPU() {
    const cores = navigator.hardwareConcurrency || 4;
    const ua = navigator.userAgent.toLowerCase();
    const pf = (navigator.platform || '').toLowerCase();
    let arch = 'x86';
    if (pf.includes('arm') || pf.includes('aarch64') || ua.includes('android')) arch = 'arm';

    return {
      type: 'cpu',
      cores,
      arch,
      maxWorkers: Math.min(cores, 8),
      wasmSupported: typeof WebAssembly === 'object'
    };
  }

  // ── GPU Vendor Detection (for profiling) ──────────────────────

  function detectGPUVendor(info) {
    const all = ((info.vendor || '') + ' ' + (info.architecture || '') + ' ' + (info.deviceName || '')).toLowerCase();
    if (all.includes('nvidia') || all.includes('geforce') || all.includes('rtx') || all.includes('gtx') || all.includes('tesla') || all.includes('quadro')) return 'nvidia';
    if (all.includes('amd') || all.includes('radeon') || all.includes('navi') || all.includes('rdna')) return 'amd';
    if (all.includes('intel') || all.includes('uhd') || all.includes('iris') || all.includes('arc')) return 'intel';
    if (all.includes('qualcomm') || all.includes('adreno') || all.includes('snapdragon')) return 'qualcomm';
    if (all.includes('arm') || all.includes('mali') || all.includes('bifrost') || all.includes('valhall')) return 'arm';
    if (all.includes('apple') || all.includes('m1') || all.includes('m2') || all.includes('m3') || all.includes('m4')) return 'apple';
    if (all.includes('powervr') || all.includes('imagination')) return 'powervr';
    if (all.includes('broadcom') || all.includes('videocore')) return 'broadcom';
    if (all.includes('swiftshader')) return 'swiftshader';
    return 'unknown';
  }

  // ── Init ──────────────────────────────────────────────────────

  async function init(preferred) {
    preferredBackend = preferred || 'auto';
    activeBackend = null;
    deviceInfo = null;

    const order = preferredBackend === 'auto'
      ? ['webgpu', 'webgl', 'cpu']
      : [preferredBackend, ...['webgpu', 'webgl', 'cpu'].filter(b => b !== preferredBackend)];

    for (const backend of order) {
      let info = null;
      if (backend === 'webgpu') info = await detectWebGPU();
      else if (backend === 'webgl') info = await detectWebGL();
      else if (backend === 'cpu') info = detectCPU();

      if (info) {
        // For CPU, require WebAssembly
        if (backend === 'cpu' && !info.wasmSupported) continue;

        activeBackend = backend;
        deviceInfo = info;
        info.vendorDetected = detectGPUVendor(info);
        console.log(`[GPU] Active backend: ${BACKENDS[backend].label} (${info.api || info.renderer || info.cores + ' cores'})`);
        break;
      }
    }

    if (!activeBackend) {
      console.error('[GPU] No backend available!');
      return false;
    }

    return true;
  }

  // ── Public API ────────────────────────────────────────────────

  function getBackend() { return activeBackend; }
  function getInfo() { return deviceInfo; }
  function getLabel() { return activeBackend ? BACKENDS[activeBackend].label : 'None'; }
  function getDesc() {
    if (!activeBackend) return 'Nenhum backend disponível';
    if (activeBackend === 'webgpu') return `${deviceInfo.api} — ${deviceInfo.vendorDetected}`;
    if (activeBackend === 'webgl') return `${deviceInfo.renderer}`;
    if (activeBackend === 'cpu') return `${deviceInfo.cores} cores (${deviceInfo.arch})`;
    return '';
  }
  function isAvailable() { return activeBackend !== null; }

  return {
    init,
    getBackend,
    getInfo,
    getLabel,
    getDesc,
    isAvailable,
    detectWebGPU,
    detectWebGL,
    detectCPU,
    BACKENDS
  };
})();

if (typeof window !== 'undefined') window.GPUManager = GPUManager;
