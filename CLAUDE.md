# CLAUDE.md

This file provides guidance when working with code in this repository.

## Project Overview

Web Loteria is a client-side Bitcoin puzzle finder that searches private-key ranges against target puzzle addresses. Modular architecture with ES modules + Stimulus.js controller pattern. Deployed as a static site via GitHub Pages.

## Architecture

```
index.html              Markup only (169 lines, zero inline JS/CSS)
css/
  tokens.css            Design tokens + theme engine (dark/light)
  base.css              Reset, buttons, forms, scrollbars
  components.css        UI components + GPU badge + progress + livekeys
  animations.css        Micro-interactions
js/
  app.js                Stimulus entry point (ES module)
  page.js               i18n + preset grid (8 locales)
  controller.js         Stimulus controller (orchestrator)
  bridge.js             Shared state between controller/ui/sync
  crypto.js             Bitcoin address generation (elliptic + CryptoJS)
  block-tracker.js      Progress persistence (localStorage)
  sync.js               Server sync + result reporting
  ui.js                 UI features (live keys, batch verify, lupa)
  gpu-manager.js        GPU backend cascade: WebGPU → WebGL 2.0 → CPU
  webgpu-pipeline.js    WebGPU compute pipeline (WGSL shaders inline)
  worker.js             WASM batch pipeline (embedded base64)
data/
  wallets.json          160 wallets of the 1000 BTC puzzle
locales/ (8 files)      pt, en, es, de, he, ru, ja, id
fonts/                  Archivo + Chivo Mono
vendor/                 Stimulus.js
```

**GPU backend cascade:**
1. WebGPU (Vulkan on Linux/Android, DX12 on Windows, Metal on macOS/iOS) — 85% desktop coverage
2. WebGL 2.0 via ANGLE (OpenGL ES 3.0 fallback) — 96% browser coverage
3. CPU via WASM Web Workers — universal fallback

**WebGPU features:**
- Triple-buffered dispatch for latency hiding
- Compatibility mode for older GPUs (`featureLevel: "compatibility"`)
- Auto-detects graphics API (Vulkan/DX12/Metal) via `adapterInfo`
- GPU vendor profiling (NVIDIA, AMD, Intel, Qualcomm, ARM, Apple)
- Adaptive workgroup sizing based on `adapter.limits`
- Subgroups detection for optimization

## Conventions

- UI text in **Portuguese** (default locale)
- All JS files except app.js are regular `<script>` tags (set `window.*` globals)
- app.js is `type="module"` (imports Stimulus + page.js + controller.js)
- Script load order: CDN libs → bridge.js → crypto → block-tracker → sync → ui → gpu-manager → webgpu-pipeline → Stimulus → app.js
- Wallets stored in `data/wallets.json` with `{number, address, solved}` schema
- Found keys persisted in `localStorage` under key `foundKeys`
- External API: `POST https://bitcoinpuzzles.io/api/puzzle-results`
