// WebGPU Turbo Pipeline v2 — Universal browser support
// Triple-buffered dispatch, WASM scalarMul precompute, auto-scaling workgroups
// Compatibility mode for older GPUs, subgroups detection, adaptive workgroup sizing
// Shaders embedded inline — no fetch() needed (COEP-safe)

const WGSL_BIGINT = `// secp256k1 256-bit field arithmetic — 8x u32 little-endian limbs
const P_LIMBS = array<u32, 8>(0xFFFFFC2Fu, 0xFFFFFFFEu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu);
struct U256 { limbs: array<u32, 8> };
struct U512 { limbs: array<u32, 16> };
fn u256_zero() -> U256 { var r: U256; for (var i = 0u; i < 8u; i++) { r.limbs[i] = 0u; } return r; }
fn u256_from_u32(v: u32) -> U256 { var r = u256_zero(); r.limbs[0] = v; return r; }
fn u512_zero() -> U512 { var r: U512; for (var i = 0u; i < 16u; i++) { r.limbs[i] = 0u; } return r; }
fn mul32x32(a: u32, b: u32) -> vec2<u32> { let al = a & 0xFFFFu; let ah = a >> 16u; let bl = b & 0xFFFFu; let bh = b >> 16u; let ll = al * bl; let lh = al * bh; let hl = ah * bl; let hh = ah * bh; let mid = (ll >> 16u) + (lh & 0xFFFFu) + (hl & 0xFFFFu); let lo = (ll & 0xFFFFu) | (mid << 16u); let hi = hh + (lh >> 16u) + (hl >> 16u) + (mid >> 16u); return vec2<u32>(lo, hi); }
fn dw_add(al: u32, ah: u32, bl: u32, bh: u32) -> vec2<u32> { let lo = al + bl; let c1 = select(0u, 1u, lo < al); let hi = ah + bh + c1; return vec2<u32>(lo, hi); }
fn dw_mac(acc_lo: u32, acc_hi: u32, a: u32, b: u32) -> vec2<u32> { let p = mul32x32(a, b); let s = dw_add(acc_lo, acc_hi, p.x, p.y); return s; }
fn fp_mul_wide(a: U256, b: U256) -> U512 { var t = u512_zero(); for (var i = 0u; i < 8u; i++) { var carry: u32 = 0u; for (var j = 0u; j < 8u; j++) { let prod = mul32x32(a.limbs[i], b.limbs[j]); let s1 = t.limbs[i + j] + prod.x; let c1 = select(0u, 1u, s1 < t.limbs[i + j]); let s2 = s1 + carry; let c2 = select(0u, 1u, s2 < s1); t.limbs[i + j] = s2; carry = prod.y + c1 + c2; } t.limbs[i + 8] = carry; } return t; }
fn add_dw_at(t: ptr<function, U512>, k: u32, a: u32, b: u32) { let p = mul32x32(a, b); let lo = (*t).limbs[k] + p.x; let c1 = select(0u, 1u, lo < (*t).limbs[k]); (*t).limbs[k] = lo; let hi = (*t).limbs[k + 1u] + p.y + c1; (*t).limbs[k + 1u] = hi; }
fn fp_reduce(t: U512) -> U256 { var r: U256; var carry: u32 = 0u; var c2: u32; var s: u32; for (var i = 0u; i < 8u; i++) { r.limbs[i] = t.limbs[i]; } let p0 = mul32x32(t.limbs[4], 977u); s = r.limbs[0] + p0.x; c2 = select(0u, 1u, s < r.limbs[0]); r.limbs[0] = s; var acc_lo = p0.y + c2; let p1 = mul32x32(t.limbs[5], 977u); s = r.limbs[1] + p1.x + acc_lo; c2 = select(0u, 1u, s < r.limbs[1]); let c2b = select(0u, 1u, (r.limbs[1] + p1.x) < r.limbs[1] || s < (r.limbs[1] + p1.x)); r.limbs[1] = s; acc_lo = p1.y + c2b; let p2 = mul32x32(t.limbs[6], 977u); s = r.limbs[2] + p2.x + acc_lo; c2 = select(0u, 1u, s < r.limbs[2]); let c2c = select(0u, 1u, (r.limbs[2] + p2.x) < r.limbs[2] || s < (r.limbs[2] + p2.x)); r.limbs[2] = s; acc_lo = p2.y + c2c; let p3 = mul32x32(t.limbs[7], 977u); s = r.limbs[3] + p3.x + acc_lo; c2 = select(0u, 1u, s < r.limbs[3]); let c2d = select(0u, 1u, (r.limbs[3] + p3.x) < r.limbs[3] || s < (r.limbs[3] + p3.x)); r.limbs[3] = s; carry = p3.y + c2d; s = r.limbs[4] + t.limbs[0] + carry; c2 = select(0u, 1u, s < r.limbs[4]); let c2e = select(0u, 1u, (r.limbs[4] + t.limbs[0]) < r.limbs[4] || s < (r.limbs[4] + t.limbs[0])); r.limbs[4] = s; carry = c2e; s = r.limbs[5] + t.limbs[1] + carry; c2 = select(0u, 1u, s < r.limbs[5]); let c2f = select(0u, 1u, (r.limbs[5] + t.limbs[1]) < r.limbs[5] || s < (r.limbs[5] + t.limbs[1])); r.limbs[5] = s; carry = c2f; s = r.limbs[6] + t.limbs[2] + carry; c2 = select(0u, 1u, s < r.limbs[6]); let c2g = select(0u, 1u, (r.limbs[6] + t.limbs[2]) < r.limbs[6] || s < (r.limbs[6] + t.limbs[2])); r.limbs[6] = s; carry = c2g; s = r.limbs[7] + t.limbs[3] + carry; c2 = select(0u, 1u, s < r.limbs[7]); let c2h = select(0u, 1u, (r.limbs[7] + t.limbs[3]) < r.limbs[7] || s < (r.limbs[7] + t.limbs[3])); r.limbs[7] = s; carry = c2h; if (carry != 0u) { let p_carry = mul32x32(carry, 977u); s = r.limbs[0] + p_carry.x + carry; c2 = select(0u, 1u, s < r.limbs[0]); r.limbs[0] = s; s = r.limbs[1] + p_carry.y + c2; c2 = select(0u, 1u, s < r.limbs[1]); r.limbs[1] = s; s = r.limbs[2] + c2; c2 = select(0u, 1u, s < r.limbs[2]); r.limbs[2] = s; s = r.limbs[3] + c2; r.limbs[3] = s; } if (fp_ge_p(r)) { fp_sub_p(&r); } if (fp_ge_p(r)) { fp_sub_p(&r); } return r; }
fn fp_add(a: U256, b: U256) -> U256 { var carry: u32 = 0u; var r: U256; for (var i = 0u; i < 8u; i++) { let s1 = a.limbs[i] + b.limbs[i]; let c1 = select(0u, 1u, s1 < a.limbs[i]); let s2 = s1 + carry; let c2 = select(0u, 1u, s2 < s1); r.limbs[i] = s2; carry = c1 + c2; } if (carry != 0u || fp_ge_p(r)) { fp_sub_p(&r); } return r; }
fn fp_sub(a: U256, b: U256) -> U256 { var borrow: u32 = 0u; var r: U256; for (var i = 0u; i < 8u; i++) { let ai = a.limbs[i]; let bi = b.limbs[i] + borrow; borrow = select(0u, 1u, ai < bi || (borrow != 0u && bi == 0u)); r.limbs[i] = ai - bi; } if (borrow != 0u) { var c: u32 = 0u; for (var i = 0u; i < 8u; i++) { let s = r.limbs[i] + P_LIMBS[i] + c; c = select(0u, 1u, s < r.limbs[i] || (c != 0u && s == 0u)); r.limbs[i] = s; } } return r; }
fn fp_mul(a: U256, b: U256) -> U256 { return fp_reduce(fp_mul_wide(a, b)); }
fn fp_sqr(a: U256) -> U256 { return fp_mul(a, a); }
fn fp_neg(a: U256) -> U256 { var borrow: u32 = 0u; var r: U256; for (var i = 0u; i < 8u; i++) { let pi = P_LIMBS[i]; let ai = a.limbs[i] + borrow; borrow = select(0u, 1u, pi < ai || (borrow != 0u && ai == 0u)); r.limbs[i] = pi - ai; } return r; }
fn fp_is_zero(a: U256) -> bool { for (var i = 0u; i < 8u; i++) { if (a.limbs[i] != 0u) { return false; } } return true; }
fn fp_ge_p(a: U256) -> bool { for (var i: i32 = 7; i >= 0; i--) { if (a.limbs[u32(i)] > P_LIMBS[u32(i)]) { return true; } if (a.limbs[u32(i)] < P_LIMBS[u32(i)]) { return false; } } return true; }
fn fp_sub_p(r: ptr<function, U256>) { var borrow: u32 = 0u; for (var i = 0u; i < 8u; i++) { let ri = (*r).limbs[i]; let pi = P_LIMBS[i] + borrow; borrow = select(0u, 1u, ri < pi || (borrow != 0u && pi == 0u)); (*r).limbs[i] = ri - pi; } }
fn fp_inv(a: U256) -> U256 { var x2 = fp_mul(a, u256_from_u32(2u)); x2 = fp_mul(x2, a); var x3 = fp_mul(x2, a); var x6 = x3; for (var i = 0u; i < 3u; i++) { x6 = fp_sqr(x6); } x6 = fp_mul(x6, x3); var x9 = x6; for (var i = 0u; i < 3u; i++) { x9 = fp_sqr(x9); } x9 = fp_mul(x9, x3); var x11 = x9; for (var i = 0u; i < 2u; i++) { x11 = fp_sqr(x11); } x11 = fp_mul(x11, x2); var x22 = x11; for (var i = 0u; i < 11u; i++) { x22 = fp_sqr(x22); } x22 = fp_mul(x22, x11); var x44 = x22; for (var i = 0u; i < 22u; i++) { x44 = fp_sqr(x44); } x44 = fp_mul(x44, x22); var x88 = x44; for (var i = 0u; i < 44u; i++) { x88 = fp_sqr(x88); } x88 = fp_mul(x88, x44); var x176 = x88; for (var i = 0u; i < 88u; i++) { x176 = fp_sqr(x176); } x176 = fp_mul(x176, x88); var x220 = x176; for (var i = 0u; i < 44u; i++) { x220 = fp_sqr(x220); } x220 = fp_mul(x220, x44); var x223 = x220; for (var i = 0u; i < 3u; i++) { x223 = fp_sqr(x223); } x223 = fp_mul(x223, x3); var r = x223; for (var i = 0u; i < 32u; i++) { r = fp_sqr(r); } r = fp_mul(r, x223); for (var i = 0u; i < 1u; i++) { r = fp_sqr(r); } r = fp_mul(r, a); return r; }`;

const WGSL_SECP256K1 = `var<private> _GX_arr: array<u32, 8> = array<u32, 8>(0x16F81798u, 0x59F2815Bu, 0x2DCE28D9u, 0x029BFCDBu, 0xCE870B07u, 0x55A06295u, 0xF9DCBBACu, 0x79BE667Eu);
var<private> _GY_arr: array<u32, 8> = array<u32, 8>(0xFB10D4B8u, 0x9C47D08Fu, 0xA6855419u, 0xFD17B448u, 0x0E1108A8u, 0x5DA4FBFCu, 0x26A3C465u, 0x483ADA77u);
fn GX() -> U256 { var r: U256; for (var i = 0u; i < 8u; i++) { r.limbs[i] = _GX_arr[i]; } return r; }
fn GY() -> U256 { var r: U256; for (var i = 0u; i < 8u; i++) { r.limbs[i] = _GY_arr[i]; } return r; }
struct JacobianPoint { x: U256, y: U256, z: U256, };
struct AffinePoint { x: U256, y: U256, };
fn jacobian_zero() -> JacobianPoint { return JacobianPoint(u256_zero(), u256_zero(), u256_zero()); }
fn jacobian_is_zero(p: JacobianPoint) -> bool { return fp_is_zero(p.z); }
fn point_double(p: JacobianPoint) -> JacobianPoint { if (jacobian_is_zero(p) || fp_is_zero(p.y)) { return jacobian_zero(); } let s = fp_mul(u256_from_u32(4u), fp_mul(p.x, fp_mul(p.y, p.y))); let m = fp_mul(u256_from_u32(3u), fp_mul(p.x, p.x)); let x3 = fp_sub(fp_mul(m, m), fp_mul(u256_from_u32(2u), s)); let y3 = fp_sub(fp_mul(m, fp_sub(s, x3)), fp_mul(u256_from_u32(8u), fp_mul(fp_mul(p.y, p.y), fp_mul(p.y, p.y)))); let z3 = fp_mul(u256_from_u32(2u), fp_mul(p.y, p.z)); return JacobianPoint(x3, y3, z3); }
fn point_add_mixed(p: JacobianPoint, qx: U256, qy: U256) -> JacobianPoint { if (jacobian_is_zero(p)) { return JacobianPoint(qx, qy, u256_from_u32(1u)); } let z1z1 = fp_mul(p.z, p.z); let u2 = fp_mul(qx, z1z1); let s2 = fp_mul(fp_mul(qy, p.z), z1z1); let h = fp_sub(u2, p.x); let r = fp_sub(s2, p.y); if (fp_is_zero(h) && fp_is_zero(r)) { return point_double(p); } if (fp_is_zero(h)) { return jacobian_zero(); } let hh = fp_mul(h, h); let hhh = fp_mul(hh, h); let u1 = fp_mul(p.x, hh); let x3 = fp_sub(fp_sub(fp_mul(r, r), u1), fp_mul(u256_from_u32(2u), hh)); let y3 = fp_sub(fp_mul(r, fp_sub(u1, x3)), fp_mul(p.y, hhh)); let z3 = fp_mul(p.z, h); return JacobianPoint(x3, y3, z3); }
fn point_add_with_inv(px: U256, py: U256, qx: U256, qy: U256, inv: U256) -> AffinePoint { let dy = fp_sub(py, qy); let lam = fp_mul(dy, inv); let lam2 = fp_mul(lam, lam); let rx = fp_sub(fp_sub(lam2, px), qx); let ry = fp_mul(lam, fp_sub(px, rx)); let ry_final = fp_sub(ry, py); return AffinePoint(rx, ry_final); }
fn scalar_mul_g(k: U256) -> JacobianPoint { var result = jacobian_zero(); var started = false; for (var i: i32 = 255; i >= 0; i--) { let limb_idx = u32(i) / 32u; let bit_idx = u32(i) % 32u; let bit = (k.limbs[limb_idx] >> bit_idx) & 1u; if (!jacobian_is_zero(result)) { result = point_double(result); } if (bit == 1u) { if (!started) { result = JacobianPoint(GX(), GY(), u256_from_u32(1u)); started = true; } else { result = point_add_mixed(result, GX(), GY()); } } } return result; }
fn jacobian_to_affine(p: JacobianPoint, z_inv: U256) -> AffinePoint { let z_inv2 = fp_mul(z_inv, z_inv); let z_inv3 = fp_mul(z_inv2, z_inv); let x = fp_mul(p.x, z_inv2); let y = fp_mul(p.y, z_inv3); return AffinePoint(x, y); }`;

const WGSL_SHA256 = `const SHA_K = array<u32, 64>(0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau, 0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u, 0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u);
const SHA_H0 = array<u32, 8>(0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au, 0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u);
fn rotr32(x: u32, n: u32) -> u32 { return (x >> n) | (x << (32u - n)); }
fn ch(x: u32, y: u32, z: u32) -> u32 { return (x & y) ^ (~x & z); }
fn maj(x: u32, y: u32, z: u32) -> u32 { return (x & y) ^ (x & z) ^ (y & z); }
fn ep0(x: u32) -> u32 { return rotr32(x, 2u) ^ rotr32(x, 13u) ^ rotr32(x, 22u); }
fn ep1(x: u32) -> u32 { return rotr32(x, 6u) ^ rotr32(x, 11u) ^ rotr32(x, 25u); }
fn sig0(x: u32) -> u32 { return rotr32(x, 7u) ^ rotr32(x, 18u) ^ (x >> 3u); }
fn sig1(x: u32) -> u32 { return rotr32(x, 17u) ^ rotr32(x, 19u) ^ (x >> 10u); }
fn sha256_pubkey(x_aff: U256, prefix: u32) -> array<u32, 8> { var W = array<u32, 16>(); W[0] = (prefix << 24u) | (x_aff.limbs[7] >> 8u); W[1] = (x_aff.limbs[7] << 24u) | (x_aff.limbs[6] >> 8u); W[2] = (x_aff.limbs[6] << 24u) | (x_aff.limbs[5] >> 8u); W[3] = (x_aff.limbs[5] << 24u) | (x_aff.limbs[4] >> 8u); W[4] = (x_aff.limbs[4] << 24u) | (x_aff.limbs[3] >> 8u); W[5] = (x_aff.limbs[3] << 24u) | (x_aff.limbs[2] >> 8u); W[6] = (x_aff.limbs[2] << 24u) | (x_aff.limbs[1] >> 8u); W[7] = (x_aff.limbs[1] << 24u) | (x_aff.limbs[0] >> 8u); W[8] = (x_aff.limbs[0] << 24u) | 0x00800000u; W[9] = 0u; W[10] = 0u; W[11] = 0u; W[12] = 0u; W[13] = 0u; W[14] = 0u; W[15] = 0x00000108u; var a = SHA_H0[0]; var b = SHA_H0[1]; var c = SHA_H0[2]; var d = SHA_H0[3]; var e = SHA_H0[4]; var f = SHA_H0[5]; var g = SHA_H0[6]; var h = SHA_H0[7]; for (var i = 0u; i < 64u; i++) { var wi: u32; if (i < 16u) { wi = W[i]; } else { wi = W[i & 15u] + sig0(W[(i + 1u) & 15u]) + W[(i + 9u) & 15u] + sig1(W[(i + 14u) & 15u]); W[i & 15u] = wi; } let t1 = h + ep1(e) + ch(e, f, g) + SHA_K[i] + wi; let t2 = ep0(a) + maj(a, b, c); h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2; } var state = array<u32, 8>(); state[0] = SHA_H0[0] + a; state[1] = SHA_H0[1] + b; state[2] = SHA_H0[2] + c; state[3] = SHA_H0[3] + d; state[4] = SHA_H0[4] + e; state[5] = SHA_H0[5] + f; state[6] = SHA_H0[6] + g; state[7] = SHA_H0[7] + h; return state; }`;

const WGSL_RIPEMD160 = `const RM_KL = array<u32, 5>(0x00000000u, 0x5A827999u, 0x6ED9EBA1u, 0x8F1BBCDCu, 0xA953FD4E);
const RM_KR = array<u32, 5>(0x50A28BE6u, 0x5C4DD124u, 0x6D703EF3u, 0x7A6D76E9u, 0x00000000u);
const RM_RL = array<u32, 80>(0u,1u,2u,3u,4u,5u,6u,7u,8u,9u,10u,11u,12u,13u,14u,15u,7u,4u,13u,1u,10u,6u,15u,3u,12u,0u,9u,5u,2u,14u,11u,8u,3u,10u,14u,4u,9u,15u,8u,1u,2u,7u,0u,6u,13u,11u,5u,12u,1u,9u,11u,10u,0u,8u,12u,4u,13u,3u,7u,15u,14u,5u,6u,2u,4u,0u,5u,9u,7u,12u,2u,10u,14u,1u,3u,8u,11u,6u,15u,13u);
const RM_RR = array<u32, 80>(5u,14u,7u,0u,9u,2u,11u,4u,13u,6u,15u,8u,1u,10u,3u,12u,6u,11u,3u,7u,0u,13u,5u,10u,14u,15u,8u,12u,4u,9u,1u,2u,15u,5u,1u,3u,7u,14u,6u,9u,11u,8u,12u,2u,10u,0u,4u,13u,8u,6u,4u,1u,3u,11u,15u,0u,5u,12u,2u,13u,9u,7u,10u,14u,12u,15u,10u,4u,1u,5u,8u,7u,6u,2u,13u,14u,0u,3u,9u,11u);
const RM_SL = array<u32, 80>(11u,14u,15u,12u,5u,8u,7u,9u,11u,13u,14u,15u,6u,7u,9u,8u,7u,6u,8u,13u,11u,9u,7u,15u,7u,12u,15u,9u,11u,7u,13u,12u,11u,13u,6u,7u,14u,9u,13u,15u,14u,8u,13u,6u,5u,12u,7u,5u,11u,12u,14u,15u,14u,15u,9u,8u,9u,14u,5u,6u,8u,6u,5u,12u,9u,15u,5u,11u,6u,8u,13u,12u,5u,12u,13u,14u,11u,8u,5u,6u);
const RM_SR = array<u32, 80>(8u,9u,9u,11u,13u,15u,15u,5u,7u,7u,8u,11u,14u,14u,12u,6u,9u,13u,15u,7u,12u,8u,9u,11u,7u,7u,12u,7u,6u,15u,13u,11u,9u,7u,15u,11u,8u,6u,6u,14u,12u,13u,5u,14u,13u,13u,7u,5u,15u,5u,8u,11u,14u,14u,6u,14u,6u,9u,12u,9u,12u,5u,15u,8u,8u,5u,12u,9u,12u,5u,14u,6u,8u,13u,6u,5u,15u,13u,11u,11u);
fn rm_f(round: u32, x: u32, y: u32, z: u32) -> u32 { if (round == 0u) { return x ^ y ^ z; } if (round == 1u) { return (x & y) | (~x & z); } if (round == 2u) { return (x | ~y) ^ z; } if (round == 3u) { return (x & z) | (y & ~z); } return x ^ (y | ~z); }
fn ripemd160_compress(state: ptr<function, array<u32, 5>>, block: array<u32, 16>) { var al = state[0]; var bl = state[1]; var cl = state[2]; var dl = state[3]; var el = state[4]; var ar = al; var br = bl; var cr = cl; var dr = dl; var er = el; for (var j = 0u; j < 80u; j++) { let rl_idx = RM_RL[j]; let rr_idx = RM_RR[j]; let sl = RM_SL[j]; let sr = RM_SR[j]; let kl_idx = j / 16u; let kr_idx = 4u - (j / 16u); var t = al + rm_f(kl_idx, bl, cl, dl) + block[rl_idx] + RM_KL[kl_idx]; t = (t << sl) | (t >> (32u - sl)); t += el; al = el; el = dl; dl = (cl << 10u) | (cl >> 22u); cl = bl; bl = t; t = ar + rm_f(kr_idx, br, cr, dr) + block[rr_idx] + RM_KR[kr_idx]; t = (t << sr) | (t >> (32u - sr)); t += er; ar = er; er = dr; dr = (cr << 10u) | (cr >> 22u); cr = br; br = t; } let t = (*state)[1] + cl + dr; (*state)[1] = (*state)[2] + dl + er; (*state)[2] = (*state)[3] + el + ar; (*state)[3] = (*state)[4] + al + br; (*state)[4] = (*state)[0] + bl + cr; (*state)[0] = t; }
fn ripemd160_from_sha(sha_out: array<u32, 8>) -> array<u32, 5> { var block = array<u32, 16>(); for (var i = 0u; i < 8u; i++) { let w = sha_out[i]; block[i] = ((w & 0xFF000000u) >> 24u) | ((w & 0x00FF0000u) >> 8u) | ((w & 0x0000FF00u) << 8u) | ((w & 0x000000FFu) << 24u); } block[8] = 0x00000080u; for (var i = 9u; i < 14u; i++) { block[i] = 0u; } block[14] = 0x00000100u; block[15] = 0u; var state = array<u32, 5>(0x67452301u, 0xEFCDAB89u, 0x98BADCFEu, 0x10325476u, 0xC3D2E1F0u); ripemd160_compress(&state, block); return state; }`;

const WGSL_SEARCH = `const BATCH_SIZE: u32 = 64u;
struct SearchParams { base_x: array<u32, 8>, base_y: array<u32, 8>, target_hash: array<u32, 5>, keys_per_thread: u32, padding: u32, };
struct FoundResult { thread_id: u32, key_offset: u32, };
struct Output { found_count: atomic<u32>, results: array<FoundResult, 32>, };
@group(0) @binding(0) var<uniform> params: SearchParams;
@group(0) @binding(1) var<storage, read_write> output: Output;
fn u256_load_x(v0: u32, v1: u32, v2: u32, v3: u32, v4: u32, v5: u32, v6: u32, v7: u32) -> U256 { var r: U256; r.limbs[0] = v0; r.limbs[1] = v1; r.limbs[2] = v2; r.limbs[3] = v3; r.limbs[4] = v4; r.limbs[5] = v5; r.limbs[6] = v6; r.limbs[7] = v7; return r; }
fn hash160(x: U256, y: U256) -> array<u32, 5> { let prefix = select(0x03u, 0x02u, (y.limbs[0] & 1u) == 0u); let sha = sha256_pubkey(x, prefix); return ripemd160_from_sha(sha); }
fn hash_matches(h: array<u32, 5>, t: array<u32, 5>) -> bool { return h[0] == t[0] && h[1] == t[1] && h[2] == t[2] && h[3] == t[3] && h[4] == t[4]; }
@compute @workgroup_size(64)
fn search(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) { let tid = gid.x; var base_x = u256_load_x(params.base_x[0], params.base_x[1], params.base_x[2], params.base_x[3], params.base_x[4], params.base_x[5], params.base_x[6], params.base_x[7]); var base_y = u256_load_x(params.base_y[0], params.base_y[1], params.base_y[2], params.base_y[3], params.base_y[4], params.base_y[5], params.base_y[6], params.base_y[7]); var tgt: array<u32, 5>; for (var i = 0u; i < 5u; i++) { tgt[i] = params.target_hash[i]; } var cx = base_x; var cy = base_y; var cz = u256_from_u32(1u); var zs: array<U256, 64>; var xs: array<U256, 64>; var ys: array<U256, 64>; for (var k = 0u; k < BATCH_SIZE; k++) { xs[k] = cx; ys[k] = cy; zs[k] = cz; let pt = point_add_mixed(JacobianPoint(cx, cy, cz), GX(), GY()); cx = pt.x; cy = pt.y; cz = pt.z; } var prefix_prod: array<U256, 64>; prefix_prod[0] = zs[0]; for (var k = 1u; k < BATCH_SIZE; k++) { prefix_prod[k] = fp_mul(prefix_prod[k - 1u], zs[k]); } var inv = fp_inv(prefix_prod[BATCH_SIZE - 1u]); var invz: array<U256, 64>; for (var k = BATCH_SIZE; k >= 1u; k--) { let kk = k - 1u; if (kk > 0u) { invz[kk] = fp_mul(inv, prefix_prod[kk - 1u]); inv = fp_mul(inv, zs[kk]); } else { invz[0] = inv; } } for (var k = 0u; k < BATCH_SIZE; k++) { let z2 = fp_mul(invz[k], invz[k]); let z3 = fp_mul(z2, invz[k]); let x_aff = fp_mul(xs[k], z2); let y_aff = fp_mul(ys[k], z3); let prefix = select(0x03u, 0x02u, (y_aff.limbs[0] & 1u) == 0u); let sha = sha256_pubkey(x_aff, prefix); let h = ripemd160_from_sha(sha); if (hash_matches(h, tgt)) { let idx = atomicAdd(&output.found_count, 1u); if (idx < 32u) { output.results[idx] = FoundResult(tid, k); } return; } } }`;

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
    let bufs = [{}, {}, {}]; // v2: triple buffer for better latency hiding
    let bufIdx = 0;

    let WORKGROUP_SIZE = 64;
    let BATCH_SIZE = 48;
    let keysPerDispatch = WORKGROUP_SIZE * BATCH_SIZE * 48;
    let maxWorkgroups = 65535;

    // WASM precompute instance (replaces elliptic.js)
    let wasmInst = null;
    let wasmDv = null;

    const GPU_PROFILES = {
        'nvidia':   { workgroupSize: 64, batchSize: 64, maxWorkgroups: 65535 },
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
            // Try core mode first, then compatibility mode for broader support
            adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
            if (!adapter) adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
            if (!adapter) adapter = await navigator.gpu.requestAdapter();
            // Try compatibility mode for older GPUs (OpenGL ES 3.1 / DX11)
            if (!adapter) {
                try {
                    adapter = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' });
                } catch (e) {}
            }
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

            // Detect underlying graphics API
            let api = 'unknown';
            const desc = ((adapterInfo.description || '') + ' ' + (adapterInfo.architecture || '')).toLowerCase();
            if (desc.includes('vulkan') || desc.includes('mesa') || desc.includes('radv') || desc.includes('swiftshader')) api = 'Vulkan';
            else if (desc.includes('d3d') || desc.includes('direct') || desc.includes('dx12')) api = 'Direct3D 12';
            else if (desc.includes('metal') || desc.includes('apple')) api = 'Metal';
            else if (desc.includes('opengl') || desc.includes('angle')) api = 'OpenGL ES (via ANGLE)';
            else {
                const ua = navigator.userAgent.toLowerCase();
                const pf = (navigator.platform || '').toLowerCase();
                if (pf.includes('linux') || ua.includes('linux')) api = 'Vulkan (Mesa)';
                else if (pf.includes('mac') || ua.includes('mac')) api = 'Metal';
                else if (ua.includes('windows') || pf.includes('win')) api = 'Direct3D 12';
                else if (ua.includes('android')) api = 'Vulkan';
            }
            adapterInfo.graphicsApi = api;

            // Scale max workgroups based on GPU limits
            if (adapter.limits && adapter.limits.maxComputeWorkgroupsPerDimension) {
                maxWorkgroups = adapter.limits.maxComputeWorkgroupsPerDimension;
            } else {
                maxWorkgroups = gpuProfile.maxWorkgroups;
            }

            // Auto-scale keys per dispatch for high-end GPUs
            const baseKeys = WORKGROUP_SIZE * BATCH_SIZE;
            keysPerDispatch = Math.max(baseKeys * 48, keysPerDispatch);
            if (vendor === 'nvidia') {
                keysPerDispatch = Math.max(baseKeys * 128, keysPerDispatch);
            }

            const opts = {};
            device = await adapter.requestDevice(opts);
            device.lost.then(info => {
                console.warn('[WebGPU] Device lost:', info.message);
                if (gpuRunning) recover();
            });

            restoreCalibration();

            // Init WASM precompute
            if (sharedModule) initWasmPrecompute(sharedModule);

            // Detect subgroups feature for potential optimizations
            let hasSubgroups = false;
            try {
                if (adapter.features && typeof adapter.features.has === 'function') {
                    hasSubgroups = adapter.features.has('subgroups');
                }
            } catch (e) {}

            console.log('[WebGPU] Detected:', vendor, '| API:', api || 'unknown', '| WG:', WORKGROUP_SIZE, '| Batch:', BATCH_SIZE,
                '| MaxWG:', maxWorkgroups, '| Keys/dispatch:', keysPerDispatch,
                '| Vendor:', adapterInfo.vendor, '| Arch:', adapterInfo.architecture,
                '| Subgroups:', hasSubgroups);
            return true;
        } catch (e) {
            console.warn('[WebGPU] Init failed:', e);
            return false;
        }
    }

    async function setup() {
        if (!device) return false;
        try {
            const fullWGSL = WGSL_BIGINT + '\n' + WGSL_SECP256K1 + '\n' + WGSL_SHA256 + '\n' + WGSL_RIPEMD160 + '\n' + WGSL_SEARCH;

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

            // Create triple-buffer set for latency hiding
            for (let i = 0; i < 3; i++) {
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

        // Pipelined loop: submit N+1 while reading N-1 (triple buffer)
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
                const prevBuf = bufs[(bufIdx + 2) % 3]; // 2 back in triple buffer
                prevHits = await readResults(prevBuf);
                const elapsed = performance.now() - t0;
                calibrate(elapsed);

                if (prevHits.length > 0) {
                    for (const hit of prevHits) {
                        const hitKey = prevStartKey + BigInt(hit.keyOffset);
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

            // Swap buffers (triple buffer: 0→1→2→0)
            bufIdx = (bufIdx + 1) % 3;

            // Recalculate keysCovered after calibration
            const np = partition(keysPerDispatch);
            keysCovered = BigInt(np.workgroups * WORKGROUP_SIZE * np.keysPerThread);

            // Yield to event loop
            await new Promise(r => setTimeout(r, 0));
        }

        // Read final pending dispatch
        if (dispatchCount > 0) {
            const finalBuf = bufs[(bufIdx + 2) % 3];
            try {
                await finalBuf.read.mapAsync(GPUMapMode.READ);
                const d = new DataView(finalBuf.read.getMappedRange());
                const count = Math.min(d.getUint32(0, true), 32);
                const lastKey = currentKey - keysCovered;
                for (let i = 0; i < count; i++) {
                    const off = 4 + i * 8;
                    const threadId = d.getUint32(off, true);
                    const keyOffset = d.getUint32(off + 4, true);
                    const hitKey = lastKey + BigInt(keyOffset);
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
            if (!adapter) {
                try { adapter = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' }); } catch (e) {}
            }
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
            graphicsApi: adapterInfo.graphicsApi || 'unknown',
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
