import { Controller } from "@hotwired/stimulus"

const TARGET_BATCH_MS = 150
const INITIAL_BATCH = 8192
const MIN_BATCH = 1024
const MAX_BATCH = 1 << 21
const BATCH_ADJUST_RATE = 0.5

const STATS_INTERVAL_MS = 500
const SPEED_SMOOTHING = 0.3

const BLOCK_SIZE = 1073741824n

class InlineWorker {
  constructor() {
    this.alive = true
    this.onmessage = null
    this.onerror = null
  }

  postMessage(data) {
    setTimeout(() => this.run(data), 0)
  }

  terminate() {
    this.alive = false
    this.onmessage = null
  }

  run(data) {
    if (!this.alive) return

    if (data.type === "start") {
      this.cfg = data
      this.emit({ type: "idle" })
      return
    }

    if (data.type === "init") {
      this.cfg = data
      this.emit({ type: "idle" })
      return
    }

    this.emit({
      type: "done",
      count: data.count || data.batchSize || 0,
      elapsed: 0,
      found: null
    })
  }

  emit(data) {
    if (this.alive) this.onmessage?.({ data })
  }
}

export default class extends Controller {
  static targets = [
    "statusDot", "statusText", "startKey", "targetAddress", "workerCount",
    "startBtn", "stopBtn", "presets",
    "speed", "totalChecked", "currentKey",
    "console", "consoleEmpty", "foundCard", "foundBody"
  ]

  static values = { assetVersion: String, strings: Object }

  connect() {
    this.running = false
    this.totalKeys = 0n
    this.workers = []
    this.batchSize = INITIAL_BATCH
    this.locale = document.documentElement.lang || "pt"
    this.plural = this.pluralRules(this.locale)
    this.gpuSearchActive = false
    this.blockTracker = null
    this.workerBlocks = {}
    this.smallRange = false
    this.startTime = 0
    this.lastSample = { at: 0, keys: 0n }
    this.smoothedSpeed = 0
    this._speedAvg = []
    this._lastSpeedSync = 0
    this._blockSaveTimer = null
    this._liveKeysBuffer = []
    this._liveKeysTimer = null
    this._currentPuzzleId = null
    this._currentWallet = null
    this.selectedGpuBackend = 'auto'

    // Wire up bridge.js globals for ui.js/sync.js compatibility
    this._wireBridge()

    // Init GPU manager
    this._initGPUManager()

    // Init UI modules (progress bar, percentage slider, random jump, auto-scan)
    this._initUIModules()

    // Restore theme
    this._restoreTheme()

    this.loadWasm()
  }

  _wireBridge() {
    const wl = window._wl
    if (!wl) return

    wl.log = (msg) => this.log('info', msg)
    wl.logOk = (msg) => this.log('success', msg)
    wl.logErr = (msg) => this.log('error', msg)
    wl.logWarn = (msg) => this.log('warn', msg)

    wl.stopAll = () => this.stop()
    wl.start = () => this.start()
    wl.handleFound = (k) => this.onFound(k)
    wl.getWorkerUrl = () => `js/worker.js${this.assetQuery}`
    wl.repositionSearch = (pct) => this._repositionSearch(pct)

    // Expose console elements
    wl.consoleEl = this.hasConsoleTarget ? this.consoleTarget : null
    wl.consoleEmptyEl = this.hasConsoleEmptyTarget ? this.consoleEmptyTarget : null
  }

  async _initGPUManager() {
    if (!window.GPUManager) return
    const saved = localStorage.getItem('webloteria.gpuBackend') || 'auto'
    this.selectedGpuBackend = saved
    const ok = await GPUManager.init(saved)
    if (ok) {
      const info = GPUManager.getInfo()
      const label = GPUManager.getLabel()
      const desc = GPUManager.getDesc()
      this.setWasmStatus('ready', `${label}: ${desc}`)
      window.gpuAvailable = GPUManager.getBackend() === 'webgpu'
      if (window._wl) window._wl._gpuBackend = GPUManager.getBackend()
      this.log('info', `GPU backend: ${label} (${desc})`)
    } else {
      window.gpuAvailable = false
      this.setWasmStatus('error', 'Nenhum backend disponível')
    }
  }

  _restoreTheme() {
    try {
      const saved = localStorage.getItem('webloteria.theme')
      if (saved) document.documentElement.setAttribute('data-theme', saved)
    } catch (e) {}
  }

  _initUIModules() {
    try {
      if (typeof initProgressBar === 'function') initProgressBar()
    } catch (e) { console.warn('initProgressBar failed:', e) }
    try {
      if (typeof initSliderListeners === 'function') initSliderListeners()
    } catch (e) { console.warn('initSliderListeners failed:', e) }
  }

  toggleTheme() {
    const html = document.documentElement
    const current = html.getAttribute('data-theme')
    const next = current === 'dark' ? 'light' : 'dark'
    html.setAttribute('data-theme', next)
    try { localStorage.setItem('webloteria.theme', next) } catch (e) {}
  }

  disconnect() {
    this.running = false
    this.teardownWorkers()
    this.stopStatsTimer()
    this.stopBlockSaveTimer()
    this.stopLiveKeysTimer()

    // Clean up bridge
    if (window._wl) {
      window._wl.running = false
      window._wl.currentWallet = null
    }
  }

  /* ------------------------------------------------------------------ */
  /* i18n                                                                */
  /* ------------------------------------------------------------------ */

  pluralRules(locale) {
    try {
      return new Intl.PluralRules(locale)
    } catch {
      return new Intl.PluralRules()
    }
  }

  t(path, vars = {}) {
    const value = path.split(".").reduce((node, key) => node?.[key], this.stringsValue)
    return this.interpolate(typeof value === "string" ? value : path, vars)
  }

  cores(count) {
    const forms = this.stringsValue?.cores ?? {}
    const form = forms[this.plural.select(count)] ?? forms.other ?? "%{count}"
    return this.interpolate(form, { count })
  }

  interpolate(template, vars) {
    return template.replace(/%\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match))
  }

  /* ------------------------------------------------------------------ */
  /* WASM Loading                                                        */
  /* ------------------------------------------------------------------ */

  get assetQuery() {
    return this.assetVersionValue ? `?v=${this.assetVersionValue}` : ""
  }

  async loadWasm() {
    try {
      this.populateWorkerCounts()
      this.workerCountChanged()
      this.startBtnTarget.disabled = false
      this.setWasmStatus("ready", this.t("status.ready", { cores: this.cores(this.selectedWorkerCount()) }))
    } catch (e) {
      this.setWasmStatus("error", this.t("status.error"))
      this.log("error", this.t("log.wasm_load_failed", { message: e.message }))
    }
  }

  /* ------------------------------------------------------------------ */
  /* UI state helpers                                                     */
  /* ------------------------------------------------------------------ */

  setWasmStatus(state, text) {
    this.statusDotTarget.className = `wl-engine__dot wl-engine__dot--${state}`
    this.statusTextTarget.textContent = text
  }

  setControlsRunning(isRunning) {
    this.startBtnTarget.disabled = isRunning
    this.stopBtnTarget.disabled = !isRunning
    this.startKeyTarget.disabled = isRunning
    this.targetAddressTarget.disabled = isRunning
    if (this.hasWorkerCountTarget) this.workerCountTarget.disabled = isRunning
  }

  /* ------------------------------------------------------------------ */
  /* Worker count                                                         */
  /* ------------------------------------------------------------------ */

  populateWorkerCounts() {
    if (!this.hasWorkerCountTarget) return
    const cores = navigator.hardwareConcurrency || 4
    const preferred = Math.max(1, cores - 1)
    this.workerCountTarget.innerHTML = ""
    const max = Math.max(cores * 2, 128)
    for (let n = 1; n <= max; n++) {
      const option = document.createElement("option")
      option.value = String(n)
      option.textContent = this.cores(n)
      option.selected = n === preferred
      this.workerCountTarget.appendChild(option)
    }
  }

  selectedWorkerCount() {
    if (!this.hasWorkerCountTarget) return Math.max(1, (navigator.hardwareConcurrency || 4) - 1)
    return Number(this.workerCountTarget.value) || 1
  }

  workerCountChanged() {
    if (this.running) return
    this.setWasmStatus("ready", this.t("status.ready", { cores: this.cores(this.selectedWorkerCount()) }))
  }

  /* ------------------------------------------------------------------ */
  /* Presets                                                              */
  /* ------------------------------------------------------------------ */

  loadPreset(event) {
    const button = event.currentTarget
    const number = Number(button.dataset.puzzle)
    const address = button.dataset.address
    if (!number || !address) return

    const min = 1n << BigInt(number - 1)
    const max = (1n << BigInt(number)) - 1n
    const solved = button.dataset.solved === "true"
    const startKey = solved ? min : min + this.randomBigInt(max - min)

    this.startKeyTarget.value = startKey.toString(16)
    this.targetAddressTarget.value = address

    this.element.querySelectorAll(".wl-preset").forEach(btn => {
      btn.classList.remove("is-active")
      btn.setAttribute("aria-pressed", "false")
    })
    button.classList.add("is-active")
    button.setAttribute("aria-pressed", "true")

    const message = solved ? "log.preset_loaded_solved" : "log.preset_loaded"
    this.log("info", this.t(message, { puzzle: String(number) }))
  }

  filterPresets(event) {
    this.presetsTarget.dataset.filter = event.currentTarget.dataset.filter
    this.presetsTarget.querySelectorAll(".wl-presets__filter").forEach(btn => {
      btn.setAttribute("aria-pressed", String(btn === event.currentTarget))
    })
    const grid = this.presetsTarget.querySelector(".wl-presets__grid")
    if (grid) grid.scrollTop = 0
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                                */
  /* ------------------------------------------------------------------ */

  start() {
    const keyHex = this.startKeyTarget.value.trim()
    const target = this.targetAddressTarget.value.trim()

    if (!/^[0-9a-fA-F]{1,64}$/.test(keyHex)) {
      this.log("error", this.t("log.invalid_key"))
      return
    }
    if (!target || target.length < 26) {
      this.log("error", this.t("log.invalid_address"))
      return
    }

    this.running = true
    this.totalKeys = 0n
    this.startBigKey = BigInt("0x" + keyHex)
    this.nextKey = this.startBigKey
    this.targetAddress = target
    this.batchSize = INITIAL_BATCH
    this.lastSample = { at: performance.now(), keys: 0n }
    this.smoothedSpeed = 0
    this._speedAvg = []
    this._lastSpeedSync = 0
    this.startTime = performance.now()

    this.setControlsRunning(true)

    const targetHash160 = window.addressToHash160(target)
    if (!targetHash160) {
      this.log("error", this.t("log.invalid_address"))
      this.running = false
      this.setControlsRunning(false)
      return
    }
    this.targetHash160 = targetHash160

    this._currentPuzzleId = this._detectPuzzleId(target)
    const puzzleRangeEnd = this._currentPuzzleId > 0
      ? (1n << BigInt(this._currentPuzzleId)) - 1n
      : this.startBigKey + BLOCK_SIZE * 500n
    this._currentWallet = { address: target, range: [this.startBigKey, puzzleRangeEnd] }

    // Update bridge globals for ui.js/sync.js
    if (window._wl) {
      window._wl.running = true
      window._wl.currentWallet = this._currentWallet
      window._wl.currentSel = this._currentPuzzleId
      window._wl.rangeStart = this.startBigKey
      window._wl.rangeEnd = puzzleRangeEnd
    }

    this.blockTracker = new window.BlockTracker(
      this._currentPuzzleId,
      this.startBigKey,
      this.startBigKey + BLOCK_SIZE * 500n
    )
    this.blockTracker.reset()

    this.log("info", this.t("log.started", { key: keyHex }))
    this.log("info", this.t("log.target", { address: target }))

    if (window.WbloterySync?.startSync) {
      window.WbloterySync.startSync()
    }

    const workerCount = this.selectedWorkerCount()
    const mode = window._wl?.searchMode || 'random'

    // Hybrid: sequential + random lanes in workers, GPU boost always
    if (mode === 'hybrid') {
      this.log("info", "Modo H\u00edbrido: sequencial + aleat\u00f3rio + GPU")
    } else {
      this.log("info", "Modo: " + (mode === 'sequential' ? 'sequencial' : 'aleat\u00f3rio'))
    }

    // GPU boost always runs when available (any mode)
    this._tryStartWebGPU(targetHash160, this.startBigKey)
    // CPU workers always run
    this.spawnWorkers(workerCount)
    this.startStatsTimer()
    this.startBlockSaveTimer()

    const cores = this.cores(this.workers.length)
    this.setWasmStatus("running", this.t("status.running", { cores }))
    this.log("info", this.t("log.searching", { cores }))

    if (window.WbloteryUI?.setEngineState) {
      window.WbloteryUI.setEngineState("running")
    }
  }

  _detectPuzzleId(address) {
    const presetBtns = this.element.querySelectorAll(".wl-preset[data-address]")
    for (const btn of presetBtns) {
      if (btn.dataset.address === address) return Number(btn.dataset.puzzle)
    }
    return 0
  }

  /* ------------------------------------------------------------------ */
  /* Stop                                                                 */
  /* ------------------------------------------------------------------ */

  stop() {
    if (!this.running) return
    this.finishRun()
    this.log("warn", this.t("log.stopped"))
  }

  finishRun() {
    this.running = false
    this.gpuSearchActive = false
    this.teardownWorkers()
    this.stopStatsTimer()
    this.stopBlockSaveTimer()
    this.stopLiveKeysTimer()

    // Update bridge state
    if (window._wl) {
      window._wl.running = false
    }

    if (window.WebGPU_Turbo && typeof window.WebGPU_Turbo.stop === "function") {
      try { window.WebGPU_Turbo.stop() } catch {}
    }

    if (window.WbloterySync?.stopSync) {
      window.WbloterySync.stopSync()
    }

    if (this.blockTracker) {
      try { this.blockTracker.save() } catch {}
    }

    this.updateStats({ sampleSpeed: false })
    this.setControlsRunning(false)
    this.workerCountChanged()

    if (window.WbloteryUI?.setEngineState) {
      window.WbloteryUI.setEngineState("ready")
    }
  }

  /* ------------------------------------------------------------------ */
  /* Finish: all ranges exhausted                                         */
  /* ------------------------------------------------------------------ */

  finishAllDone() {
    this.running = false
    this.gpuSearchActive = false
    this.teardownWorkers()
    this.stopStatsTimer()
    this.stopBlockSaveTimer()
    this.stopLiveKeysTimer()

    if (window.WebGPU_Turbo && typeof window.WebGPU_Turbo.stop === "function") {
      try { window.WebGPU_Turbo.stop() } catch {}
    }

    if (window.WbloterySync?.stopSync) {
      window.WbloterySync.stopSync()
    }

    if (this.blockTracker) {
      try { this.blockTracker.save() } catch {}
      this.log("info", "Progresso salvo: " + this.blockTracker.getPctDone().toFixed(4) + "% do intervalo verificado.")
    }

    this.setControlsRunning(false)
    this.workerCountChanged()

    this.log("warn", "O intervalo inteiro foi verificado sem sucesso.")
    this.log("info", "Tentativas realizadas: " + this.totalKeys.toLocaleString())

    if (window.WbloteryUI?.setEngineState) {
      window.WbloteryUI.setEngineState("ready")
    }
  }

  /* ------------------------------------------------------------------ */
  /* Worker Management                                                    */
  /* ------------------------------------------------------------------ */

  spawnWorkers(count) {
    for (let i = 0; i < count; i++) {
      if (!this.running) return
      let worker
      try {
        worker = new Worker(`js/worker.js${this.assetQuery}`)
      } catch (e) {
        this.log("warn", this.t("log.workers_unavailable", { message: e.message }))
        this.teardownWorkers()
        this.addWorker(new InlineWorker())
        return
      }

      worker.onerror = (event) => {
        this.log("error", this.t("log.worker_error", { message: event.message }))
        this.stop()
      }
      if (!this.addWorker(worker)) break
    }
  }

  addWorker(worker) {
    worker.onmessage = ({ data }) => this.handleWorkerMessage(worker, data)
    const idx = this.workers.length
    this.workers.push(worker)

    if (this.blockTracker) {
      const block = this.blockTracker.claimBlock(BLOCK_SIZE)
      if (!block) return false
      this.workerBlocks[idx] = block
      const blockKeyCount = block.end - block.start + 1n
      const searchMode = window._wl?.searchMode || 'random'
      worker.postMessage({
        type: "start",
        targetHash160: this.targetHash160,
        targetAddress: this.targetAddress,
        startKey: block.start.toString(16).padStart(64, "0"),
        endKey: block.end.toString(16).padStart(64, "0"),
        batchSize: this.batchSize,
        workerIndex: idx,
        lanes: 4,
        windowKeys: 262144,
        searchMode: searchMode,
        pipeB: 2048,
        blockKeys: blockKeyCount.toString()
      })
      this.log("info", "Worker " + idx + ": bloco [" + block.start.toString(16) + ".." + block.end.toString(16) + "] (" + blockKeyCount.toLocaleString() + " chaves)")
      return true
    } else {
      const count = this.batchSize
      const searchMode = window._wl?.searchMode || 'random'
      worker.postMessage({
        type: "start",
        targetHash160: this.targetHash160,
        targetAddress: this.targetAddress,
        startKey: this.nextKey.toString(16).padStart(64, "0"),
        endKey: (this.nextKey + BigInt(count) - 1n).toString(16).padStart(64, "0"),
        batchSize: count,
        workerIndex: idx,
        lanes: 4,
        windowKeys: 262144,
        searchMode: searchMode,
        pipeB: 2048,
        blockKeys: String(count)
      })
      this.nextKey += BigInt(count)
      return true
    }
  }

  _computeEndKey() {
    const end = this.nextKey + BigInt(this.batchSize) - 1n
    return end
  }

  teardownWorkers() {
    this.workers.forEach(worker => {
      if (!worker) return
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    })
    this.workers = []
  }

  assignRange(worker) {
    if (!this.running) return

    if (this.blockTracker) {
      const block = this.blockTracker.claimBlock(BLOCK_SIZE)
      if (!block) {
        worker.terminate()
        const idx = this.workers.indexOf(worker)
        if (idx !== -1) {
          this.workers[idx] = null
          delete this.workerBlocks[idx]
        }
        const active = this.workers.filter(w => w !== null)
        if (active.length === 0) this.finishAllDone()
        return
      }
      const idx = this.workers.indexOf(worker)
      this.workerBlocks[idx] = block
      const blockKeyCount = block.end - block.start + 1n
      this.log("info", "Worker " + idx + ": bloco [" + block.start.toString(16) + ".." + block.end.toString(16) + "] (" + blockKeyCount.toLocaleString() + " chaves)")

      worker.postMessage({
        type: "start",
        targetHash160: this.targetHash160,
        targetAddress: this.targetAddress,
        startKey: block.start.toString(16),
        endKey: block.end.toString(16),
        batchSize: this.batchSize,
        workerIndex: idx,
        lanes: 4,
        windowKeys: 262144,
        searchMode: window._wl?.searchMode || "random",
        pipeB: 2048,
        blockKeys: blockKeyCount.toString()
      })
    } else {
      const count = this.batchSize
      worker.postMessage({
        type: "start",
        targetHash160: this.targetHash160,
        targetAddress: this.targetAddress,
        startKey: this.nextKey.toString(16).padStart(64, "0"),
        endKey: (this.nextKey + BigInt(count) - 1n).toString(16).padStart(64, "0"),
        batchSize: count,
        workerIndex: this.workers.indexOf(worker),
        lanes: 4,
        windowKeys: 262144,
        searchMode: window._wl?.searchMode || "random",
        pipeB: 2048,
        blockKeys: String(count)
      })
      this.nextKey += BigInt(count)
    }
  }

  /* ------------------------------------------------------------------ */
  /* Worker Message Handling                                               */
  /* ------------------------------------------------------------------ */

  handleWorkerMessage(worker, data) {
    if (!this.running) return

    switch (data.type) {
      case "idle":
        this.assignRange(worker)
        break

      case "found":
        if (data.key) this.onFound(data.key)
        return

      case "done":
        this.totalKeys += BigInt(data.count || 0)
        if (data.elapsed) {
          this.tuneBatchSize(data.count, data.elapsed)
        }
        if (this.blockTracker) {
          const idx = this.workers.indexOf(worker)
          const block = this.workerBlocks[idx]
          if (block) {
            this.blockTracker.markDone(block.start, block.end)
          }
        }
        this.assignRange(worker)
        break

      case "progress":
        this.totalKeys += BigInt(data.count || 0)
        if (data.currentKey) {
          this._liveKeysBuffer.push({ key: data.currentKey })
          if (this._liveKeysBuffer.length > 50) this._liveKeysBuffer.shift()
          if (window.WbloteryUI?.renderLiveKeys) {
            window.WbloteryUI.renderLiveKeys(this._liveKeysBuffer)
          }
        }
        break

      case "error":
        this.log("error", this.t("log.wasm_error", { message: data.message }))
        this.stop()
        break
    }
  }

  tuneBatchSize(count, elapsed) {
    if (elapsed <= 0) return
    const ideal = count * (TARGET_BATCH_MS / elapsed)
    const next = this.batchSize + BATCH_ADJUST_RATE * (ideal - this.batchSize)
    this.batchSize = Math.min(MAX_BATCH, Math.max(MIN_BATCH, Math.round(next)))
  }

  /* ------------------------------------------------------------------ */
  /* Key Find                                                             */
  /* ------------------------------------------------------------------ */

  onFound(keyHex) {
    this.running = false
    this.gpuSearchActive = false
    this.teardownWorkers()
    this.stopStatsTimer()
    this.stopBlockSaveTimer()
    this.stopLiveKeysTimer()

    if (window.WebGPU_Turbo && typeof window.WebGPU_Turbo.stop === "function") {
      try { window.WebGPU_Turbo.stop() } catch {}
    }

    if (window.WbloterySync?.stopSync) {
      window.WbloterySync.stopSync()
    }

    if (window.WbloteryUI?.setEngineState) {
      window.WbloteryUI.setEngineState("ready")
    }

    let address
    try {
      address = window.generateAddress(keyHex)
    } catch (e) {
      this.log("error", "Erro ao verificar chave: " + e.message)
      return
    }

    if (!address) {
      this.log("error", "Não foi possível gerar o endereço para a chave encontrada.")
      return
    }

    if (this.targetAddress && address !== this.targetAddress) {
      this.log("warn", "Falso positivo descartado — chave " + keyHex.substring(0, 16) + "...")
      return
    }

    this.log("success", "ENCONTRADO! Chave privada: " + keyHex)
    this.log("success", "Endereço: " + address)

    this.currentKeyTarget.textContent = keyHex

    try {
      const allF = window.generateAllFormats(keyHex)
      if (allF) {
        this.log("success", "WIF (comprimido): " + allF.wifC)
        this.log("success", "WIF (descomprimido): " + allF.wifU)
        this.log("success", "P2SH-Segwit: " + allF.p2sh)
        this.log("success", "Bech32: " + allF.bech32)
        this.log("success", "Hash160: " + allF.h160)
      }
    } catch {}

    if (window.WbloterySync?.saveFoundKey) {
      window.WbloterySync.saveFoundKey(this._currentPuzzleId, address, keyHex)
    }
    if (window.WbloterySync?.syncToServer) {
      window.WbloterySync.syncToServer(keyHex)
    }
    if (window.WbloteryUI?.displayFoundKeys) {
      window.WbloteryUI.displayFoundKeys()
    }

    const record = document.createElement("div")
    record.className = "panel__section wl-found__record"
    record.append(
      this.foundPair("Chave Privada", keyHex),
      this.foundPair("Endereço", address)
    )
    this.foundBodyTarget.appendChild(record)
    this.foundCardTarget.classList.remove("hidden")

    // Also populate floating found panel (ui.js listens for clicks on it)
    const fpKey = document.getElementById('found-panel-key')
    const fpAddr = document.getElementById('found-panel-addr')
    const fpPanel = document.getElementById('found-panel')
    if (fpKey) fpKey.textContent = keyHex
    if (fpAddr) fpAddr.textContent = address
    if (fpPanel) fpPanel.classList.remove('hidden')

    if (window.WbloteryUI?.setEngineState) {
      window.WbloteryUI.setEngineState("found")
    }
    if (window.WbloteryUI?._showMatchOverlay) {
      window.WbloteryUI._showMatchOverlay(keyHex, address, '')
    }
    if (window.WbloteryUI?._playMatchSound) {
      window.WbloteryUI._playMatchSound()
    }
    if (window.WbloteryUI?.spawnConfetti) {
      window.WbloteryUI.spawnConfetti()
    }
  }

  foundPair(labelText, value) {
    const pair = document.createElement("div")
    const label = document.createElement("span")
    label.className = "label"
    label.textContent = labelText
    const code = document.createElement("code")
    code.className = "mono wl-found__value"
    code.textContent = value
    pair.append(label, code)
    return pair
  }

  /* ------------------------------------------------------------------ */
  /* Stats Timer                                                          */
  /* ------------------------------------------------------------------ */

  startStatsTimer() {
    this.stopStatsTimer()
    this.statsTimer = setInterval(() => this.updateStats(), STATS_INTERVAL_MS)
  }

  stopStatsTimer() {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
  }

  updateStats({ sampleSpeed = true } = {}) {
    const now = performance.now()
    const seconds = (now - this.lastSample.at) / 1000

    if (sampleSpeed && seconds > 0) {
      const sampleSpeed = Number(this.totalKeys - this.lastSample.keys) / seconds
      this.smoothedSpeed = this.smoothedSpeed === 0
        ? sampleSpeed
        : this.smoothedSpeed + SPEED_SMOOTHING * (sampleSpeed - this.smoothedSpeed)
      this.lastSample = { at: now, keys: this.totalKeys }

      this._speedAvg.push(sampleSpeed)
      if (this._speedAvg.length > 5) this._speedAvg.shift()
    }

    if (this.hasSpeedTarget) {
      this.speedTarget.textContent = Math.round(this.smoothedSpeed).toLocaleString(this.locale)
    }
    if (this.hasTotalCheckedTarget) {
      this.totalCheckedTarget.textContent = this.totalKeys.toLocaleString(this.locale)
    }
    if (this.hasCurrentKeyTarget) {
      this.currentKeyTarget.textContent = this.nextKey.toString(16).padStart(64, "0")
    }

    if (this.blockTracker) {
      const pct = this.blockTracker.getPctDone()
      const pfEl = this.element.querySelector("#progress-fill")
      if (pfEl) pfEl.style.width = pct + "%"
      const ppEl = this.element.querySelector("#progress-pct")
      if (ppEl) ppEl.textContent = pct.toFixed(2) + "%"
    }

    const nowSync = Date.now()
    if (nowSync - this._lastSpeedSync > 30000 && this._currentPuzzleId) {
      this._lastSpeedSync = nowSync
      if (window.WbloterySync?.syncSpeedToServer) {
        const elapsed = (now - this.startTime) / 1000
        const cpuS = elapsed > 0 ? Number(this.totalKeys) / elapsed : 0
        window.WbloterySync.syncSpeedToServer(this._currentPuzzleId, 0, cpuS, Number(this.totalKeys))
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Block Save Timer                                                     */
  /* ------------------------------------------------------------------ */

  startBlockSaveTimer() {
    this.stopBlockSaveTimer()
    this._blockSaveTimer = setInterval(() => {
      if (this.blockTracker && this.running) {
        try { this.blockTracker.save() } catch {}
      }
    }, 30000)
  }

  stopBlockSaveTimer() {
    if (this._blockSaveTimer) clearInterval(this._blockSaveTimer)
    this._blockSaveTimer = null
  }

  /* ------------------------------------------------------------------ */
  /* Live Keys Timer                                                      */
  /* ------------------------------------------------------------------ */

  stopLiveKeysTimer() {
    if (this._liveKeysTimer) {
      clearTimeout(this._liveKeysTimer)
      this._liveKeysTimer = null
    }
  }

  /* ------------------------------------------------------------------ */
  /* WebGPU Integration                                                   */
  /* ------------------------------------------------------------------ */

  _tryStartWebGPU(targetHash160, rangeStart) {
    if (!this.running) return
    if (this.smallRange) return

    // Check if WebGPU is available via GPUManager or legacy WebGPU_Turbo
    const hasWebGPU = (window.GPUManager && GPUManager.getBackend() === 'webgpu') ||
                      (typeof window.WebGPU_Turbo !== 'undefined' && window.gpuAvailable)
    if (!hasWebGPU) return

    const self = this
    const gpu = window.WebGPU_Turbo
    if (!gpu) return

    // Ensure WebGPU_Turbo has its own device+pipeline initialized
    async function _startGPU() {
      if (!gpu.isAvailable()) {
        self.log("info", "Inicializando pipeline WebGPU...")
        const sharedMod = window._wl ? window._wl._sharedWasmModule : null
        const ok = await gpu.init(sharedMod)
        if (!ok) { self.log("warn", "WebGPU init falhou"); return }
        const setupOk = await gpu.setup()
        if (!setupOk) { self.log("warn", "WebGPU setup falhou"); return }
      }

      self.gpuSearchActive = true
      self.log("info", "Turbo WebGPU ativado! Backend: " + (window.GPUManager ? GPUManager.getLabel() : 'WebGPU'))

      const progressCb = (p) => {
        if (!self.running) return
        self.totalKeys += BigInt(p.count)
      }

      const foundCb = (keyHex) => {
        if (self.running) self.onFound(keyHex)
      }

      gpu.searchLoop(
        targetHash160,
        rangeStart,
        rangeStart + BLOCK_SIZE * 500n,
        progressCb,
        foundCb
      ).then(function (result) {
        self.gpuSearchActive = false
        if (self.running) {
          self.log("info", "GPU search concluido: " + result.totalChecked.toLocaleString() + " chaves.")
        }
      }).catch(function (e) {
        self.gpuSearchActive = false
        self.log("warn", "GPU search erro: " + e.message)
        if (self.running && window.gpuAvailable) {
          self.log("info", "Tentando recuperar GPU em 2s...")
          setTimeout(function () {
            if (!self.running) return
            try { gpu.recover() } catch {}
            self.gpuSearchActive = true
            gpu.searchLoop(targetHash160, rangeStart, rangeStart + BLOCK_SIZE * 500n, progressCb, foundCb)
              .catch(function () { self.gpuSearchActive = false })
          }, 2000)
        }
      })
    }

    _startGPU()
  }

  /* ------------------------------------------------------------------ */
  /* Console logging                                                      */
  /* ------------------------------------------------------------------ */

  log(level, message) {
    const entry = document.createElement("div")
    entry.className = `wl-console__entry wl-console__entry--${level}`

    const time = document.createElement("span")
    time.className = "wl-console__time mono"
    time.textContent = new Date().toLocaleTimeString(this.locale)

    const body = document.createElement("span")
    body.className = "wl-console__message"
    body.textContent = message

    entry.append(time, body)

    if (this.hasConsoleEmptyTarget) this.consoleEmptyTarget.classList.add("hidden")
    this.consoleTarget.appendChild(entry)
    this.consoleTarget.scrollTop = this.consoleTarget.scrollHeight
  }

  clearConsole() {
    this.consoleTarget.querySelectorAll(".wl-console__entry").forEach(entry => entry.remove())
    if (this.hasConsoleEmptyTarget) this.consoleEmptyTarget.classList.remove("hidden")
  }

  /* ------------------------------------------------------------------ */
  /* Utilities                                                            */
  /* ------------------------------------------------------------------ */
  /* GPU Backend Selector                                                */
  /* ------------------------------------------------------------------ */

  selectGpu(event) {
    const btn = event.currentTarget
    const backend = btn.dataset.gpu
    if (!backend) return

    this.element.querySelectorAll("[data-gpu]").forEach(b => b.classList.remove("is-active"))
    btn.classList.add("is-active")

    this.selectedGpuBackend = backend
    try { localStorage.setItem('webloteria.gpuBackend', backend) } catch (e) {}

    // Re-init GPU manager with new backend
    this._initGPUManager()
  }

  /* ------------------------------------------------------------------ */
  /* Utilities                                                            */
  /* ------------------------------------------------------------------ */

  randomBigInt(max) {
    if (max <= 0n) return 0n
    const hex = max.toString(16)
    const byteCount = Math.ceil(hex.length / 2)
    const bytes = new Uint8Array(byteCount)
    let result
    do {
      crypto.getRandomValues(bytes)
      result = bytes.reduce((acc, b) => (acc << 8n) + BigInt(b), 0n)
    } while (result >= max)
    return result
  }

  _repositionSearch(pct) {
    if (!this.running) return
    const bt = this.blockTracker
    const rangeStart = bt ? bt.rangeStart : this.startBigKey
    const rangeEnd = bt ? bt.rangeEnd : this.startBigKey + BLOCK_SIZE * 500n
    const range = rangeEnd - rangeStart
    const pctScaled = BigInt(Math.floor(pct * 1e8))
    const offset = range * pctScaled / (100n * 100000000n)
    const newKey = rangeStart + offset
    this.nextKey = newKey
    if (bt) {
      bt.trimFrom(newKey)
    }
    this.teardownWorkers()
    const workerCount = this.selectedWorkerCount()
    this.spawnWorkers(workerCount)
    this.log('info', 'Reposicionado para ' + pct.toFixed(4) + '% do intervalo')
  }
}
