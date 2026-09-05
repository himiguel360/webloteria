// secp256k1 256-bit field arithmetic — 8x u32 little-endian limbs
// No u64: uses vec2<u32> for double-word when needed

const P_LIMBS = array<u32, 8>(
    0xFFFFFC2Fu, 0xFFFFFFFEu, 0xFFFFFFFFu, 0xFFFFFFFFu,
    0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu
);

struct U256 { limbs: array<u32, 8> };
struct U512 { limbs: array<u32, 16> };

fn u256_zero() -> U256 {
    var r: U256;
    for (var i = 0u; i < 8u; i++) { r.limbs[i] = 0u; }
    return r;
}

fn u256_from_u32(v: u32) -> U256 {
    var r = u256_zero();
    r.limbs[0] = v;
    return r;
}

fn u512_zero() -> U512 {
    var r: U512;
    for (var i = 0u; i < 16u; i++) { r.limbs[i] = 0u; }
    return r;
}

// 32x32 -> 64 bit multiply (lo, hi)
fn mul32x32(a: u32, b: u32) -> vec2<u32> {
    let al = a & 0xFFFFu;
    let ah = a >> 16u;
    let bl = b & 0xFFFFu;
    let bh = b >> 16u;
    let ll = al * bl;
    let lh = al * bh;
    let hl = ah * bl;
    let hh = ah * bh;
    let mid = (ll >> 16u) + (lh & 0xFFFFu) + (hl & 0xFFFFu);
    let lo = (ll & 0xFFFFu) | (mid << 16u);
    let hi = hh + (lh >> 16u) + (hl >> 16u) + (mid >> 16u);
    return vec2<u32>(lo, hi);
}

// Double-word add: returns {lo, carry}
fn dw_add(al: u32, ah: u32, bl: u32, bh: u32) -> vec2<u32> {
    let lo = al + bl;
    let c1 = select(0u, 1u, lo < al);
    let hi = ah + bh + c1;
    return vec2<u32>(lo, hi);
}

// Double-word multiply-accumulate: acc += a * b
// acc_lo, acc_hi are in/out
fn dw_mac(acc_lo: u32, acc_hi: u32, a: u32, b: u32) -> vec2<u32> {
    let p = mul32x32(a, b);
    let s = dw_add(acc_lo, acc_hi, p.x, p.y);
    return s;
}

// Schoolbook 256x256 -> 512 multiplication
fn fp_mul_wide(a: U256, b: U256) -> U512 {
    var t = u512_zero();
    for (var i = 0u; i < 8u; i++) {
        var carry: u32 = 0u;
        for (var j = 0u; j < 8u; j++) {
            let prod = mul32x32(a.limbs[i], b.limbs[j]);
            let s1 = t.limbs[i + j] + prod.x;
            let c1 = select(0u, 1u, s1 < t.limbs[i + j]);
            let s2 = s1 + carry;
            let c2 = select(0u, 1u, s2 < s1);
            t.limbs[i + j] = s2;
            carry = prod.y + c1 + c2;
        }
        t.limbs[i + 8] = carry;
    }
    return t;
}

// Add two double-words with carry: r += a*b stored at position k..k+1
fn add_dw_at(t: ptr<function, U512>, k: u32, a: u32, b: u32) {
    let p = mul32x32(a, b);
    let lo = (*t).limbs[k] + p.x;
    let c1 = select(0u, 1u, lo < (*t).limbs[k]);
    (*t).limbs[k] = lo;
    let hi = (*t).limbs[k + 1u] + p.y + c1;
    (*t).limbs[k + 1u] = hi;
}

// Fast reduction mod p = 2^256 - 2^32 - 977
// 2^256 ≡ 2^32 + 977 (mod p)
// result = lo + hi * (2^32 + 977)
//        = lo + hi*977 + hi<<32
fn fp_reduce(t: U512) -> U256 {
    var r: U256;
    var carry: u32 = 0u;
    var c2: u32;
    var s: u32;

    // r = lo
    for (var i = 0u; i < 8u; i++) { r.limbs[i] = t.limbs[i]; }

    // Step 1: Add hi*977 to r[0..3]
    // h0*977
    let p0 = mul32x32(t.limbs[4], 977u);
    s = r.limbs[0] + p0.x;
    c2 = select(0u, 1u, s < r.limbs[0]);
    r.limbs[0] = s;
    var acc_lo = p0.y + c2;

    // h1*977
    let p1 = mul32x32(t.limbs[5], 977u);
    s = r.limbs[1] + p1.x + acc_lo;
    c2 = select(0u, 1u, s < r.limbs[1]);
    let c2b = select(0u, 1u, (r.limbs[1] + p1.x) < r.limbs[1] || s < (r.limbs[1] + p1.x));
    r.limbs[1] = s;
    acc_lo = p1.y + c2b;

    // h2*977
    let p2 = mul32x32(t.limbs[6], 977u);
    s = r.limbs[2] + p2.x + acc_lo;
    c2 = select(0u, 1u, s < r.limbs[2]);
    let c2c = select(0u, 1u, (r.limbs[2] + p2.x) < r.limbs[2] || s < (r.limbs[2] + p2.x));
    r.limbs[2] = s;
    acc_lo = p2.y + c2c;

    // h3*977
    let p3 = mul32x32(t.limbs[7], 977u);
    s = r.limbs[3] + p3.x + acc_lo;
    c2 = select(0u, 1u, s < r.limbs[3]);
    let c2d = select(0u, 1u, (r.limbs[3] + p3.x) < r.limbs[3] || s < (r.limbs[3] + p3.x));
    r.limbs[3] = s;
    carry = p3.y + c2d;

    // Step 2: Add hi<<32 to r[4..7] plus carry
    s = r.limbs[4] + t.limbs[0] + carry;
    c2 = select(0u, 1u, s < r.limbs[4]);
    let c2e = select(0u, 1u, (r.limbs[4] + t.limbs[0]) < r.limbs[4] || s < (r.limbs[4] + t.limbs[0]));
    r.limbs[4] = s;
    carry = c2e;

    s = r.limbs[5] + t.limbs[1] + carry;
    c2 = select(0u, 1u, s < r.limbs[5]);
    let c2f = select(0u, 1u, (r.limbs[5] + t.limbs[1]) < r.limbs[5] || s < (r.limbs[5] + t.limbs[1]));
    r.limbs[5] = s;
    carry = c2f;

    s = r.limbs[6] + t.limbs[2] + carry;
    c2 = select(0u, 1u, s < r.limbs[6]);
    let c2g = select(0u, 1u, (r.limbs[6] + t.limbs[2]) < r.limbs[6] || s < (r.limbs[6] + t.limbs[2]));
    r.limbs[6] = s;
    carry = c2g;

    s = r.limbs[7] + t.limbs[3] + carry;
    c2 = select(0u, 1u, s < r.limbs[7]);
    let c2h = select(0u, 1u, (r.limbs[7] + t.limbs[3]) < r.limbs[7] || s < (r.limbs[7] + t.limbs[3]));
    r.limbs[7] = s;
    carry = c2h;

    // Step 3: Final carry overflow → fold back (carry * (2^32 + 977))
    if (carry != 0u) {
        // carry << 32 + carry * 977
        let p_carry = mul32x32(carry, 977u);
        s = r.limbs[0] + p_carry.x + carry;
        c2 = select(0u, 1u, s < r.limbs[0]);
        r.limbs[0] = s;
        s = r.limbs[1] + p_carry.y + c2;
        c2 = select(0u, 1u, s < r.limbs[1]);
        r.limbs[1] = s;
        s = r.limbs[2] + c2;
        c2 = select(0u, 1u, s < r.limbs[2]);
        r.limbs[2] = s;
        s = r.limbs[3] + c2;
        r.limbs[3] = s;
    }

    // Final conditional subtract of p (at most 2x)
    if (fp_ge_p(r)) { fp_sub_p(&r); }
    if (fp_ge_p(r)) { fp_sub_p(&r); }
    return r;
}

fn fp_add(a: U256, b: U256) -> U256 {
    var carry: u32 = 0u;
    var r: U256;
    for (var i = 0u; i < 8u; i++) {
        let s1 = a.limbs[i] + b.limbs[i];
        let c1 = select(0u, 1u, s1 < a.limbs[i]);
        let s2 = s1 + carry;
        let c2 = select(0u, 1u, s2 < s1);
        r.limbs[i] = s2;
        carry = c1 + c2;
    }
    if (carry != 0u || fp_ge_p(r)) { fp_sub_p(&r); }
    return r;
}

fn fp_sub(a: U256, b: U256) -> U256 {
    var borrow: u32 = 0u;
    var r: U256;
    for (var i = 0u; i < 8u; i++) {
        let ai = a.limbs[i];
        let bi = b.limbs[i] + borrow;
        borrow = select(0u, 1u, ai < bi || (borrow != 0u && bi == 0u));
        r.limbs[i] = ai - bi;
    }
    if (borrow != 0u) {
        var c: u32 = 0u;
        for (var i = 0u; i < 8u; i++) {
            let s = r.limbs[i] + P_LIMBS[i] + c;
            c = select(0u, 1u, s < r.limbs[i] || (c != 0u && s == 0u));
            r.limbs[i] = s;
        }
    }
    return r;
}

fn fp_mul(a: U256, b: U256) -> U256 {
    return fp_reduce(fp_mul_wide(a, b));
}

fn fp_sqr(a: U256) -> U256 {
    return fp_mul(a, a);
}

fn fp_neg(a: U256) -> U256 {
    var borrow: u32 = 0u;
    var r: U256;
    for (var i = 0u; i < 8u; i++) {
        let pi = P_LIMBS[i];
        let ai = a.limbs[i] + borrow;
        borrow = select(0u, 1u, pi < ai || (borrow != 0u && ai == 0u));
        r.limbs[i] = pi - ai;
    }
    return r;
}

fn fp_is_zero(a: U256) -> bool {
    for (var i = 0u; i < 8u; i++) {
        if (a.limbs[i] != 0u) { return false; }
    }
    return true;
}

fn fp_ge_p(a: U256) -> bool {
    for (var i: i32 = 7; i >= 0; i--) {
        if (a.limbs[u32(i)] > P_LIMBS[u32(i)]) { return true; }
        if (a.limbs[u32(i)] < P_LIMBS[u32(i)]) { return false; }
    }
    return true;
}

fn fp_sub_p(r: ptr<function, U256>) {
    var borrow: u32 = 0u;
    for (var i = 0u; i < 8u; i++) {
        let ri = (*r).limbs[i];
        let pi = P_LIMBS[i] + borrow;
        borrow = select(0u, 1u, ri < pi || (borrow != 0u && pi == 0u));
        (*r).limbs[i] = ri - pi;
    }
}

// Fermat's little theorem: a^(p-2) mod p
fn fp_inv(a: U256) -> U256 {
    var x2 = fp_mul(a, u256_from_u32(2u));
    x2 = fp_mul(x2, a);
    var x3 = fp_mul(x2, a);

    var x6 = x3;
    for (var i = 0u; i < 3u; i++) { x6 = fp_sqr(x6); }
    x6 = fp_mul(x6, x3);

    var x9 = x6;
    for (var i = 0u; i < 3u; i++) { x9 = fp_sqr(x9); }
    x9 = fp_mul(x9, x3);

    var x11 = x9;
    for (var i = 0u; i < 2u; i++) { x11 = fp_sqr(x11); }
    x11 = fp_mul(x11, x2);

    var x22 = x11;
    for (var i = 0u; i < 11u; i++) { x22 = fp_sqr(x22); }
    x22 = fp_mul(x22, x11);

    var x44 = x22;
    for (var i = 0u; i < 22u; i++) { x44 = fp_sqr(x44); }
    x44 = fp_mul(x44, x22);

    var x88 = x44;
    for (var i = 0u; i < 44u; i++) { x88 = fp_sqr(x88); }
    x88 = fp_mul(x88, x44);

    var x176 = x88;
    for (var i = 0u; i < 88u; i++) { x176 = fp_sqr(x176); }
    x176 = fp_mul(x176, x88);

    var x220 = x176;
    for (var i = 0u; i < 44u; i++) { x220 = fp_sqr(x220); }
    x220 = fp_mul(x220, x44);

    var x223 = x220;
    for (var i = 0u; i < 3u; i++) { x223 = fp_sqr(x223); }
    x223 = fp_mul(x223, x3);

    var r = x223;
    for (var i = 0u; i < 32u; i++) { r = fp_sqr(r); }
    r = fp_mul(r, x223);
    for (var i = 0u; i < 1u; i++) { r = fp_sqr(r); }
    r = fp_mul(r, a);

    return r;
}
