/* ============================================================================
   Weblotery Turbo v2 — crypto helpers
   Pure crypto: base58, hash160, address generation, key formats.
   Uses elliptic.js + CryptoJS on the main thread.
   ========================================================================= */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58ToBigInt(s) {
  let num = 0n;
  for (let i = 0; i < s.length; i++) {
    const idx = ALPHABET.indexOf(s[i]);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  return num;
}

function hexToBase58(hex) {
  const base = 58n;
  let num = BigInt('0x' + hex);
  let encoded = '';
  while (num > 0n) {
    const rem = num % base;
    num = num / base;
    encoded = ALPHABET[Number(rem)] + encoded;
  }
  for (let i = 0; i < hex.length && hex.substring(i, i + 2) === '00'; i += 2) {
    encoded = '1' + encoded;
  }
  return encoded;
}

function addressToHash160(address) {
  const num = base58ToBigInt(address);
  if (num === null) return null;
  let hex = num.toString(16);
  while (hex.length < 50) hex = '0' + hex;
  return hex.substring(2, 42);
}

function generateAddress(privateKeyHex) {
  const keyPair = elliptic.ec('secp256k1').keyFromPrivate(privateKeyHex, 'hex');
  const publicKey = keyPair.getPublic(true, 'hex');
  const sha = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey));
  const ripemd = CryptoJS.RIPEMD160(sha);
  const versioned = '00' + ripemd.toString();
  const checksum = CryptoJS.SHA256(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(versioned))).toString().substring(0, 8);
  return hexToBase58(versioned + checksum);
}

function sha256hex(hex) {
  return CryptoJS.SHA256(CryptoJS.enc.Hex.parse(hex)).toString();
}

function hash160hex(hex) {
  return CryptoJS.RIPEMD160(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(hex))).toString();
}

function privateKeyToWIFCompressed(hex) {
  var h = '80' + hex.padStart(64, '0') + '01';
  var cs = sha256hex(sha256hex(h)).substring(0, 8);
  return hexToBase58(h + cs);
}

function privateKeyToWIFUncompressed(hex) {
  var h = '80' + hex.padStart(64, '0');
  var cs = sha256hex(sha256hex(h)).substring(0, 8);
  return hexToBase58(h + cs);
}

function generateP2SHSegwit(hex) {
  var keyPair = elliptic.ec('secp256k1').keyFromPrivate(hex, 'hex');
  var pubComp = keyPair.getPublic(true, 'hex');
  var h160 = hash160hex(pubComp);
  var redeemScript = '0014' + h160;
  var redeemH160 = hash160hex(redeemScript);
  var h = '05' + redeemH160;
  var cs = sha256hex(sha256hex(h)).substring(0, 8);
  return hexToBase58(h + cs);
}

function generateBech32Address(hex) {
  var keyPair = elliptic.ec('secp256k1').keyFromPrivate(hex, 'hex');
  var pubComp = keyPair.getPublic(true, 'hex');
  var h160 = hash160hex(pubComp);
  var bytes = [];
  for (var i = 0; i < 40; i += 2) bytes.push(parseInt(h160.substr(i, 2), 16));
  var acc = 0, bits = 0;
  var fiveBit = [0];
  for (var i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) { bits -= 5; fiveBit.push((acc >> bits) & 31); }
  }
  if (bits > 0) fiveBit.push((acc << (5 - bits)) & 31);
  var BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  function polymod(values) {
    var GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    var chk = 1;
    for (var i = 0; i < values.length; i++) {
      var b = (chk >> 25);
      chk = (chk & 0x1ffffff) << 5 ^ values[i];
      for (var j = 0; j < 5; j++) chk ^= ((b >> j) & 1) ? GEN[j] : 0;
    }
    return chk;
  }
  function hrpExpand(hrp) {
    var r = [];
    for (var i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) >> 5);
    r.push(0);
    for (var i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) & 31);
    return r;
  }
  var values = hrpExpand('bc').concat(fiveBit).concat([0,0,0,0,0,0]);
  var pm = polymod(values) ^ 1;
  var c = [];
  for (var i = 0; i < 6; i++) c.push((pm >> 5 * (5 - i)) & 31);
  var s = 'bc1';
  for (var i = 0; i < fiveBit.length; i++) s += BECH32_CHARSET[fiveBit[i]];
  for (var i = 0; i < c.length; i++) s += BECH32_CHARSET[c[i]];
  return s;
}

function generateAllFormats(privateKeyHex) {
  var h = privateKeyHex.padStart(64, '0');
  var keyPair = elliptic.ec('secp256k1').keyFromPrivate(h, 'hex');
  var pubComp = keyPair.getPublic(true, 'hex');
  var pubUncomp = keyPair.getPublic(false, 'hex');
  var h160 = hash160hex(pubComp);
  return {
    hex: h,
    wifC: privateKeyToWIFCompressed(h),
    wifU: privateKeyToWIFUncompressed(h),
    address: generateAddress(h),
    p2sh: generateP2SHSegwit(h),
    bech32: generateBech32Address(h),
    h160: h160,
    pubComp: pubComp,
    pubUncomp: pubUncomp
  };
}

function renderKeyFormats(hexKey, targetAddr) {
  try {
    var f = generateAllFormats(hexKey);
    var matchAddr = targetAddr || '';
    function cls(field) { return (matchAddr && f[field] === matchAddr) ? ' kf-match' : ''; }
    var rows = [
      ['HEX', f.hex, 'hex'],
      ['WIF-C', f.wifC, 'wifC'],
      ['WIF-U', f.wifU, 'wifU'],
      ['P2PKH', f.address, 'address'],
      ['P2SH', f.p2sh, 'p2sh'],
      ['Bech32', f.bech32, 'bech32'],
      ['H160', f.h160, 'h160'],
    ];
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="kf-row"><span class="kf-label">' + rows[i][0] + '</span><span class="kf-val' + cls(rows[i][2]) + '">' + rows[i][1] + '</span></div>';
    }
    return html;
  } catch(e) {
    return '<div class="kf-row"><span class="kf-val">' + hexKey + '</span></div>';
  }
}

function fmtElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return (h > 0 ? h + ':' : '') + m + ':' + s;
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}
