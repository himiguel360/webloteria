/**
 * webloteria/js/sync.js
 *
 * Server-sync, persistence, and result-reporting helpers.
 * Globals provided by bridge.js: log, logOk, logErr, logWarn, fmtDate
 * State provided via window._wl: currentWallet, currentSel
 */

/* ── internal state ─────────────────────────────────────────────── */

var _syncDeviceId = 'dev-' + Math.random().toString(36).substring(2, 8);
var _syncPollTimer = null;
var _remoteScannedRanges = [];

var _hasApi = (function () {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(h);
})();

/* ── helpers ────────────────────────────────────────────────────── */

function safeGetKeys() {
    try {
        var raw = localStorage.getItem('foundKeys');
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

/* ── sync TO server ─────────────────────────────────────────────── */

function _syncToServer(keyHex) {
    if (!_hasApi) return;
    var addr = generateAddress(keyHex);
    var cw = window._wl.currentWallet;
    var cs = window._wl.currentSel;
    if (!cw || !addr) return;
    var body = JSON.stringify({
        walletId: cs,
        address: cw.address,
        privateKey: keyHex,
        timestamp: Date.now(),
        device: _syncDeviceId
    });
    fetch('/api/found-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
    })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d.ok && window.log) log('Chave sincronizada com o servidor'); })
        .catch(function () {});
}

function _syncScannedRangesToServer(walletId, startHex, endHex) {
    if (!_hasApi) return;
    var body = JSON.stringify({ walletId: walletId, start: startHex, end: endHex, device: _syncDeviceId });
    fetch('/api/scanned-ranges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
    })
        .then(function (r) { return r.json(); })
        .catch(function () {});
}

function _syncSpeedToServer(walletId, gpuSpeed, cpuSpeed, totalKeys) {
    if (!_hasApi) return;
    var body = JSON.stringify({ walletId: walletId, device: _syncDeviceId, gpuSpeed: gpuSpeed, cpuSpeed: cpuSpeed, totalKeys: totalKeys });
    fetch('/api/speed-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
    })
        .catch(function () {});
}

/* ── sync FROM server ───────────────────────────────────────────── */

function _syncScannedRangesFromServer(callback) {
    if (!_hasApi) { if (callback) callback([]); return; }
    fetch('/api/scanned-ranges')
        .then(function (r) { return r.json(); })
        .then(function (ranges) {
            if (!ranges || !ranges.length) { if (callback) callback([]); return; }
            _remoteScannedRanges = ranges.filter(function (r) { return r.device !== _syncDeviceId; });
            if (_remoteScannedRanges.length > 0) {
                log('☁️ ' + _remoteScannedRanges.length + ' ranges escaneados por outros dispositivos carregados.');
            }
            if (callback) callback(_remoteScannedRanges);
        })
        .catch(function () { if (callback) callback([]); });
}

function _isRangeRemoteScanned(walletId, start, end) {
    for (var i = 0; i < _remoteScannedRanges.length; i++) {
        var r = _remoteScannedRanges[i];
        if (r.walletId !== walletId) continue;
        try {
            var rStart = BigInt('0x' + r.start);
            var rEnd = BigInt('0x' + r.end);
        } catch (e) { continue; }
        if (start >= rStart && end <= rEnd) return true;
    }
    return false;
}

function _syncFromServer() {
    if (!_hasApi) return;
    fetch('/api/found-keys')
        .then(function (r) { return r.json(); })
        .then(function (serverKeys) {
            if (!serverKeys || !serverKeys.length) return;
            var local = safeGetKeys();
            var added = 0;
            serverKeys.forEach(function (sk) {
                if (sk.device === _syncDeviceId) return;
                var exists = local.some(function (lk) { return lk.privateKey === sk.privateKey; });
                if (!exists) {
                    local.push({
                        walletId: sk.walletId,
                        address: sk.address,
                        privateKey: sk.privateKey,
                        timestamp: sk.timestamp || new Date().toISOString()
                    });
                    added++;
                }
            });
                if (added > 0) {
                try { localStorage.setItem('foundKeys', JSON.stringify(local)); } catch (e) {}
                if (window.logOk) logOk(added + ' chave(s) sincronizada(s) de outro dispositivo');
                if (typeof displayFoundKeys === 'function') displayFoundKeys();
                if (typeof renderFoundCards === 'function') renderFoundCards();
            }
        })
        .catch(function () {});
}

/* ── polling lifecycle ──────────────────────────────────────────── */

function _startSync() {
    if (_syncPollTimer) return;
    _syncFromServer();
    _syncPollTimer = setInterval(_syncFromServer, 15000);
}

function _stopSync() {
    if (_syncPollTimer) { clearInterval(_syncPollTimer); _syncPollTimer = null; }
}

/* ── persistence & result reporting ─────────────────────────────── */

function saveFoundKey(walletId, address, privateKey) {
    var keys = safeGetKeys();
    var isDup = keys.some(function (k) { return k.privateKey === privateKey; });
    if (!isDup) {
        keys.push({
            walletId: String(walletId),
            address: address,
            privateKey: privateKey,
            timestamp: new Date().toISOString()
        });
        try {
            localStorage.setItem('foundKeys', JSON.stringify(keys));
        } catch (e) {
            if (window.logErr) logErr('Nao foi possivel salvar localmente: ' + e.message);
        }
        sendPuzzleResult(walletId, privateKey);
    }
}

function sendPuzzleResult(walletId, privateKey) {
    var puzzleNumber = walletId;
    var reducedPoolToken = document.getElementById('reduced-token')?.value;
    if (!puzzleNumber || !reducedPoolToken) {
        if (window.logWarn) logWarn('Token do pool ausente. Resultado nao enviado (apenas salvo localmente).');
        return;
    }
    var payload = { puzzleNumber: puzzleNumber, reducedPoolToken: reducedPoolToken, privateKey: privateKey };
    if (window.log) log('Enviando resultado...');
    fetch('https://bitcoinpuzzles.io/api/puzzle-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(function (res) {
            if (res.ok) {
                if (window.logOk) logOk('Resultado enviado com sucesso.');
            } else {
                if (window.logErr) logErr('API respondeu com status ' + res.status);
            }
        })
        .catch(function (err) {
            if (window.logErr) logErr('Falha ao enviar resultado: ' + err.message);
        });
}

/* ── found-keys UI ──────────────────────────────────────────────── */

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
    ['Carteira', 'Endereço', 'Chave Privada', 'Data'].forEach(function (h) {
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
            var addrCell = tr.children[1];
            addrCell.style.color = 'var(--solved)';
        }
        tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    list.appendChild(table);
}

function renderFoundCards() {
    if (window.logOk) logOk('Chave salva localmente e reportada.');
}

/* ── public API ─────────────────────────────────────────────────── */

window.WbloterySync = {
    safeGetKeys: safeGetKeys,
    saveFoundKey: saveFoundKey,
    sendPuzzleResult: sendPuzzleResult,
    displayFoundKeys: displayFoundKeys,
    renderFoundCards: renderFoundCards,

    syncToServer: _syncToServer,
    syncScannedRangesToServer: _syncScannedRangesToServer,
    syncScannedRangesFromServer: _syncScannedRangesFromServer,
    isRangeRemoteScanned: _isRangeRemoteScanned,
    syncSpeedToServer: _syncSpeedToServer,
    syncFromServer: _syncFromServer,
    startSync: _startSync,
    stopSync: _stopSync
};
