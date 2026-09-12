/* BlockTracker — range-based progress persistence                     */
/* ------------------------------------------------------------------ */

var BLOCK_SIZE = 1073741824; // 2^30 ≈ 1 billion keys per block

function BlockTracker(puzzleId, rangeStart, rangeEnd) {
    this.puzzleId = puzzleId;
    this.rangeStart = rangeStart;
    this.rangeEnd = rangeEnd;
    this.totalSize = rangeEnd - rangeStart;
    this.completedRanges = [];
    this.nextClaim = rangeStart;
    this._load();
}

BlockTracker._key = function(id) { return 'blockProgress_' + id; };

BlockTracker.prototype._load = function() {
    try {
        var raw = localStorage.getItem(BlockTracker._key(this.puzzleId));
        if (raw) {
            var data = JSON.parse(raw);
            if (Array.isArray(data.ranges)) {
                this.completedRanges = data.ranges.map(function(r) {
                    return [BigInt(r[0]), BigInt(r[1])];
                });
                this._merge();
                this._clampRanges();
            }
            if (data.nextClaim) {
                var nc = BigInt(data.nextClaim);
                if (nc > this.rangeEnd) nc = this.rangeEnd;
                if (nc < this.rangeStart) nc = this.rangeStart;
                this.nextClaim = nc;
            }
        }
    } catch (e) { /* ignore */ }
};

BlockTracker.prototype.save = function() {
    try {
        var data = {
            ranges: this.completedRanges.map(function(r) {
                return [r[0].toString(), r[1].toString()];
            }),
            nextClaim: this.nextClaim.toString()
        };
        localStorage.setItem(BlockTracker._key(this.puzzleId), JSON.stringify(data));
    } catch (e) { /* storage full, ignore */ }
};

BlockTracker.prototype._merge = function() {
    if (this.completedRanges.length < 2) return;
    this.completedRanges.sort(function(a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    var merged = [this.completedRanges[0]];
    for (var i = 1; i < this.completedRanges.length; i++) {
        var last = merged[merged.length - 1];
        var cur = this.completedRanges[i];
        if (cur[0] <= last[1] + 1n) {
            if (cur[1] > last[1]) last[1] = cur[1];
        } else {
            merged.push(cur);
        }
    }
    this.completedRanges = merged;
};

BlockTracker.prototype._clampRanges = function() {
    var clamped = [];
    for (var i = 0; i < this.completedRanges.length; i++) {
        var s = this.completedRanges[i][0];
        var e = this.completedRanges[i][1];
        if (s < this.rangeStart) s = this.rangeStart;
        if (e > this.rangeEnd) e = this.rangeEnd;
        if (s <= e) clamped.push([s, e]);
    }
    this.completedRanges = clamped;
};

BlockTracker.prototype._isCovered = function(start, end) {
    for (var i = 0; i < this.completedRanges.length; i++) {
        var r = this.completedRanges[i];
        if (r[0] <= start && r[1] >= end) return true;
        if (r[0] > end) break;
    }
    return false;
};

BlockTracker.prototype.claimBlock = function(blockSize) {
    var bs = BigInt(blockSize || BLOCK_SIZE);
    if (bs > this.totalSize) bs = this.totalSize;
    if (bs < 1n) bs = 1n;
    var scanFrom = this.nextClaim;
    for (var i = 0; i < this.completedRanges.length; i++) {
        var r = this.completedRanges[i];
        if (r[0] > scanFrom) {
            var gapEnd = r[0] - 1n;
            var blockEnd = scanFrom + bs - 1n;
            if (blockEnd > gapEnd) blockEnd = gapEnd;
            if (blockEnd > this.rangeEnd) blockEnd = this.rangeEnd;
            this.nextClaim = blockEnd + 1n;
            return { start: scanFrom, end: blockEnd };
        }
        if (r[1] >= scanFrom) scanFrom = r[1] + 1n;
    }
    if (scanFrom > this.rangeEnd) return null;
    var end = scanFrom + bs - 1n;
    if (end > this.rangeEnd) end = this.rangeEnd;
    this.nextClaim = end + 1n;
    return { start: scanFrom, end: end };
};

BlockTracker.prototype.markDone = function(start, end) {
    this.completedRanges.push([BigInt(start), BigInt(end)]);
    this._merge();
};

BlockTracker.prototype.getPctDone = function() {
    var tested = 0n;
    for (var i = 0; i < this.completedRanges.length; i++) {
        tested += this.completedRanges[i][1] - this.completedRanges[i][0] + 1n;
    }
    if (tested >= this.totalSize) return 100;
    return Number(tested * 10000n / this.totalSize) / 100;
};

BlockTracker.prototype.getTestedCount = function() {
    var tested = 0n;
    for (var i = 0; i < this.completedRanges.length; i++) {
        tested += this.completedRanges[i][1] - this.completedRanges[i][0] + 1n;
    }
    return tested;
};

BlockTracker.prototype.trimFrom = function(key) {
    var k = BigInt(key);
    this.completedRanges = this.completedRanges.filter(function(r) {
        if (r[1] < k) return true;
        if (r[0] >= k) return false;
        r[1] = k - 1n;
        return true;
    });
    this.nextClaim = k;
    this._merge();
};

BlockTracker.prototype.importRemoteRanges = function(remoteRanges) {
    var added = 0;
    for (var i = 0; i < remoteRanges.length; i++) {
        var rr = remoteRanges[i];
        if (rr.walletId !== this.puzzleId) continue;
        try {
        var rStart = BigInt('0x' + rr.start);
        var rEnd = BigInt('0x' + rr.end);
        } catch(e) { continue; }
        if (rStart < this.rangeStart) rStart = this.rangeStart;
        if (rEnd > this.rangeEnd) rEnd = this.rangeEnd;
        if (rStart > rEnd) continue;
        if (!this._isCovered(rStart, rEnd)) {
            this.completedRanges.push([rStart, rEnd]);
            added++;
        }
    }
    if (added > 0) {
        this._merge();
        this._clampRanges();
    }
    return added;
};

BlockTracker.prototype.reset = function() {
    this.completedRanges = [];
    this.nextClaim = this.rangeStart;
    try { localStorage.removeItem(BlockTracker._key(this.puzzleId)); } catch (e) {}
};

BlockTracker.prototype.exportJSON = function() {
    return JSON.stringify({
        puzzleId: this.puzzleId,
        ranges: this.completedRanges.map(function(r) {
            return [r[0].toString(), r[1].toString()];
        }),
        nextClaim: this.nextClaim.toString(),
        exportedAt: new Date().toISOString()
    });
};

BlockTracker.prototype.importJSON = function(json) {
    try {
        var data = JSON.parse(json);
        if (data.puzzleId !== this.puzzleId) return false;
        if (Array.isArray(data.ranges)) {
            this.completedRanges = data.ranges.map(function(r) {
                return [BigInt(r[0]), BigInt(r[1])];
            });
            this._merge();
        }
        if (data.nextClaim) this.nextClaim = BigInt(data.nextClaim);
        this.save();
        return true;
    } catch (e) { return false; }
};

window.BlockTracker = BlockTracker;
