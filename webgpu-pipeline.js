// WebGPU Turbo Pipeline — optimized for RTX 4090/5090
// Double-buffered dispatch, WASM scalarMul precompute, auto-scaling workgroups
// Eliminates elliptic.js bottleneck from hot loop

const WebGPU_Turbo = (() => {
    let adapter = null, device = null, pipeline = null;

    const TARGET_DISPATCH_MS = 150;
    const MIN_DISPATCH_MS = 30;
    const MAX_DISPATCH_MS = 400;
    const CALIBRATION_KEY = 'webloteria.gpuWgV3';
    const RESULTS_SIZE = 4 + 32 * 8;

    let gpuRunning = false;
    let gpuAbort = null;
    let adapterInfo = null;
    let gpuProfile = null;

    let totalChecked = 0n;
    let dispatchCount = 0;

    // Double-buffer: two complete sets of GPU buffers
    let bufs = [{}, {}];
    let bufIdx = 0;

    let WORKGROUP_SIZE = 64;
    let BATCH_SIZE = 48;
    let keysPerDispatch = WORKGROUP_SIZE * BATCH_SIZE * 48;
    let maxWorkgroups = 65535;

    // WASM precompute instance (replaces elliptic.js)
    let wasmInst = null;
    let wasmDv = null;

    const GPU_PROFILES = {
        'nvidia':   { workgroupSize: 64, batchSize: 48, maxWorkgroups: 65535 },
        'amd':      { workgroupSize: 64, batchSize: 48, maxWorkgroups: 65535 },
        'intel':    { workgroupSize: 32, batchSize: 32, maxWorkgroups: 65535 },
        'qualcomm': { workgroupSize: 64, batchSize: 24, maxWorkgroups: 65535 },
        'arm':      { workgroupSize: 32, batchSize: 24, maxWorkgroups: 16384 },
        'apple':    { workgroupSize: 32, batchSize: 32, maxWorkgroups: 65535 },
        'powervr':  { workgroupSize: 32, batchSize: 16, maxWorkgroups: 8192 },
        'broadcom': { workgroupSize: 16, batchSize: 16, maxWorkgroups: 4096 },
        'default':  { workgroupSize: 32, batchSize: 24, maxWorkgroups: 16384 }
    };

    function detectGPUVendor(info) {
        const all = ((info.vendor||'') + ' ' + (info.architecture||'') + ' ' + (info.device||info.description||'')).toLowerCase();
        if (all.includes('nvidia') || all.includes('geforce') || all.includes('rtx') || all.includes('gtx') || all.includes('tesla')) return 'nvidia';
        if (all.includes('amd') || all.includes('radeon') || all.includes('navi') || all.includes('rdna')) return 'amd';
        if (all.includes('intel') || all.includes('uhd') || all.includes('iris') || all.includes('arc')) return 'intel';
        if (all.includes('qualcomm') || all.includes('adreno') || all.includes('snapdragon')) return 'qualcomm';
        if (all.includes('arm') || all.includes('mali') || all.includes('bifrost') || all.includes('valhall')) return 'arm';
        if (all.includes('apple') || all.includes('m1') || all.includes('m2') || all.includes('m3') || all.includes('a1')) return 'apple';
        if (all.includes('powervr') || all.includes('imagination')) return 'powervr';
        if (all.includes('broadcom') || all.includes('videocore')) return 'broadcom';
        return 'default';
    }

    // WASM scalarMul precompute — replaces elliptic.js (1.7ms vs 5ms)
    function initWasmPrecompute(sharedModule) {
        if (wasmInst) return true;
        if (!sharedModule) return false;
        try {
            wasmInst = new WebAssembly.Instance(sharedModule);
            wasmDv = new DataView(wasmInst.exports.mem.buffer);
            return true;
        } catch (e) { return false; }
    }

    function precomputeBase(keyBigInt) {
        if (!wasmInst) return null;
        const dv = wasmDv;
        const K = 0x50000, PX = 0x50020, PY = 0x50040, PZ = 0x50060;
        const AX = 0x50080, AY = 0x500A0;
        let k = keyBigInt;
        for (let i = 0; i < 8; i++) {
            dv.setUint32(K + i * 4, Number(k & 0xffffffffn), true);
            k >>= 32n;
        }
        wasmInst.exports.scalarMul(K, PX, PY, PZ);
        wasmInst.exports.to_affine(PX, PY, PZ, AX, AY);
        const x = new Uint32Array(8), y = new Uint32Array(8);
        for (let i = 0; i < 8; i++) {
            x[i] = dv.getUint32(AX + i * 4, true);
            y[i] = dv.getUint32(AY + i * 4, true);
        }
        return x[0] === 0 && x[1] === 0 && x[2] === 0 && x[3] === 0 &&
               x[4] === 0 && x[5] === 0 && x[6] === 0 && x[7] === 0 ? null : x;
    }

    function precomputeBaseXY(keyBigInt) {
        if (!wasmInst) return null;
        const dv = wasmDv;
        const K = 0x50000, PX = 0x50020, PY = 0x50040, PZ = 0x50060;
        const AX = 0x50080, AY = 0x500A0;
        let k = typeof keyBigInt === 'string' ? BigInt('0x' + keyBigInt) : keyBigInt;
        for (let i = 0; i < 8; i++) {
            dv.setUint32(K + i * 4, Number(k & 0xffffffffn), true);
            k >>= 32n;
        }
        wasmInst.exports.scalarMul(K, PX, PY, PZ);
        const parity = wasmInst.exports.to_affine(PX, PY, PZ, AX, AY);
        const x = [], y = [];
        for (let i = 0; i < 8; i++) {
            x.push(dv.getUint32(AX + i * 4, true));
            y.push(dv.getUint32(AY + i * 4, true));
        }
        return { x, y, parity };
    }

    async function init(sharedModule) {
        if (!navigator.gpu) return false;
        try {
            adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
            if (!adapter) adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
            if (!adapter) adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return false;

            adapterInfo = {};
            try {
                if (typeof adapter.requestAdapterInfo === 'function') {
                    adapterInfo = await adapter.requestAdapterInfo();
                } else if (adapter.info) {
                    adapterInfo = adapter.info;
                }
            } catch (e) {}

            const vendor = detectGPUVendor(adapterInfo);
            gpuProfile = GPU_PROFILES[vendor] || GPU_PROFILES['default'];
            WORKGROUP_SIZE = gpuProfile.workgroupSize;
            BATCH_SIZE = gpuProfile.batchSize;

            // Scale max workgroups based on GPU limits
            if (adapter.limits && adapter.limits.maxComputeWorkgroupsPerDimension) {
                maxWorkgroups = adapter.limits.maxComputeWorkgroupsPerDimension;
            } else {
                maxWorkgroups = gpuProfile.maxWorkgroups;
            }

            // Auto-scale keys per dispatch for high-end GPUs
            keysPerDispatch = Math.max(WORKGROUP_SIZE * BATCH_SIZE * 48, keysPerDispatch);

            const opts = {};
            device = await adapter.requestDevice(opts);
            device.lost.then(info => {
                console.warn('[WebGPU] Device lost:', info.message);
                if (gpuRunning) recover();
            });

            restoreCalibration();

            // Init WASM precompute
            if (sharedModule) initWasmPrecompute(sharedModule);

            console.log('[WebGPU] Detected:', vendor, '| WG:', WORKGROUP_SIZE, '| Batch:', BATCH_SIZE,
                '| MaxWG:', maxWorkgroups, '| Keys/dispatch:', keysPerDispatch,
                '| Vendor:', adapterInfo.vendor, '| Arch:', adapterInfo.architecture);
            return true;
        } catch (e) {
            console.warn('[WebGPU] Init failed:', e);
            return false;
        }
    }

    async function setup() {
        if (!device) return false;
        try {
            const codes = await Promise.all([
                fetchWgsl('shaders/bigint.wgsl'),
                fetchWgsl('shaders/secp256k1.wgsl'),
                fetchWgsl('shaders/sha256.wgsl'),
                fetchWgsl('shaders/ripemd160.wgsl'),
                fetchWgsl('shaders/search.wgsl')
            ]);
            const fullWGSL = codes.join('\n');

            const shaderModule = device.createShaderModule({ code: fullWGSL });
            const info = await shaderModule.getCompilationInfo();
            for (const msg of info.messages) {
                if (msg.type === 'error') {
                    console.error('[WebGPU] Shader error:', msg.message, msg.lineNum);
                    return false;
                }
            }

            pipeline = device.createComputePipeline({
                layout: 'auto',
                compute: { module: shaderModule, entryPoint: 'search' }
            });

            // Create double-buffer set
            for (let i = 0; i < 2; i++) {
                bufs[i].params = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
                bufs[i].output = device.createBuffer({ size: RESULTS_SIZE, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
                bufs[i].read = device.createBuffer({ size: RESULTS_SIZE, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
                bufs[i].bindGroup = device.createBindGroup({
                    layout: pipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: bufs[i].params } },
                        { binding: 1, resource: { buffer: bufs[i].output } }
                    ]
                });
            }

            return true;
        } catch (e) {
            console.error('[WebGPU] Setup failed:', e);
            return false;
        }
    }

    function fetchWgsl(path) {
        return fetch(path).then(r => {
            if (!r.ok) throw new Error('Failed to load ' + path);
            return r.text();
        });
    }

    function encodeU256(view, offset, bigintValue) {
        let v = bigintValue;
        for (let i = 0; i < 8; i++) {
            view.setUint32(offset + i * 4, Number(v & 0xffffffffn), true);
            v >>= 32n;
        }
    }

    function encodeU256FromArr(view, offset, arr) {
        for (let i = 0; i < 8; i++) view.setUint32(offset + i * 4, arr[i], true);
    }

    function encodeParamsToBuffer(buf, baseX, baseY, targetWords, keysPerThread) {
        const v = new DataView(buf);
        encodeU256FromArr(v, 0, baseX);
        encodeU256FromArr(v, 32, baseY);
        for (let i = 0; i < 5; i++) v.setUint32(64 + i * 4, targetWords[i], true);
        v.setUint32(84, keysPerThread, true);
        v.setUint32(88, 0, true);
    }

    function hash160ToU32Array(hash160Hex) {
        const w = new Uint32Array(5);
        for (let i = 0; i < 5; i++) {
            w[i] = parseInt(hash160Hex.substr(i * 8, 8), 16);
        }
        return w;
    }

    function calibrate(elapsedMs) {
        let next = keysPerDispatch;
        if (elapsedMs > MAX_DISPATCH_MS) {
            next = Math.max(WORKGROUP_SIZE * BATCH_SIZE, Math.floor(next / 2));
        } else if (elapsedMs < MIN_DISPATCH_MS) {
            next = Math.min(1 << 26, next * 2);
        } else if (elapsedMs < TARGET_DISPATCH_MS * 0.7) {
            next = Math.min(1 << 26, Math.floor(next * 1.25));
        }
        if (next !== keysPerDispatch) {
            keysPerDispatch = next;
            try { localStorage.setItem(CALIBRATION_KEY, String(next)); } catch (e) {}
        }
    }

    function restoreCalibration() {
        try {
            const s = parseInt(localStorage.getItem(CALIBRATION_KEY));
            if (s >= WORKGROUP_SIZE * BATCH_SIZE && s <= (1 << 26)) keysPerDispatch = s;
        } catch (e) {}
    }

    function partition(desired) {
        let keysPerThread = BATCH_SIZE;
        let wg = Math.max(1, Math.ceil(desired / (WORKGROUP_SIZE * keysPerThread)));
        wg = Math.min(wg, maxWorkgroups);
        return { workgroups: wg, keysPerThread };
    }

    // Submit GPU work (non-blocking after submit)
    function submitDispatch(bufSet, baseXArr, baseYArr, targetWords) {
        const { workgroups, keysPerThread } = partition(keysPerDispatch);
        const totalKeys = workgroups * WORKGROUP_SIZE * keysPerThread;

        const paramBytes = new ArrayBuffer(100);
        encodeParamsToBuffer(paramBytes, baseXArr, baseYArr, targetWords, keysPerThread);

        device.queue.writeBuffer(bufSet.params, 0, paramBytes);
        device.queue.writeBuffer(bufSet.output, 0, new ArrayBuffer(RESULTS_SIZE));

        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bufSet.bindGroup);
        pass.dispatchWorkgroups(workgroups);
        pass.end();
        enc.copyBufferToBuffer(bufSet.output, 0, bufSet.read, 0, RESULTS_SIZE);
        device.queue.submit([enc.finish()]);

        return totalKeys;
    }

    // Read results from previous dispatch (waits for GPU completion)
    async function readResults(bufSet) {
        try {
            await bufSet.read.mapAsync(GPUMapMode.READ);
            const d = new DataView(bufSet.read.getMappedRange());
            const count = Math.min(d.getUint32(0, true), 32);
            const hits = [];
            for (let i = 0; i < count; i++) {
                const off = 4 + i * 8;
                hits.push({ threadId: d.getUint32(off, true), keyOffset: d.getUint32(off + 4, true) });
            }
            bufSet.read.unmap();
            return hits;
        } catch (e) {
            return [];
        }
    }

    async function searchLoop(targetHash160, startKey, endKey, onProgress, onFound) {
        gpuRunning = true;
        gpuAbort = new AbortController();
        totalChecked = 0n;
        dispatchCount = 0;

        const targetWords = hash160ToU32Array(targetHash160);
        let currentKey = startKey;

        const useWasm = wasmInst !== null;
        let ecInstance = null;
        if (!useWasm) {
            try { ecInstance = elliptic.ec('secp256k1'); } catch (e) {
                console.warn('[WebGPU] No WASM precompute and no elliptic.js — aborting');
                gpuRunning = false;
                return { totalChecked: 0n, dispatchCount: 0 };
            }
        }

        const { workgroups, keysPerThread } = partition(keysPerDispatch);
        var keysCovered = BigInt(workgroups * WORKGROUP_SIZE * keysPerThread);

        // Prime the pipeline: submit first dispatch
        let prevHits = [];
        let prevTotalKeys = 0n;

        async function submitOne(key, buf) {
            let baseX, baseY;
            if (useWasm) {
                const bp = precomputeBaseXY(key);
                if (!bp) return 0;
                baseX = bp.x;
                baseY = bp.y;
            } else {
                const keyHex = key.toString(16).padStart(64, '0');
                const kp = ecInstance.keyFromPrivate(keyHex, 'hex');
                const pub = kp.getPublic();
                baseX = [];
                baseY = [];
                let vx = BigInt('0x' + pub.x.toString(16));
                let vy = BigInt('0x' + pub.y.toString(16));
                for (let i = 0; i < 8; i++) {
                    baseX.push(Number(vx & 0xffffffffn)); vx >>= 32n;
                    baseY.push(Number(vy & 0xffffffffn)); vy >>= 32n;
                }
            }
            return submitDispatch(buf, baseX, baseY, targetWords);
        }

        // Pipelined loop: submit N+1 while reading N
        var prevKeysCovered = 0n;
        var prevStartKey = 0n;
        while (gpuRunning && currentKey < endKey) {
            if (gpuAbort.signal.aborted) break;

            const curBuf = bufs[bufIdx];
            const curKeysCovered = keysCovered;
            const curStartKey = currentKey;

            // Submit current dispatch (non-blocking after queue.submit)
            const t0 = performance.now();
            const totalKeys = await submitOne(currentKey, curBuf);

            if (totalKeys === 0) {
                currentKey += keysCovered;
                continue;
            }

            dispatchCount++;
            totalChecked += BigInt(totalKeys);
            currentKey += keysCovered;

            // Read previous dispatch results while GPU works on current
            if (dispatchCount > 1) {
                const prevBuf = bufs[1 - bufIdx];
                prevHits = await readResults(prevBuf);
                const elapsed = performance.now() - t0;
                calibrate(elapsed);

                if (prevHits.length > 0) {
                    for (const hit of prevHits) {
                        const hitKey = prevStartKey + BigInt(hit.threadId) * BigInt(BATCH_SIZE) + BigInt(hit.keyOffset);
                        if (hitKey >= startKey && hitKey <= endKey) {
                            const keyHex = hitKey.toString(16).padStart(64, '0');
                            if (onFound) onFound(keyHex);
                        }
                    }
                }
            } else {
                const elapsed = performance.now() - t0;
                calibrate(elapsed);
            }

            if (onProgress) {
                onProgress({
                    count: Number(curKeysCovered),
                    totalChecked: totalChecked,
                    gpuDispatches: dispatchCount,
                    elapsed: performance.now() - t0
                });
            }

            prevKeysCovered = curKeysCovered;
            prevStartKey = curStartKey;

            // Swap buffers
            bufIdx = 1 - bufIdx;

            // Recalculate keysCovered after calibration
            const np = partition(keysPerDispatch);
            keysCovered = BigInt(np.workgroups * WORKGROUP_SIZE * np.keysPerThread);

            // Yield to event loop
            await new Promise(r => setTimeout(r, 0));
        }

        // Read final pending dispatch
        if (dispatchCount > 0) {
            const finalBuf = bufs[1 - bufIdx];
            try {
                await finalBuf.read.mapAsync(GPUMapMode.READ);
                const d = new DataView(finalBuf.read.getMappedRange());
                const count = Math.min(d.getUint32(0, true), 32);
                const lastKey = currentKey - keysCovered;
                for (let i = 0; i < count; i++) {
                    const off = 4 + i * 8;
                    const threadId = d.getUint32(off, true);
                    const keyOffset = d.getUint32(off + 4, true);
                    const hitKey = lastKey + BigInt(threadId) * BigInt(BATCH_SIZE) + BigInt(keyOffset);
                    if (hitKey >= startKey && hitKey <= endKey) {
                        const keyHex = hitKey.toString(16).padStart(64, '0');
                        if (onFound) onFound(keyHex);
                    }
                }
                finalBuf.read.unmap();
            } catch (e) {}
        }

        gpuRunning = false;
        return { totalChecked, dispatchCount };
    }

    async function recover() {
        console.log('[WebGPU] Attempting recovery...');
        keysPerDispatch = Math.max(WORKGROUP_SIZE * BATCH_SIZE, Math.floor(keysPerDispatch / 8));
        try { localStorage.setItem(CALIBRATION_KEY, String(keysPerDispatch)); } catch (e) {}
        try {
            adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
            if (!adapter) adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return false;
            device = await adapter.requestDevice();
            device.lost.then(info => { if (gpuRunning) recover(); });
            await setup();
            return true;
        } catch (e) {
            return false;
        }
    }

    function stop() {
        gpuRunning = false;
        if (gpuAbort) gpuAbort.abort();
    }

    function getGPUInfo() {
        if (!adapter) return null;
        return {
            vendor: adapterInfo.vendor || 'unknown',
            architecture: adapterInfo.architecture || 'unknown',
            device: adapterInfo.device || adapterInfo.description || 'unknown',
            description: adapterInfo.description || '',
            maxWorkgroups: adapter.limits ? adapter.limits.maxComputeWorkgroupsPerDimension : maxWorkgroups,
            maxBufferSize: adapter.limits ? adapter.limits.maxBufferSize : 0,
            gpuVendorDetected: gpuProfile ? detectGPUVendor(adapterInfo) : 'unknown',
            workgroupSize: WORKGROUP_SIZE,
            batchSize: BATCH_SIZE,
            keysPerDispatch: keysPerDispatch
        };
    }

    function getCPUInfo() {
        const ua = navigator.userAgent || '';
        const pl = navigator.platform || '';
        const ual = ua.toLowerCase();
        if (ual.includes('android') && (ual.includes('snapdragon') || ual.includes('qualcomm'))) return { vendor: 'qualcomm', arch: 'arm', simd: 'neon' };
        if (ual.includes('iphone') || ual.includes('ipad') || ual.includes('macintosh')) return { vendor: 'apple', arch: 'arm', simd: 'neon' };
        if (ual.includes('amd') || pl.includes('AMD')) return { vendor: 'amd', arch: 'x86', simd: 'avx2' };
        if (ual.includes('intel')) return { vendor: 'intel', arch: 'x86', simd: 'avx2' };
        if (pl.includes('ARM') || pl.includes('aarch64')) return { vendor: 'generic', arch: 'arm', simd: 'neon' };
        return { vendor: 'unknown', arch: 'x86', simd: 'sse4' };
    }

    function isAvailable() { return !!device && !!pipeline; }

    return {
        init,
        setup,
        searchLoop,
        stop,
        recover,
        getGPUInfo,
        getCPUInfo,
        isAvailable,
        get totalChecked() { return totalChecked; },
        get dispatchCount() { return dispatchCount; },
        get keysPerDispatch() { return keysPerDispatch; },
        get wasmReady() { return wasmInst !== null; }
    };
})();

if (typeof window !== 'undefined') window.WebGPU_Turbo = WebGPU_Turbo;
