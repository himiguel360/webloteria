/* =====================================================================
   ui.js — UI helper functions extracted from the monolithic index.html
   =====================================================================
   All functions are exported via window.WbloteryUI.
   Globals consumed from other modules:
     currentWallet, currentSel, rangeStart, rangeEnd, running,
     stopAll(), start(), generateAddress(), addressToHash160(),
     getWorkerUrl(), _sharedWasmModule, WebGPU_Turbo,
     log(), logOk(), logErr(), logWarn()
   =================================================================== */

/* ------------------------------------------------------------------ */
/*  DOM shorthands                                                     */
/* ------------------------------------------------------------------ */

function $_(id) { return document.getElementById(id); }
function $show(id) { var el = $_(id); if (el) el.style.display = ''; }
function $hide(id) { var el = $_(id); if (el) el.style.display = 'none'; }
function $text(id, v) { var el = $_(id); if (el) el.textContent = v; }
function $width(id, v) { var el = $_(id); if (el) el.style.width = v; }

/* ------------------------------------------------------------------ */
/*  Historical positions (markers on progress bar)                     */
/* ------------------------------------------------------------------ */

var HISTORICAL_POSITIONS = [
    { pct: 0.72, puzzle: '#69' },
    { pct: 8.56, puzzle: '#50' },
    { pct: 10.74, puzzle: '#54' },
    { pct: 22.73, puzzle: '#56' },
    { pct: 25.62, puzzle: '#66' },
    { pct: 35.86, puzzle: '#48' },
    { pct: 45.35, puzzle: '#49' },
    { pct: 49.01, puzzle: '#68' },
    { pct: 50.18, puzzle: '#53' },
    { pct: 64.40, puzzle: '#70' },
    { pct: 70.06, puzzle: '#47' },
    { pct: 79.78, puzzle: '#67' },
    { pct: 82.17, puzzle: '#59' },
    { pct: 82.86, puzzle: '#51' },
    { pct: 87.25, puzzle: '#52' },
    { pct: 91.85, puzzle: '#57' },
    { pct: 92.98, puzzle: '#64' },
    { pct: 95.01, puzzle: '#63' },
    { pct: 96.90, puzzle: '#60' }
];

var CONSOLE_LEVELS = { info: 'info', warn: 'warn', error: 'error', success: 'success' };

/* ------------------------------------------------------------------ */
/*  Format helpers                                                     */
/* ------------------------------------------------------------------ */

function fmtElapsed(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    var h = Math.floor(m / 60);
    m = m % 60;
    s = s % 60;
    return (h > 0 ? h + 'h ' : '') + (m > 0 ? m + 'm ' : '') + s + 's';
}

function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

function fmtPctGlobal(pctStr) {
    var v = parseFloat(pctStr);
    if (isNaN(v)) return '0%';
    if (v === 0) return '0%';
    if (v < 0.0001) return v.toExponential(4) + '%';
    var s = String(pctStr);
    var dot = s.indexOf('.');
    if (dot >= 0) {
        var trimmed = s.replace(/0+$/, '').replace(/\.$/, '');
        return trimmed + '%';
    }
    return v + '%';
}

/* ------------------------------------------------------------------ */
/*  Match overlay + sound + confetti                                   */
/* ------------------------------------------------------------------ */

function _playMatchSound() {
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        [440, 554, 659].forEach(function(freq, i) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.5, ctx.currentTime + i * 0.18);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.5);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + i * 0.18);
            osc.stop(ctx.currentTime + i * 0.18 + 0.5);
        });
    } catch(e) {}
}

function spawnConfetti() {
    var container = document.createElement('div');
    container.className = 'wl-confetti-container';
    container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10000;overflow:hidden;';
    document.body.appendChild(container);

    var colors = ['#00ff88', '#ff0055', '#ffcc00', '#00aaff', '#ff6600', '#aa00ff'];
    for (var i = 0; i < 50; i++) {
        var p = document.createElement('div');
        var size = 6 + Math.random() * 8;
        var x = Math.random() * 100;
        var dur = 2 + Math.random() * 3;
        var delay = Math.random() * 1.5;
        var color = colors[Math.floor(Math.random() * colors.length)];
        var rotation = Math.random() * 360;
        p.style.cssText =
            'position:absolute;top:-20px;left:' + x + '%;' +
            'width:' + size + 'px;height:' + (size * 0.6) + 'px;' +
            'background:' + color + ';' +
            'border-radius:2px;' +
            'opacity:0.9;' +
            'transform:rotate(' + rotation + 'deg);' +
            'animation:wl-confetti-fall ' + dur + 's ease-in ' + delay + 's forwards;';
        container.appendChild(p);
    }

    if (!document.getElementById('wl-confetti-keyframes')) {
        var style = document.createElement('style');
        style.id = 'wl-confetti-keyframes';
        style.textContent =
            '@keyframes wl-confetti-fall {' +
            '0% { transform: translateY(0) rotate(0deg); opacity:1; }' +
            '100% { transform: translateY(100vh) rotate(720deg); opacity:0; }' +
            '}';
        document.head.appendChild(style);
    }

    setTimeout(function() { container.remove(); }, 5000);
}

function _showMatchOverlay(hexKey, addr, pctStr) {
    var old = document.getElementById('wl-match-overlay');
    if (old) old.remove();
    var allF;
    try { allF = generateAllFormats(hexKey); } catch(e) { allF = null; }
    var extra = '';
    if (allF) {
        extra =
            '<div class="wl-match-overlay__label">WIF Comprimido:</div>' +
            '<div class="wl-match-overlay__key">' + allF.wifC + '</div>' +
            '<div class="wl-match-overlay__label">WIF Descomprimido:</div>' +
            '<div class="wl-match-overlay__key">' + allF.wifU + '</div>' +
            '<div class="wl-match-overlay__label">P2SH-Segwit:</div>' +
            '<div class="wl-match-overlay__key">' + allF.p2sh + '</div>' +
            '<div class="wl-match-overlay__label">Bech32:</div>' +
            '<div class="wl-match-overlay__key">' + allF.bech32 + '</div>' +
            '<div class="wl-match-overlay__label">Hash160:</div>' +
            '<div class="wl-match-overlay__key">' + allF.h160 + '</div>';
    }
    var overlay = document.createElement('div');
    overlay.id = 'wl-match-overlay';
    overlay.className = 'wl-match-overlay';
    overlay.innerHTML =
        '<div class="wl-match-overlay__card">' +
        '<div class="wl-match-overlay__icon">\u2714</div>' +
        '<div class="wl-match-overlay__title">CHAVE ENCONTRADA!</div>' +
        '<div class="wl-match-overlay__pct">Posi\u00e7\u00e3o: ' + pctStr + '%</div>' +
        '<div class="wl-match-overlay__label">Chave Privada (hex):</div>' +
        '<div class="wl-match-overlay__key">' + hexKey + '</div>' +
        '<div class="wl-match-overlay__label">Endere\u00e7o (P2PKH):</div>' +
        '<div class="wl-match-overlay__addr">' + addr + '</div>' +
        extra +
        '<div class="wl-match-overlay__hint">Salvando automaticamente...</div>' +
        '</div>';
    overlay.addEventListener('click', function() { overlay.remove(); });
    document.body.appendChild(overlay);
    spawnConfetti();
    setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 30000);
}

/* ------------------------------------------------------------------ */
/*  Live keys display                                                  */
/* ------------------------------------------------------------------ */

function renderLiveKeys(buffer) {
    var list = document.getElementById('livekeys-list');
    var counter = document.getElementById('livekeys-count');
    if (!list || !counter) return;
    list.innerHTML = '';
    var items = buffer || [];
    var len = items.length;
    counter.textContent = len;
    for (var i = len - 1; i >= 0; i--) {
        var item = items[i];
        var div = document.createElement('div');
        div.className = 'wl-livekeys__item';
        div.innerHTML = '<span class="key">' + item.key + '</span>';
        list.appendChild(div);
    }
}

/* ------------------------------------------------------------------ */
/*  Progress bar — markers + draggable thumb                           */
/* ------------------------------------------------------------------ */

function renderProgressMarkers() {
    var markers = document.getElementById('progress-markers');
    var legend = document.getElementById('progress-legend');
    if (!markers || !legend) return;
    markers.innerHTML = '';
    legend.innerHTML = '';

    var major = [0, 25, 50, 75, 100];
    major.forEach(function(pct) {
        var d = document.createElement('div');
        d.className = 'wl-progress__marker wl-progress__marker--major';
        d.style.left = pct + '%';
        d.setAttribute('data-tip', pct + '%');
        markers.appendChild(d);
    });

    HISTORICAL_POSITIONS.forEach(function(h) {
        var d = document.createElement('div');
        d.className = 'wl-progress__marker';
        d.style.left = h.pct + '%';
        d.setAttribute('data-tip', 'Resolvido ' + h.puzzle + ' @ ' + h.pct + '%');
        markers.appendChild(d);
    });

    legend.innerHTML = '<span class="major">Marcas a cada 25%</span> <span>Posi\u00e7\u00f5es hist\u00f3ricas de puzzles resolvidos</span>';
}

function initProgressThumb() {
    var thumb = document.getElementById('progress-thumb');
    var track = document.getElementById('progress-track');
    if (!thumb || !track) return;

    var _thumbDragging = false;
    var tooltip = document.createElement('div');
    tooltip.className = 'wl-progress__thumb-tooltip';
    tooltip.style.display = 'none';
    thumb.appendChild(tooltip);

    function getPctFromEvent(e) {
        var rect = track.getBoundingClientRect();
        var clientX = e.touches ? e.touches[0].clientX : e.clientX;
        var pct = ((clientX - rect.left) / rect.width) * 100;
        return Math.max(0, Math.min(100, pct));
    }

    function onDragStart(e) {
        if (!running || _smallRange) return;
        e.preventDefault();
        e.stopPropagation();
        _thumbDragging = true;
        thumb.classList.add('wl-progress__thumb--dragging');
        log('Reposicionamento iniciado \u2014 arraste o ponteiro e solte para buscar da nova posi\u00e7\u00e3o.');
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
        document.addEventListener('touchmove', onDragMove, {passive: false});
        document.addEventListener('touchend', onDragEnd);
    }

    function onDragMove(e) {
        if (!_thumbDragging) return;
        e.preventDefault();
        var pct = getPctFromEvent(e);
        thumb.style.left = pct + '%';
        $width('progress-fill', pct + '%');
        $text('progress-pct', pct.toFixed(2) + '%');
        tooltip.style.display = '';
        tooltip.textContent = pct.toFixed(4) + '% \u2014 solte para buscar daqui';
    }

    function onDragEnd(e) {
        if (!_thumbDragging) return;
        _thumbDragging = false;
        thumb.classList.remove('wl-progress__thumb--dragging');
        tooltip.style.display = 'none';
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
        document.removeEventListener('touchmove', onDragMove);
        document.removeEventListener('touchend', onDragEnd);

        var pct = (e.changedTouches) ? getPctFromEvent(e.changedTouches[0]) : getPctFromEvent(e);
        repositionSearch(pct);
    }

    thumb.addEventListener('mousedown', onDragStart);
    thumb.addEventListener('touchstart', onDragStart, {passive: false});
}

function initProgressBar() {
    renderProgressMarkers();
    initProgressThumb();
}

/* ------------------------------------------------------------------ */
/*  Percentage slider                                                  */
/* ------------------------------------------------------------------ */

function pctToKey(pctStr) {
    if (rangeStart === undefined || rangeEnd === undefined || rangeEnd <= rangeStart) return null;
    var rangeSize = rangeEnd - rangeStart;
    var s = String(pctStr).trim();
    if (!s || s === '0' || s === '0.') return rangeStart;
    var parts = s.split('.');
    var whole = parts[0] || '0';
    var frac = (parts[1] || '').replace(/[^0-9]/g, '');
    var fracLen = Math.min(frac.length, 68);
    while (frac.length < 68) frac += '0';
    fracLen = 68;
    frac = frac.substring(0, fracLen);
    while (frac.length < fracLen) frac += '0';
    var scale = 10n ** BigInt(fracLen || 1);
    var wholeB = BigInt(whole) || 0n;
    var fracB = fracLen > 0 ? BigInt(frac) : 0n;
    var num = wholeB * scale + fracB;
    var denom = 100n * scale;
    return rangeStart + (num * rangeSize + denom / 2n) / denom;
}

var _verifyPending = null;
var _verifyLatestKey = null;

function verifyKeyAtPct(pctStr, stopOnMatch) {
    var pctVerify = document.getElementById('pct-verify');
    if (!pctVerify) return;
    var key = pctToKey(pctStr);
    if (key === null) return;
    var hexKey = key.toString(16).padStart(64, '0');
    var pctHex = document.getElementById('pct-hex');
    if (pctHex) pctHex.innerHTML = renderKeyFormats(hexKey);
    pctVerify.className = 'wl-pct-verify is-checking';
    pctVerify.textContent = '\u2026';
    _verifyLatestKey = hexKey;
    if (_verifyPending) return;
    _verifyPending = setTimeout(function() {
        _verifyPending = null;
        var hk = _verifyLatestKey;
        if (!hk) return;
        try {
            var addr = generateAddress(hk);
            if (hk !== _verifyLatestKey) return;
            if (currentWallet && currentWallet.address) {
                var h160 = addressToHash160(currentWallet.address);
                var myH160 = addressToHash160(addr);
                if (h160 && myH160 && h160 === myH160) {
                    pctVerify.className = 'wl-pct-verify is-match';
                    pctVerify.innerHTML = '\u2713 ' + addr + '<br>' + renderKeyFormats(hk, currentWallet.address);
                    _playMatchSound();
                    _showMatchOverlay(hk, addr, pctStr);
                    running = true;
                    handleFound(hk);
                } else {
                    pctVerify.className = 'wl-pct-verify';
                    pctVerify.innerHTML = '\u2192 ' + addr + '<br>' + renderKeyFormats(hk);
                }
            } else {
                pctVerify.className = 'wl-pct-verify';
                pctVerify.innerHTML = '\u2192 ' + addr + '<br>' + renderKeyFormats(hk);
            }
        } catch (e) {
            if (hk !== _verifyLatestKey) return;
            pctVerify.className = 'wl-pct-verify is-error';
            pctVerify.textContent = '\u2717 ' + e.message;
        }
    }, 0);
}

function verifyKeyHex(hexKey) {
    var pctVerify = document.getElementById('pct-verify');
    if (!pctVerify) return;
    var hk = hexKey.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    if (hk.length !== 64) {
        pctVerify.className = 'wl-pct-verify is-error';
        pctVerify.textContent = '\u2717 Chave deve ter 64 caracteres hex';
        return;
    }
    var exactPct = keyToPct(hk);
    pctVerify.className = 'wl-pct-verify is-checking';
    pctVerify.textContent = (exactPct ? 'Posi\u00e7\u00e3o exata: ' + exactPct + ' \u2014 ' : '') + '\u2026';
    setTimeout(function() {
        try {
            var addr = generateAddress(hk);
            if (currentWallet && currentWallet.address) {
                var h160 = addressToHash160(currentWallet.address);
                var myH160 = addressToHash160(addr);
                if (h160 && myH160 && h160 === myH160) {
                    pctVerify.className = 'wl-pct-verify is-match';
                    pctVerify.innerHTML = '\u2713 ' + addr + (exactPct ? ' (' + exactPct + ')' : '') + '<br>' + renderKeyFormats(hk, currentWallet.address);
                    _playMatchSound();
                    _showMatchOverlay(hk, addr, exactPct || 'hex');
                    running = true;
                    handleFound(hk);
                } else {
                    pctVerify.className = 'wl-pct-verify';
                    pctVerify.innerHTML = '\u2192 ' + addr + (exactPct ? ' (' + exactPct + ')' : '') + '<br>' + renderKeyFormats(hk);
                }
            } else {
                pctVerify.className = 'wl-pct-verify';
                pctVerify.innerHTML = '\u2192 ' + addr + (exactPct ? ' (' + exactPct + ')' : '') + '<br>' + renderKeyFormats(hk);
            }
        } catch (e) {
            pctVerify.className = 'wl-pct-verify is-error';
            pctVerify.textContent = '\u2717 ' + e.message;
        }
    }, 0);
}

function keyToPct(hexKey) {
    if (rangeStart === undefined || rangeEnd === undefined) return null;
    try {
        var key = BigInt('0x' + hexKey);
        if (key < rangeStart || key > rangeEnd) return null;
        return _keyToPctFull(key) + '%';
    } catch(e) { return null; }
}

function _keyToPct(keyBigInt) {
    if (rangeStart === undefined || rangeEnd === undefined || rangeEnd <= rangeStart) return 0;
    var rangeSize = rangeEnd - rangeStart;
    var offset = keyBigInt - rangeStart;
    return Number(offset * 1000000n / rangeSize) / 10000;
}

function _keyToPctFull(keyBigInt) {
    if (rangeStart === undefined || rangeEnd === undefined || rangeEnd <= rangeStart) return '0';
    var rangeSize = rangeEnd - rangeStart;
    var offset = keyBigInt - rangeStart;
    var SCALE = 10n ** 68n;
    var whole = offset * 100n * SCALE / rangeSize;
    var s = whole.toString();
    if (s.length <= 68) {
        s = s.padStart(69, '0');
        var result = s.substring(0, s.length - 68) + '.' + s.substring(s.length - 68);
        return result.replace(/0+$/, '').replace(/\.$/, '');
    }
    var intPart = s.substring(0, s.length - 68);
    var fracPart = s.substring(s.length - 68).replace(/0+$/, '');
    return intPart + (fracPart ? '.' + fracPart : '');
}

function _randomPctVariado() {
    var whole = Math.floor(Math.random() * 100);
    var r = Math.random();
    if (r < 0.1) return String(whole) + '.' + Math.floor(Math.random() * 10);
    if (r < 0.25) return String(whole) + '.' + String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    var decimals = 10 + Math.floor(Math.random() * 20);
    var frac = String(Math.floor(Math.random() * Math.pow(10, decimals))).padStart(decimals, '0');
    return String(whole) + '.' + frac;
}

function initSliderListeners() {
    var slider = document.getElementById('pct-slider');
    var pctVal = document.getElementById('pct-val');
    var pctHex = document.getElementById('pct-hex');
    var pctInput = document.getElementById('pct-input');
    if (!slider) return;

    function fmtPct(pctStr) {
        var v = parseFloat(pctStr);
        if (isNaN(v)) return '0%';
        if (v === 0) return '0%';
        if (v < 0.0001) return v.toExponential(4) + '%';
        if (Math.abs(v - Math.round(v)) < 1e-9) return Math.round(v) + '%';
        var s = v.toString();
        var dec = s.indexOf('.');
        if (dec < 0) return s + '%';
        var trimmed = s.replace(/0+$/, '').replace(/\.$/, '');
        return trimmed + '%';
    }

    function updateSliderFast() {
        var pctStr = slider.value;
        startPct = parseFloat(pctStr);
        pctVal.textContent = fmtPct(pctStr);
        var key = pctToKey(pctStr);
        if (key !== null) {
            var exactPct = _keyToPctFull(key);
            if (pctInput) pctInput.value = exactPct;
            if (pctHex) pctHex.innerHTML = renderKeyFormats(key.toString(16).padStart(64, '0'));
        }
        if (typeof updateLupaNibbles === 'function') updateLupaNibbles();
        verifyKeyAtPct(pctStr, true);
    }

    function updateSliderFull() {
        var pctStr = slider.value;
        startPct = parseFloat(pctStr);
        pctVal.textContent = fmtPct(pctStr);
        var key = pctToKey(pctStr);
        if (key !== null) {
            var exactPct = _keyToPctFull(key);
            if (pctInput) pctInput.value = exactPct;
            if (pctHex) pctHex.innerHTML = renderKeyFormats(key.toString(16).padStart(64, '0'));
        }
        verifyKeyAtPct(pctStr, false);
        if (typeof updateLupa === 'function') updateLupa();
    }

    slider.addEventListener('input', function() { updateSliderFast(); });
    slider.addEventListener('change', function() { updateSliderFull(); });

    if (pctInput) {
        pctInput.addEventListener('input', function() {
            var v = pctInput.value.trim();
            var n = parseFloat(v);
            if (!isNaN(n) && n >= 0 && n <= 100) {
                slider.value = Math.min(Math.max(n, 0), 100);
                startPct = n;
                pctVal.textContent = fmtPct(v);
                verifyKeyAtPct(v);
                if (typeof updateLupa === 'function') updateLupa();
            }
        });
        pctInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var v = pctInput.value.trim();
                var n = parseFloat(v);
                if (!isNaN(n) && n >= 0 && n <= 100) {
                    slider.value = Math.min(Math.max(n, 0), 100);
                    startPct = n;
                    pctVal.textContent = fmtPct(v);
                    verifyKeyAtPct(v);
                    if (typeof updateLupa === 'function') updateLupa();
                }
            }
        });
    }

    var hexKeyInput = document.getElementById('hex-key-input');
    var hexKeyBtn = document.getElementById('hex-key-verify');
    if (hexKeyInput) {
        hexKeyInput.addEventListener('input', function() {
            var v = hexKeyInput.value.trim();
            if (v.length > 0 && /^[0-9a-fA-F]+$/.test(v) && v.length <= 64) {
                var padded = v.padStart(64, '0');
                verifyKeyHex(padded);
            }
        });
        hexKeyInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var v = hexKeyInput.value.trim();
                if (v.length > 0 && /^[0-9a-fA-F]+$/.test(v)) {
                    verifyKeyHex(v.padStart(64, '0'));
                }
            }
        });
    }
    if (hexKeyBtn) {
        hexKeyBtn.addEventListener('click', function() {
            var v = hexKeyInput ? hexKeyInput.value.trim() : '';
            if (v.length > 0 && /^[0-9a-fA-F]+$/.test(v)) {
                verifyKeyHex(v.padStart(64, '0'));
            }
        });
    }

    var searchFromHereBtn = document.getElementById('search-from-here');
    if (searchFromHereBtn) {
        searchFromHereBtn.addEventListener('click', function() {
            if (running) stopAll();
            var pctEl = document.getElementById('pct-input');
            var pct = pctEl ? parseFloat(pctEl.value) : 0;
            if (isNaN(pct) || pct < 0) pct = 0;
            startPct = pct;
            setTimeout(function() { start(); }, 100);
        });
    }

    var _autoScanRandom = false;
    var _randomScanBaseKey = null;
    var _randomScanIndex = 0;
    var _randomWindowSize = 1000;
    var _autoScanTargetH160 = null;
    var _autoScanTimer = null;
    var _randomExataTicksLeft = 0;
    var _randomExataStart = 0;
    var _randomJumpTimer = null;
    var _randomJumpActive = false;
    var autoScanBtn = document.getElementById('auto-scan-btn');
    var autoScanSpeed = document.getElementById('auto-scan-speed');
    var autoScanRandomBtn = document.getElementById('auto-scan-random');

    function _autoScanStep() {
        if (!_autoScanTimer) return;
        var val = autoScanSpeed ? autoScanSpeed.value : '1';
        if (_autoScanRandom) {
            if (!currentWallet) return;
            if (_randomScanBaseKey === null || _randomScanIndex >= _randomWindowSize) {
                var roll = Math.random();
                var curPct = parseFloat(slider.value) || 50;
                var newPct;
                var tipo;
                if (roll < 0.25) {
                    var offset = (Math.random() - 0.5) * 0.002;
                    newPct = Math.max(0, Math.min(99.99, curPct + offset));
                    tipo = 'curta';
                    _randomWindowSize = 100;
                } else if (roll < 0.50) {
                    var offset = (Math.random() - 0.5) * 2;
                    newPct = Math.max(0, Math.min(99.99, curPct + offset));
                    tipo = 'larga';
                    _randomWindowSize = 500;
                } else if (roll < 0.75) {
                    newPct = Math.random() * 100;
                    tipo = 'comprida';
                    _randomWindowSize = 1000;
                } else {
                    newPct = parseFloat(slider.value) || Math.random() * 100;
                    tipo = 'exata';
                    _randomWindowSize = 200;
                }
                _randomScanBaseKey = pctToKey(String(newPct));
                _randomScanIndex = 0;
                if (_randomScanBaseKey) {
                    var _pvEl = document.getElementById('pct-verify');
                    if (_pvEl) { _pvEl.textContent = '\uD83C\uDFB2 ' + tipo + ': ' + _keyToPctFull(_randomScanBaseKey); _pvEl.style.color = 'var(--accent)'; }
                }
            }
            if (_randomScanBaseKey === null) return;
            var curKey = _randomScanBaseKey + BigInt(_randomScanIndex);
            if (curKey > currentWallet.range[1]) {
                _randomScanBaseKey = pctToKey(String(Math.random() * 100));
                _randomScanIndex = 0;
                if (_randomScanBaseKey === null) return;
                curKey = _randomScanBaseKey;
                var _pvEl2 = document.getElementById('pct-verify');
                if (_pvEl2) { _pvEl2.textContent = '\uD83C\uDFB2 Reset: ' + _keyToPctFull(_randomScanBaseKey); _pvEl2.style.color = 'var(--accent)'; }
            }
            var r = currentWallet.range[1] - currentWallet.range[0];
            var pct = Number((curKey - currentWallet.range[0]) * 1000000n / r) / 10000;
            slider.value = Math.min(Math.max(pct, 0), 100);
            pctVal.textContent = fmtPct(String(pct));
            if (pctHex) pctHex.innerHTML = renderKeyFormats(curKey.toString(16).padStart(64, '0'));
            if (pctInput) pctInput.value = _keyToPctFull(curKey);

            var hk = generateAddress(curKey.toString(16).padStart(64, '0'));
            var pctVerifyEl = document.getElementById('pct-verify');
            if (hk && hk === _autoScanTargetH160) {
                if (pctVerifyEl) { pctVerifyEl.innerHTML = '\u2705 MATCH! ' + curKey.toString(16) + '<br>' + renderKeyFormats(curKey.toString(16).padStart(64, '0'), currentWallet.address); pctVerifyEl.style.color = '#00ff88'; }
                _playMatchSound(); _showMatchOverlay(curKey.toString(16), currentWallet.address, fmtPctGlobal(String(pct)));
                clearInterval(_autoScanTimer); _autoScanTimer = null;
                if (autoScanBtn) autoScanBtn.textContent = '\u25B6 Scan';
                running = true;
                handleFound(curKey.toString(16));
            } else {
                _randomScanIndex++;
                if (pctVerifyEl) { pctVerifyEl.innerHTML = '\uD83C\uDFB2 ' + _randomScanIndex + '/' + _randomWindowSize + ' \u2014 \u274C<br>' + renderKeyFormats(curKey.toString(16).padStart(64, '0')); pctVerifyEl.style.color = 'var(--ink-400)'; }
            }
            return;
        } else if (val === '1seq') {
            var curKey = pctToKey(slider.value);
            if (curKey !== null && currentWallet) {
                var nextKey = curKey + 1n;
                if (nextKey > currentWallet.range[1]) nextKey = currentWallet.range[0];
                var r = currentWallet.range[1] - currentWallet.range[0];
                var pct = Number((nextKey - currentWallet.range[0]) * 1000000n / r) / 10000;
                slider.value = pct;
            }
        } else {
            var step = parseFloat(val);
            var cur = parseFloat(slider.value);
            var next = cur + step;
            if (next > 100) next = 0;
            slider.value = next;
        }
        updateSliderFull();
    }

    function _autoScanToggle() {
        if (_autoScanTimer) {
            clearInterval(_autoScanTimer);
            _autoScanTimer = null;
            if (autoScanBtn) autoScanBtn.textContent = '\u25B6 Scan';
        } else {
            _randomScanBaseKey = null;
            _randomScanIndex = 0;
            _autoScanTargetH160 = (currentWallet && currentWallet.address) ? addressToHash160(currentWallet.address) : null;
            var val = autoScanSpeed ? autoScanSpeed.value : '1';
            _randomWindowSize = 100;
            var interval;
            if (_autoScanRandom) {
                interval = 50;
            } else if (val === '1seq') {
                interval = 10;
            } else {
                interval = Math.max(50, Math.min(3000, parseFloat(val) * 300));
            }
            _autoScanTimer = setInterval(_autoScanStep, interval);
            if (autoScanBtn) autoScanBtn.textContent = '\u23F8 Parar';
        }
    }

    if (autoScanBtn) autoScanBtn.addEventListener('click', _autoScanToggle);
    if (autoScanRandomBtn) {
        autoScanRandomBtn.addEventListener('click', function() {
            _autoScanRandom = !_autoScanRandom;
            autoScanRandomBtn.style.background = _autoScanRandom ? 'var(--accent)' : '';
            autoScanRandomBtn.style.color = _autoScanRandom ? '#000' : '';
            _randomScanBaseKey = null;
            _randomScanIndex = 0;
            if (_autoScanTimer) {
                clearInterval(_autoScanTimer);
                _autoScanTimer = null;
                if (autoScanBtn) autoScanBtn.textContent = '\u25B6 Scan';
            }
        });
    }

    var randomJumpBtn = document.getElementById('random-jump-btn');

    function _randomJumpTick() {
        if (!running || !currentWallet) return;

        if (_randomExataTicksLeft > 0) {
            _randomExataTicksLeft--;
            var elapsed = Math.round((performance.now() - _randomExataStart) / 1000);
            log('\uD83D\uDD2C Exata: ' + elapsed + 's \u2014 manter posi\u00e7\u00e3o');
            return;
        }

        var roll = Math.random();
        var basePct = Math.random() * 100;
        var newPct;
        var tipo;
        if (roll < 0.25) {
            var offset = (Math.random() - 0.5) * 0.002;
            newPct = Math.max(0, Math.min(99.99, basePct + offset));
            tipo = 'curta';
        } else if (roll < 0.50) {
            var offset = (Math.random() - 0.5) * 2;
            newPct = Math.max(0, Math.min(99.99, basePct + offset));
            tipo = 'larga';
        } else if (roll < 0.75) {
            newPct = Math.random() * 100;
            tipo = 'comprida';
        } else {
            newPct = basePct;
            tipo = 'exata';
            _randomExataTicksLeft = 3;
            _randomExataStart = performance.now();
        }
        repositionSearch(newPct);
        var key = pctToKey(String(newPct));
        var exact = key ? _keyToPctFull(key) : fmtPct(String(newPct));
        var fmtMsg = '';
        if (key) {
            try { var ff = generateAllFormats(key.toString(16).padStart(64,'0')); fmtMsg = ' | ' + ff.wifC + ' | ' + ff.address + ' | ' + ff.bech32; } catch(e) {}
        }
        log('\uD83C\uDFB2 Salto ' + tipo + ' \u2192 ' + fmtPct(String(newPct)) + ' [' + exact + ']' + fmtMsg + (tipo === 'exata' ? ' \u2014 manter 75s' : ''));
    }

    var _randomJumpInterval = 60000;
    var _randomJumpSpeeds = [60000, 10000, 3000, 1000];
    var _randomJumpSpeedIdx = 0;
    var _randomJumpLabels = ['\uD83C\uDFB2 Auto-random (60s)', '\uD83C\uDFB2 Auto-random (10s)', '\u26A1 Turbo (3s)', '\uD83D\uDD25 TURBO (1s)'];

    function _randomJumpRestart() {
        clearInterval(_randomJumpTimer);
        _randomJumpTimer = setInterval(_randomJumpTick, _randomJumpInterval);
    }

    function _randomJumpToggle() {
        if (_randomJumpActive) {
            _randomJumpSpeedIdx = (_randomJumpSpeedIdx + 1) % (_randomJumpSpeeds.length + 1);
            if (_randomJumpSpeedIdx >= _randomJumpSpeeds.length) {
                clearInterval(_randomJumpTimer);
                _randomJumpTimer = null;
                _randomJumpActive = false;
                _randomJumpSpeedIdx = 0;
                if (randomJumpBtn) { randomJumpBtn.textContent = _randomJumpLabels[0]; randomJumpBtn.style.background = ''; randomJumpBtn.style.color = ''; }
                log('\uD83C\uDFB2 Auto-random desativado.');
                return;
            }
            _randomJumpInterval = _randomJumpSpeeds[_randomJumpSpeedIdx];
            _randomJumpRestart();
            if (randomJumpBtn) { randomJumpBtn.textContent = _randomJumpLabels[_randomJumpSpeedIdx] + ' ATIVO'; randomJumpBtn.style.background = 'var(--accent)'; randomJumpBtn.style.color = '#000'; }
            log(_randomJumpSpeedIdx >= 2 ? '\uD83D\uDD25 Turbo mode: salto a cada ' + (_randomJumpInterval / 1000) + 's!' : '\uD83C\uDFB2 Velocidade: ' + (_randomJumpInterval / 1000) + 's');
        } else {
            _randomJumpSpeedIdx = 0;
            _randomJumpInterval = _randomJumpSpeeds[0];
            _randomJumpTimer = setInterval(_randomJumpTick, _randomJumpInterval);
            _randomJumpActive = true;
            if (randomJumpBtn) { randomJumpBtn.textContent = _randomJumpLabels[0] + ' ATIVO'; randomJumpBtn.style.background = 'var(--accent)'; randomJumpBtn.style.color = '#000'; }
            log('\uD83C\uDFB2 Auto-random ativado \u2014 salto a cada 60s');
        }
    }

    if (randomJumpBtn) randomJumpBtn.addEventListener('click', _randomJumpToggle);

    var closeBtn = document.getElementById('found-panel-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            document.getElementById('found-panel').style.display = 'none';
        });
    }
    var copyBtn = document.getElementById('found-panel-copy');
    if (copyBtn) {
        copyBtn.addEventListener('click', function() {
            var keyText = document.getElementById('found-panel-key').textContent;
            if (navigator.clipboard) navigator.clipboard.writeText(keyText);
        });
    }
    var saveBtn = document.getElementById('found-panel-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            var keyText = document.getElementById('found-panel-key').textContent;
            if (keyText && currentWallet) {
                saveFoundKey(currentSel, currentWallet.address, keyText);
                logOk('Chave salva localmente: ' + keyText, CONSOLE_LEVELS.success);
            }
        });
    }

    var hints = {
        'random': 'Chaves completamente aleat\u00f3rias (multi-lane)',
        'sequential': 'Caminhada sequencial do in\u00edcio ao fim',
        'hybrid': 'GPU + CPU simultaneamente (mais r\u00e1pido)'
    };

    document.querySelectorAll('.wl-mode-btn:not(.gpu-count-btn)').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.wl-mode-btn:not(.gpu-count-btn)').forEach(function(b) { b.classList.remove('is-active'); });
            btn.classList.add('is-active');
            var mode = btn.getAttribute('data-mode');
            if (window._wl) window._wl.searchMode = mode;
            var hint = document.getElementById('mode-hint');
            if (hint) hint.textContent = hints[mode] || '';
        });
    });

    document.querySelectorAll('.gpu-count-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.gpu-count-btn').forEach(function(b) { b.classList.remove('is-active'); });
            btn.classList.add('is-active');
            var gpuCount = parseInt(btn.getAttribute('data-gpus') || '1', 10);
            if (window._wl) window._wl.multiGpuCount = gpuCount;
            var gpuHint = document.getElementById('gpu-hint');
            if (gpuCount > 1) {
                if (gpuHint) gpuHint.textContent = gpuCount + ' abas ser\u00e3o abertas \u2014 cada uma com sua GPU WebGPU independente.';
            } else {
                if (gpuHint) gpuHint.textContent = 'Cada GPU abre uma aba separada com sua inst\u00e2ncia WebGPU';
            }
        });
    });
}

/* ------------------------------------------------------------------ */
/*  Lupa — Magnifier nibble viewer                                     */
/* ------------------------------------------------------------------ */

var _lupaCells = [];
var _lupaOpen = false;

function _keyToNibbles(hexStr) {
    var nibbles = [];
    for (var i = 0; i < 64; i++) nibbles.push(parseInt(hexStr[i], 16));
    return nibbles;
}

function _nibblesToHex(nibbles) {
    var s = '';
    for (var i = 0; i < 64; i++) s += nibbles[i].toString(16);
    return s;
}

function _buildLupaGrid() {
    var grid = document.getElementById('lupa-grid');
    if (!grid) return;
    grid.innerHTML = '';
    _lupaCells = [];
    for (var i = 0; i < 64; i++) {
        var cell = document.createElement('div');
        cell.className = 'wl-lupa__cell wl-lupa__cell--locked';
        cell.setAttribute('data-idx', i);
        if (i % 8 === 0 && i > 0) cell.classList.add('wl-lupa__cell--sep-word');
        else if (i % 2 === 0 && i > 0) cell.classList.add('wl-lupa__cell--sep-byte');
        grid.appendChild(cell);
        _lupaCells.push(cell);
    }
}

function renderLupa() {
    if (!currentWallet || rangeStart === undefined || rangeEnd === undefined) return;
    if (!_lupaOpen) return;
    var startHex = rangeStart.toString(16).padStart(64, '0');
    var endHex = rangeEnd.toString(16).padStart(64, '0');
    var rangeInfo = document.getElementById('lupa-range-info');
    if (rangeInfo) rangeInfo.textContent = 'Puzzle ' + currentSel;

    var pctInputEl = document.getElementById('pct-input');
    var pctStr = pctInputEl ? (pctInputEl.value || '0') : '0';
    var currentKey = pctToKey(pctStr);
    if (currentKey === null) return;
    var currentHex = currentKey.toString(16).padStart(64, '0');
    var currentNibbles = _keyToNibbles(currentHex);

    for (var i = 0; i < 64; i++) {
        var sn = parseInt(startHex[i], 16);
        var en = parseInt(endHex[i], 16);
        var cn = currentNibbles[i];
        var cell = _lupaCells[i];
        if (!cell) continue;

        cell.textContent = cn.toString(16).toUpperCase();
        cell.className = 'wl-lupa__cell';
        if (i % 8 === 0 && i > 0) cell.classList.add('wl-lupa__cell--sep-word');
        else if (i % 2 === 0 && i > 0) cell.classList.add('wl-lupa__cell--sep-byte');

        if (sn === en) {
            cell.classList.add('wl-lupa__cell--locked');
        } else {
            cell.classList.add('wl-lupa__cell--free');
            (function(idx) {
                cell.onclick = function() { _onNibbleClick(idx); };
            })(i);
        }
    }

    _updateLupaAddr(currentHex);
}

function updateLupa() {
    if (!_lupaOpen || !currentWallet) return;
    renderLupa();
}

function updateLupaNibbles() {
    if (!_lupaOpen || !currentWallet || rangeStart === undefined || rangeEnd === undefined) return;
    var startHex = rangeStart.toString(16).padStart(64, '0');
    var endHex = rangeEnd.toString(16).padStart(64, '0');
    var pctInputEl = document.getElementById('pct-input');
    var pctStr = pctInputEl ? (pctInputEl.value || '0') : '0';
    var currentKey = pctToKey(pctStr);
    if (currentKey === null) return;
    var currentHex = currentKey.toString(16).padStart(64, '0');
    for (var i = 0; i < 64; i++) {
        var cell = _lupaCells[i];
        if (!cell) continue;
        cell.textContent = parseInt(currentHex[i], 16).toString(16).toUpperCase();
        var sn = parseInt(startHex[i], 16);
        var en = parseInt(endHex[i], 16);
        cell.className = 'wl-lupa__cell';
        if (i % 8 === 0 && i > 0) cell.classList.add('wl-lupa__cell--sep-word');
        else if (i % 2 === 0 && i > 0) cell.classList.add('wl-lupa__cell--sep-byte');
        if (sn === en) {
            cell.classList.add('wl-lupa__cell--locked');
            cell.onclick = null;
        } else {
            cell.classList.add('wl-lupa__cell--free');
            if (!cell.onclick) {
                (function(idx) { cell.onclick = function() { _onNibbleClick(idx); }; })(i);
            }
        }
    }
}

function _updateLupaAddr(hexKey) {
    var addrEl = document.getElementById('lupa-addr');
    if (!addrEl || !currentWallet) return;
    addrEl.textContent = '\u2026';
    addrEl.style.color = 'var(--ink-400)';
    setTimeout(function() {
        try {
            var addr = generateAddress(hexKey);
            var h160 = addressToHash160(currentWallet.address);
            var myH160 = addressToHash160(addr);
            if (h160 && myH160 && h160 === myH160) {
                addrEl.textContent = '\u2713 ' + addr;
                addrEl.style.color = 'var(--accent)';
            } else {
                addrEl.textContent = addr;
                addrEl.style.color = 'var(--ink-200)';
            }
        } catch (e) {
            addrEl.textContent = '\u2717 ' + e.message;
            addrEl.style.color = 'var(--danger)';
        }
    }, 0);
}

function _onNibbleClick(idx) {
    if (!currentWallet || rangeStart === undefined || rangeEnd === undefined) return;
    var pctInputEl = document.getElementById('pct-input');
    var pctStr = pctInputEl ? (pctInputEl.value || '0') : '0';
    var currentKey = pctToKey(pctStr);
    if (currentKey === null) return;
    var currentHex = currentKey.toString(16).padStart(64, '0');
    var nibbles = _keyToNibbles(currentHex);

    var startHex = rangeStart.toString(16).padStart(64, '0');
    var endHex = rangeEnd.toString(16).padStart(64, '0');
    var sn = parseInt(startHex[idx], 16);
    var en = parseInt(endHex[idx], 16);

    var curVal = nibbles[idx];
    var nextVal = (curVal + 1) % 16;
    while (nextVal !== curVal) {
        if (sn <= en) {
            if (nextVal >= sn && nextVal <= en) break;
        }
        nextVal = (nextVal + 1) % 16;
    }
    nibbles[idx] = nextVal;

    var newHex = _nibblesToHex(nibbles);
    var newKey = BigInt('0x' + newHex);
    if (newKey < rangeStart || newKey > rangeEnd) return;

    var rangeSize = rangeEnd - rangeStart;
    var offset = newKey - rangeStart;
    var pct = Number(offset * 1000000n / rangeSize) / 10000;
    if (pct > 100) pct = 100;
    if (pct < 0) pct = 0;

    var slider = document.getElementById('pct-slider');
    if (slider) slider.value = String(pct);
    var pctVal = document.getElementById('pct-val');
    if (pctVal) pctVal.textContent = fmtPctGlobal(String(pct));
    if (pctInputEl) pctInputEl.value = String(pct);
    startPct = pct;

    updateLupaNibbles();
    _updateLupaAddr(newHex);
    verifyKeyAtPct(String(pct));
}

function _initLupa() {
    _buildLupaGrid();
    var toggleBtn = document.getElementById('lupa-toggle');
    var section = document.getElementById('lupa-section');
    if (toggleBtn && section) {
        toggleBtn.addEventListener('click', function() {
            _lupaOpen = !_lupaOpen;
            section.style.display = _lupaOpen ? '' : 'none';
            toggleBtn.classList.toggle('is-active', _lupaOpen);
            var icon = document.getElementById('lupa-toggle-icon');
            if (icon) icon.textContent = _lupaOpen ? '\uD83D\uDD0D' : '\uD83D\uDD0D';
            if (_lupaOpen) renderLupa();
        });
    }
}

/* ------------------------------------------------------------------ */
/*  Batch verify — test multiple positions in parallel                 */
/* ------------------------------------------------------------------ */

var _batchItems = [];
var _BATCH_RENDER_MAX = 300;

function _batchAdd(pctStr) {
    var s = String(pctStr).trim();
    var n = parseFloat(s);
    if (isNaN(n) || n < 0 || n > 100) return;
    var exists = _batchItems.some(function(it) { return it.pct === n; });
    if (exists) return;
    var key = pctToKey(s);
    if (key === null) return;
    var hexKey = key.toString(16).padStart(64, '0');
    var pctFull = _keyToPctFull(key);
    _batchItems.push({ pct: n, pctStr: s.indexOf('.') >= 0 ? s : pctFull, hex: hexKey, status: 'pending', addr: '' });
    _batchRender();
}

function _batchRender() {
    var list = document.getElementById('batch-list');
    var actions = document.getElementById('batch-actions');
    var count = document.getElementById('batch-count');
    var results = document.getElementById('batch-results');
    if (!list) return;
    list.innerHTML = '';
    var total = _batchItems.length;
    var startIdx = Math.max(0, total - _BATCH_RENDER_MAX);
    if (startIdx > 0) {
        var skip = document.createElement('div');
        skip.className = 'wl-batch__item wl-batch__item--skip';
        skip.textContent = '\u2026 ' + startIdx + ' itens anteriores ocultos \u2026';
        list.appendChild(skip);
    }
    for (var i = startIdx; i < total; i++) {
        var it = _batchItems[i];
        var div = document.createElement('div');
        div.className = 'wl-batch__item';
        var statusIcon = '\u2014';
        if (it.status === 'checking') statusIcon = '\u2026';
        else if (it.status === 'match') statusIcon = '\u2713';
        else if (it.status === 'no-match') statusIcon = '\u2717';
        else if (it.status === 'error') statusIcon = '\u26A0';
        div.innerHTML = '<span class="wl-batch__item-pct" title="' + (it.pctStr || it.pct.toFixed(4)) + '">' + (it.pctStr || it.pct.toFixed(4)) + '%</span>' +
            '<span class="wl-batch__item-hex">' + it.hex.substring(0, 16) + '...</span>' +
            '<span class="wl-batch__item-addr">' + (it.addr || '\u2014') + '</span>' +
            '<span class="wl-batch__item-status">' + statusIcon + '</span>' +
            '<button class="wl-batch__item-remove" data-idx="' + i + '" type="button">\u2715</button>';
        list.appendChild(div);
    }
    list.querySelectorAll('.wl-batch__item-remove').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var idx = parseInt(btn.getAttribute('data-idx'));
            _batchItems.splice(idx, 1);
            _batchRender();
        });
    });
    if (actions) actions.style.display = _batchItems.length > 0 ? '' : 'none';
    if (count) count.textContent = _batchItems.length;
    if (results) {
        var matchCount = _batchItems.filter(function(it) { return it.status === 'match'; }).length;
        if (matchCount > 0) {
            results.innerHTML = '<span class="wl-batch__result-match">\u2713 ' + matchCount + ' correspond\u00eancia(s) encontrada(s)!</span>';
        } else {
            var done = _batchItems.filter(function(it) { return it.status !== 'pending' && it.status !== 'checking'; }).length;
            results.textContent = done > 0 ? done + '/' + _batchItems.length + ' verificados' : '';
        }
    }
}

function _batchVerifyAll() {
    if (!currentWallet) return;
    var pending = _batchItems.filter(function(it) { return it.status === 'pending' || it.status === 'no-match' || it.status === 'error'; });
    if (pending.length === 0) {
        _batchItems.forEach(function(it) { it.status = 'pending'; it.addr = ''; });
        pending = _batchItems;
    }
    if (pending.length === 0) return;
    _batchRender();
    var targetH160 = addressToHash160(currentWallet.address);
    var hexKeys = pending.map(function(it) { return it.hex; });
    var hexKeyCount = hexKeys.length;
    var N = currentWorkerCount();
    if (N > hexKeyCount) N = hexKeyCount;
    var perWorker = Math.ceil(hexKeyCount / N);
    var startTime = performance.now();
    var totalDone = 0;
    var workersDone = 0;
    var verifyFinished = false;
    var safetyTimer = null;
    var perWorkerDone = new Array(N);
    for (var i = 0; i < N; i++) perWorkerDone[i] = 0;
    log('Verificando ' + hexKeyCount + ' chaves com ' + N + ' worker(s) WASM...');
    function updateProgress() {
        var elapsed = (performance.now() - startTime) / 1000;
        var speed = elapsed > 0.3 ? Math.round(totalDone / elapsed) : 0;
        var label = document.getElementById('batch-results');
        if (label) label.textContent = totalDone.toLocaleString() + '/' + hexKeyCount.toLocaleString() + ' verificados (' + speed.toLocaleString() + ' keys/s)';
    }
    function finalize() {
        if (verifyFinished) return;
        verifyFinished = true;
        if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
        var elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        var matchCount = _batchItems.filter(function(it) { return it.status === 'match'; }).length;
        _batchRender();
        var label = document.getElementById('batch-results');
        if (label) {
            if (matchCount > 0) {
                label.innerHTML = '<span class="wl-batch__result-match">\u2713 ' + matchCount + ' correspond\u00eancia(s)!</span>';
            } else {
                var avgSpeed = hexKeyCount > 0 ? Math.round(hexKeyCount / ((performance.now() - startTime) / 1000)) : 0;
                label.textContent = _batchItems.length + ' verificados em ' + elapsed + 's (' + avgSpeed.toLocaleString() + ' keys/s) \u2014 nenhuma correspond\u00eancia.';
            }
        }
    }
    function resetSafety() {
        if (safetyTimer) clearTimeout(safetyTimer);
        safetyTimer = setTimeout(function() {
            if (!verifyFinished) { logErr('Timeout: worker de verifica\u00e7\u00e3o travou'); finalize(); }
        }, 30000);
    }
    for (var w = 0; w < N; w++) {
        (function(w) {
            var offset = w * perWorker;
            var end = Math.min(offset + perWorker, hexKeyCount);
            var slice = hexKeys.slice(offset, end);
            if (slice.length === 0) { workersDone++; return; }
            pending.slice(offset, end).forEach(function(it) { it.status = 'checking'; });
            var worker;
            try {
                worker = new Worker(getWorkerUrl());
            } catch (err) {
                logErr('Erro ao criar worker de verifica\u00e7\u00e3o: ' + err.message);
                pending.slice(offset, end).forEach(function(it) { it.status = 'no-match'; it.addr = '\u2014'; });
                workersDone++;
                if (workersDone >= N) finalize();
                return;
            }
            worker.onmessage = function(e) {
                if (verifyFinished) return;
                var msg = e.data;
                if (msg.type === 'verify-progress') {
                    perWorkerDone[w] = msg.done;
                    totalDone = 0;
                    for (var i = 0; i < N; i++) totalDone += perWorkerDone[i];
                    updateProgress();
                    resetSafety();
                } else if (msg.type === 'verify-result') {
                    msg.results.forEach(function(r) {
                        var idx = offset + r.idx;
                        if (idx < pending.length && r.match) {
                            pending[idx].status = 'match';
                            pending[idx].addr = generateAddress(pending[idx].hex);
                            logOk('Verifica\u00e7\u00e3o encontrou chave! ' + pending[idx].pctStr + '% -> ' + pending[idx].addr);
                            if (currentWallet && currentWallet.address) saveFoundKey(currentSel, currentWallet.address, pending[idx].hex);
                            displayFoundKeys();
                            if (running) handleFound(pending[idx].hex);
                        }
                    });
                } else if (msg.type === 'verify-done') {
                    worker.terminate();
                    pending.slice(offset, end).forEach(function(it) {
                        if (it.status === 'checking') { it.status = 'no-match'; it.addr = '\u2014'; }
                    });
                    workersDone++;
                    if (workersDone >= N) finalize();
                }
            };
            worker.onerror = function() {
                if (verifyFinished) return;
                try { worker.terminate(); } catch(e) {}
                pending.slice(offset, end).forEach(function(it) {
                    if (it.status === 'checking') { it.status = 'no-match'; it.addr = '\u2014'; }
                });
                workersDone++;
                if (workersDone >= N) finalize();
            };
            var vMsg = { type: 'verify', keys: slice, targetHash160: targetH160 };
            if (window._wl && window._wl._sharedWasmModule) vMsg.wasmModule = window._wl._sharedWasmModule;
            worker.postMessage(vMsg);
        })(w);
    }
    _batchRender();
    resetSafety();
}

function _batchClear() {
    _batchItems = [];
    _batchRender();
}

function _initBatch() {
    var addBtn = document.getElementById('batch-add');
    var input = document.getElementById('batch-input');
    var clearBtn = document.getElementById('batch-clear');
    var verifyBtn = document.getElementById('batch-verify-all');
    var randomBtn = document.getElementById('batch-random');
    var spacedBtn = document.getElementById('batch-spaced');
    if (addBtn && input) {
        addBtn.addEventListener('click', function() {
            var parts = input.value.split(/[,;\s]+/);
            parts.forEach(function(p) { if (p.trim()) _batchAdd(p); });
            input.value = '';
        });
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                addBtn.click();
            }
        });
    }
    if (randomBtn) {
        randomBtn.addEventListener('click', function() {
            if (_batchScan.active) { _batchScanStop(); return; }
            if (!currentWallet || !currentWallet.address) { logErr('Selecione uma carteira primeiro.'); return; }
            var savedTarget = _batchScan.totalTarget;
            _batchScan.totalTarget = 1000000000;
            _batchScanStart();
            _batchScan._savedTarget = savedTarget;
        });
    }
    if (spacedBtn) {
        spacedBtn.addEventListener('click', function() {
            if (!currentWallet) { logErr('Selecione uma carteira primeiro.'); return; }
            var maxGen = Math.min(1000000, 1000000);
            var existing = _batchItems.length;
            if (existing >= maxGen) { logWarn('Lista j\u00e1 cont\u00e9m ' + existing.toLocaleString('pt-BR') + ' chaves. Limite: 1M. Use "Scan 1B" para varredura maior.'); return; }
            var remaining = maxGen - existing;
            log('Gerando ' + remaining.toLocaleString('pt-BR') + ' chaves aleat\u00f3rias...');
            var totalToGen = remaining;
            var added = 0;
            var batchSize = 50000;
            function _genBatch() {
                var end = Math.min(added + batchSize, totalToGen);
                for (var i = added; i < end; i++) {
                    var pctStr = _randomPctVariado();
                    var n = parseFloat(pctStr);
                    if (isNaN(n) || n < 0 || n > 100) continue;
                    var key = pctToKey(pctStr);
                    if (key === null) continue;
                    var hexKey = key.toString(16).padStart(64, '0');
                    var pctFull = _keyToPctFull(key);
                    _batchItems.push({ pct: n, pctStr: pctStr.indexOf('.') >= 0 ? pctStr : pctFull, hex: hexKey, status: 'pending', addr: '' });
                }
                added = end;
                if (added % 200000 === 0 || added >= totalToGen) {
                    log('Progresso: ' + added.toLocaleString('pt-BR') + '/' + totalToGen.toLocaleString('pt-BR') + ' geradas.');
                }
                if (added < totalToGen) {
                    setTimeout(_genBatch, 0);
                } else {
                    _batchRender();
                    logOk(_batchItems.length.toLocaleString('pt-BR') + ' chaves na lista.');
                }
            }
            _genBatch();
        });
    }
    if (clearBtn) clearBtn.addEventListener('click', _batchClear);
    if (verifyBtn) verifyBtn.addEventListener('click', _batchVerifyAll);
    var scanBtn = document.getElementById('batch-scan-btn');
    if (scanBtn) scanBtn.addEventListener('click', _batchScanStart);
}

/* ------------------------------------------------------------------ */
/*  Batch scan — 1 billion random keys at WASM/WebGPU speed            */
/* ------------------------------------------------------------------ */

var _batchScan = {
    active: false,
    workers: [],
    totalTarget: 1000000000,
    totalScanned: 0n,
    startTime: 0,
    progressTimer: null,
    doneCount: 0,
    expectedWorkers: 0,
    gpuActive: false
};

function _batchScanUpdateProgress() {
    var elapsed = (performance.now() - _batchScan.startTime) / 1000;
    var scanned = _batchScan.totalScanned;
    var target = BigInt(_batchScan.totalTarget);
    var pct = Number(scanned * 10000n / target) / 100;
    var displayPct = Math.min(pct, 100);
    var speed = elapsed > 0 ? Math.round(Number(scanned) / elapsed) : 0;
    var speedStr = speed >= 1000000 ? (speed / 1000000).toFixed(1) + 'M' : speed >= 1000 ? Math.round(speed / 1000) + 'k' : speed;
    var el = document.getElementById('batch-scan-progress');
    if (el) el.style.display = '';
    var bar = document.getElementById('batch-scan-bar');
    if (bar) bar.style.width = Math.min(pct, 100) + '%';
    var label = document.getElementById('batch-scan-label');
    if (label) label.textContent = scanned.toLocaleString('pt-BR') + ' / ' + _batchScan.totalTarget.toLocaleString('pt-BR') + ' chaves (' + displayPct.toFixed(2) + '%) \u2014 ' + speedStr + ' keys/s';
}

function _batchScanStart() {
    if (_batchScan.active) { _batchScanStop(); return; }
    if (!currentWallet || !currentWallet.address) { logErr('Selecione uma carteira primeiro.'); return; }
    if (!rangeStart || !rangeEnd || rangeEnd <= rangeStart) { logErr('Range da carteira inv\u00e1lido.'); return; }

    var N = currentWorkerCount();
    var perWorker = Math.ceil(_batchScan.totalTarget / N);
    var targetH160 = addressToHash160(currentWallet.address);
    var cpuInfo = (typeof WebGPU_Turbo !== 'undefined') ? WebGPU_Turbo.getCPUInfo() : null;
    var pipeB = 2048;
    if (cpuInfo) {
        if (cpuInfo.arch === 'arm') pipeB = 512;
        else if (cpuInfo.vendor === 'amd') pipeB = 4096;
    }

    _batchScan.active = true;
    _batchScan.workers = [];
    _batchScan.totalScanned = 0n;
    _batchScan.startTime = performance.now();
    _batchScan.doneCount = 0;
    _batchScan.expectedWorkers = N;

    logOk('Iniciando Scan: ' + N + ' worker(s) testando chaves aleat\u00f3rias (' + (_batchScan.totalTarget >= 1000000000 ? '1B' : _batchScan.totalTarget >= 1000000 ? '1M' : _batchScan.totalTarget.toLocaleString('pt-BR')) + ')...');

    var scanBtn = document.getElementById('batch-scan-btn');
    if (scanBtn) { scanBtn.textContent = 'Parar scan'; scanBtn.className = 'btn btn--danger btn--sm'; }

    var el = document.getElementById('batch-scan-progress');
    if (el) el.style.display = '';
    _batchScanUpdateProgress();

    for (var i = 0; i < N; i++) {
        var cfg = {
            targetHash160: targetH160,
            startKey: rangeStart.toString(16),
            endKey: rangeEnd.toString(16),
            batchSize: 5000,
            workerIndex: i,
            lanes: 4,
            windowKeys: 262144,
            searchMode: 'random',
            pipeB: pipeB,
            maxKeysTotal: perWorker.toString()
        };
        var worker;
        try {
            worker = new Worker(getWorkerUrl());
            worker.onmessage = _batchScanWorkerMessage;
            worker.onerror = function(e) {
                logErr('Erro no scan worker: ' + e.message);
            };
            worker.postMessage({ type: 'start', targetHash160: cfg.targetHash160, startKey: cfg.startKey, endKey: cfg.endKey, batchSize: cfg.batchSize, workerIndex: cfg.workerIndex, lanes: cfg.lanes, windowKeys: cfg.windowKeys, searchMode: cfg.searchMode, pipeB: cfg.pipeB, maxKeysTotal: cfg.maxKeysTotal });
            _batchScan.workers.push(worker);
        } catch (err) {
            logErr('Erro ao criar scan worker: ' + err.message);
        }
    }

    _batchScan.progressTimer = setInterval(function() {
        if (!_batchScan.active) { clearInterval(_batchScan.progressTimer); return; }
        _batchScanUpdateProgress();
    }, 1000);
}

function _batchScanWorkerMessage(e) {
    var msg = e.data;
    if (msg.type === 'progress') {
        if (!_batchScan.active) return;
        _batchScan.totalScanned += BigInt(msg.count);
        _batchScanUpdateProgress();
    } else if (msg.type === 'found') {
        if (!_batchScan.active) return;
        _batchScanOnFound(msg.key);
    } else if (msg.type === 'done') {
        if (!_batchScan.active) return;
        try { e.target.terminate(); } catch(ex) {}
        _batchScan.doneCount++;
        _batchScanCheckDone();
    }
}

function _batchScanOnFound(keyHex) {
    var keyBigInt = BigInt('0x' + keyHex);
    var pct = _keyToPct(keyBigInt);
    var pctFull = _keyToPctFull(keyBigInt);
    var addr = generateAddress(keyHex);
    _batchItems.unshift({ pct: pct, pctStr: pctFull, hex: keyHex, status: 'match', addr: addr });
    _batchRender();
    logOk('Scan encontrou chave! ' + pctFull + '% -> ' + addr);
    if (currentWallet && currentWallet.address) {
        saveFoundKey(currentSel, currentWallet.address, keyHex);
        displayFoundKeys();
    }
    if (running) handleFound(keyHex);
}

function _batchScanCheckDone() {
    if (_batchScan.doneCount >= _batchScan.expectedWorkers && !_batchScan.gpuActive) {
        _batchScanFinish();
    }
}

function _batchScanFinish() {
    _batchScan.active = false;
    if (_batchScan.progressTimer) { clearInterval(_batchScan.progressTimer); _batchScan.progressTimer = null; }
    _batchScan.workers.forEach(function(w) { try { w.terminate(); } catch (e) {} });
    _batchScan.workers = [];

    var elapsed = (performance.now() - _batchScan.startTime) / 1000;
    var scanned = _batchScan.totalScanned;
    var targetLabel = _batchScan.totalTarget >= 1000000000 ? '1B' : _batchScan.totalTarget >= 1000000 ? '1M' : _batchScan.totalTarget.toLocaleString('pt-BR');
    var speed = elapsed > 0 ? Math.round(Number(scanned) / elapsed) : 0;
    logOk('Scan ' + targetLabel + ' conclu\xEDdo: ' + scanned.toLocaleString('pt-BR') + ' chaves em ' + elapsed.toFixed(1) + 's (' + speed.toLocaleString('pt-BR') + ' keys/s).');

    if (_batchScan._savedTarget) { _batchScan.totalTarget = _batchScan._savedTarget; delete _batchScan._savedTarget; }
    var scanBtn = document.getElementById('batch-scan-btn');
    if (scanBtn) { scanBtn.textContent = 'Scan 1B'; scanBtn.className = 'btn btn--accent btn--sm'; }
    _batchScanUpdateProgress();
}

function _batchScanStop() {
    if (!_batchScan.active) return;
    _batchScan.active = false;
    if (_batchScan.progressTimer) { clearInterval(_batchScan.progressTimer); _batchScan.progressTimer = null; }
    _batchScan.workers.forEach(function(w) { try { w.terminate(); } catch (e) {} });
    _batchScan.workers = [];
    if (_batchScan.gpuActive && typeof WebGPU_Turbo !== 'undefined') { WebGPU_Turbo.stop(); _batchScan.gpuActive = false; }

    var elapsed = (performance.now() - _batchScan.startTime) / 1000;
    var scanned = _batchScan.totalScanned;
    var targetLabel = _batchScan.totalTarget >= 1000000000 ? '1B' : _batchScan.totalTarget >= 1000000 ? '1M' : _batchScan.totalTarget.toLocaleString('pt-BR');
    var speed = elapsed > 0 ? Math.round(Number(scanned) / elapsed) : 0;
    logWarn('Scan ' + targetLabel + ' interrompido: ' + scanned.toLocaleString('pt-BR') + ' chaves testadas em ' + elapsed.toFixed(1) + 's (' + speed.toLocaleString('pt-BR') + ' keys/s).');

    if (_batchScan._savedTarget) { _batchScan.totalTarget = _batchScan._savedTarget; delete _batchScan._savedTarget; }
    var scanBtn = document.getElementById('batch-scan-btn');
    if (scanBtn) { scanBtn.textContent = 'Scan 1B'; scanBtn.className = 'btn btn--accent btn--sm'; }
    _batchScanUpdateProgress();
}

/* ------------------------------------------------------------------ */
/*  Engine state / hardware detection                                  */
/* ------------------------------------------------------------------ */

function currentWorkerCount() {
    var el = document.getElementById('worker-count');
    var v = el ? el.value : 'auto';
    if (v === 'auto') {
        return navigator.hardwareConcurrency || 4;
    }
    if (v === '0') {
        return Math.max(navigator.hardwareConcurrency || 16, 64);
    }
    return parseInt(v, 10) || 1;
}

function setEngineState(state) {
    var dot = document.getElementById('engine-dot');
    var label = document.getElementById('engine-label');
    if (!dot || !label) return;
    dot.className = 'wl-engine__dot wl-engine__dot--' + state;
    if (state === 'running') label.textContent = 'Buscando';
    else if (state === 'ready') label.textContent = 'Pronto';
    else if (state === 'error') label.textContent = 'Erro';
}

function detectCPUCapabilities() {
    var ua = (navigator.userAgent || '').toLowerCase();
    var pl = (navigator.platform || '').toLowerCase();
    var hw = navigator.hardwareConcurrency || 2;
    var vendor = 'unknown';
    var model = '';
    var simd = 'none';
    var arch = 'x86';

    if (ua.includes('android') || ua.includes('iphone') || ua.includes('ipad') || ua.includes('mobile')) {
        arch = 'arm';
        if (ua.includes('snapdragon') || ua.includes('qualcomm') || ua.includes('adreno')) {
            vendor = 'qualcomm'; model = 'Snapdragon';
        } else if (ua.includes('exynos') || ua.includes('samsung')) {
            vendor = 'samsung'; model = 'Exynos';
        } else if (ua.includes('mediatek') || ua.includes('mt')) {
            vendor = 'mediatek'; model = 'MediaTek';
        } else if (ua.includes('tensor')) {
            vendor = 'google'; model = 'Tensor';
        } else if (ua.includes('kirin') || ua.includes('hisilicon')) {
            vendor = 'hisilicon'; model = 'Kirin';
        } else if (ua.includes('apple')) {
            vendor = 'apple'; model = 'A-series/M-series';
        }
    }
    else if (ua.includes('amd') || pl.includes('amd')) {
        vendor = 'amd'; model = 'Ryzen/EPYC';
    } else if (ua.includes('intel')) {
        vendor = 'intel'; model = 'Core/Xeon';
    } else if (pl.includes('arm') || pl.includes('aarch64') || ua.includes('aarch64')) {
        arch = 'arm';
        vendor = 'arm'; model = 'Cortex';
    }

    if (arch === 'arm') {
        simd = 'neon';
    } else {
        try {
            if (typeof Int8x16Array !== 'undefined' || typeof SIMD !== 'undefined') simd = 'avx2';
            else if (typeof Int32Array !== 'undefined') simd = 'sse4';
        } catch (e) {
            simd = 'sse4';
        }
    }

    return { vendor: vendor, model: model, arch: arch, simd: simd, cores: hw };
}

function showHwBadge(gpuVendor, cpuInfo) {
    var badge = document.getElementById('hw-badge');
    var badgeLabel = document.getElementById('hw-label');
    if (!badge || !badgeLabel) return;
    var parts = [];
    if (gpuVendor && gpuVendor !== 'UNKNOWN' && gpuVendor !== 'CPU') parts.push(gpuVendor);
    if (cpuInfo && cpuInfo.vendor !== 'unknown') parts.push(cpuInfo.vendor.toUpperCase());
    if (parts.length) {
        badgeLabel.textContent = parts.join(' | ');
        badge.style.display = '';
    }
}

function detectHardwareTier() {
    var gpu = null;
    var cpu = null;
    if (typeof WebGPU_Turbo !== 'undefined' && WebGPU_Turbo.isAvailable()) {
        gpu = WebGPU_Turbo.getGPUInfo();
    }
    if (typeof WebGPU_Turbo !== 'undefined') {
        cpu = WebGPU_Turbo.getCPUInfo();
    }

    var parts = [];
    if (gpu) {
        parts.push(gpu.device || gpu.description || gpu.vendor || 'GPU');
    }
    if (cpu) {
        parts.push(cpu.vendor.toUpperCase() + ' ' + cpu.arch.toUpperCase());
    }
    return parts.join(' | ') || 'WebGPU indispon\u00edvel';
}

/* ------------------------------------------------------------------ */
/*  Display found keys table                                           */
/* ------------------------------------------------------------------ */

function displayFoundKeys() {
    var list = document.getElementById('found-keys-list');
    var clearBtn = document.getElementById('clear-keys');
    if (!list) return;
    list.innerHTML = '';
    var keys = safeGetKeys();

    if (keys.length === 0) {
        list.innerHTML = '<p class="wl-console__empty">Nenhuma chave encontrada ainda.</p>';
        if (clearBtn) clearBtn.style.display = 'none';
        return;
    }
    if (clearBtn) clearBtn.style.display = '';

    var table = document.createElement('table');
    table.className = 'mono';
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:var(--fs-xs);';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    headRow.style.cssText = 'color:var(--ink-400);text-align:left;';
    ['Carteira', 'Endere\u00e7o', 'Chave Privada', 'Data'].forEach(function (h) {
        var th = document.createElement('th');
        th.textContent = h;
        th.style.cssText = 'padding:0.375rem var(--sp-2);font-weight:600;letter-spacing:var(--tr-label);text-transform:uppercase;';
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    var tbody = document.createElement('tbody');

    keys.forEach(function (k) {
        var tr = document.createElement('tr');
        tr.style.cssText = 'border-top:1px solid var(--line);';
        [['Carteira ' + k.walletId, 'center'], [k.address, 'left'], [k.privateKey, 'left'], [fmtDate(k.timestamp), 'left']]
            .forEach(function (cell) {
                var td = document.createElement('td');
                td.textContent = cell[0];
                td.style.cssText = 'padding:0.5rem var(--sp-2);vertical-align:top;text-align:' + cell[1] + ';color:var(--ink-300);overflow-wrap:anywhere;';
                tr.appendChild(td);
            });
        if (k.address) {
            var cell = tr.children[1];
            cell.style.color = 'var(--solved)';
        }
        tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    list.appendChild(table);
}

/* ===================================================================
   Export via window.WbloteryUI
   =================================================================== */

window.WbloteryUI = {
    // DOM helpers
    $_, $show, $hide, $text, $width,

    // Constants
    HISTORICAL_POSITIONS,
    CONSOLE_LEVELS,

    // Format helpers
    fmtElapsed,
    fmtDate,
    fmtPctGlobal,

    // Match overlay + sound + confetti
    _playMatchSound,
    spawnConfetti,
    _showMatchOverlay,

    // Live keys
    renderLiveKeys,

    // Progress bar
    renderProgressMarkers,
    initProgressThumb,
    initProgressBar,

    // Percentage slider
    pctToKey,
    _keyToPct,
    _keyToPctFull,
    _randomPctVariado,
    keyToPct,
    verifyKeyAtPct,
    verifyKeyHex,
    initSliderListeners,

    // Lupa (nibble viewer)
    _buildLupaGrid,
    renderLupa,
    updateLupa,
    updateLupaNibbles,
    _onNibbleClick,
    _updateLupaAddr,
    _keyToNibbles,
    _nibblesToHex,
    _initLupa,

    // Batch verify
    _batchAdd,
    _batchRender,
    _batchVerifyAll,
    _batchClear,
    _initBatch,

    // Batch scan
    _batchScanStart,
    _batchScanStop,
    _batchScanFinish,
    _batchScanWorkerMessage,
    _batchScanOnFound,
    _batchScanCheckDone,
    _batchScanUpdateProgress,
    _batchScan,

    // Engine state / hardware
    currentWorkerCount,
    setEngineState,
    detectCPUCapabilities,
    showHwBadge,
    detectHardwareTier,

    // Found keys display
    displayFoundKeys,

    // Internal state (expose for coordination)
    get _batchItems() { return _batchItems; },
    set _batchItems(v) { _batchItems = v; },
    get _lupaOpen() { return _lupaOpen; },
    set _lupaOpen(v) { _lupaOpen = v; }
};
