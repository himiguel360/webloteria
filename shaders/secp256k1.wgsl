// secp256k1 Jacobian point operations
// All points: (X, Y, Z) in Jacobian coordinates, Z=0 means point at infinity
// Negation map: canonicalize to y < p/2 for 1.41x speedup

var<private> _GX_arr: array<u32, 8> = array<u32, 8>(
    0x16F81798u, 0x59F2815Bu, 0x2DCE28D9u, 0x029BFCDBu,
    0xCE870B07u, 0x55A06295u, 0xF9DCBBACu, 0x79BE667Eu
);
var<private> _GY_arr: array<u32, 8> = array<u32, 8>(
    0xFB10D4B8u, 0x9C47D08Fu, 0xA6855419u, 0xFD17B448u,
    0x0E1108A8u, 0x5DA4FBFCu, 0x26A3C465u, 0x483ADA77u
);

fn GX() -> U256 {
    var r: U256;
    for (var i = 0u; i < 8u; i++) { r.limbs[i] = _GX_arr[i]; }
    return r;
}
fn GY() -> U256 {
    var r: U256;
    for (var i = 0u; i < 8u; i++) { r.limbs[i] = _GY_arr[i]; }
    return r;
}

struct JacobianPoint {
    x: U256,
    y: U256,
    z: U256,
};

struct AffinePoint {
    x: U256,
    y: U256,
};

fn jacobian_zero() -> JacobianPoint {
    return JacobianPoint(u256_zero(), u256_zero(), u256_zero());
}

fn jacobian_is_zero(p: JacobianPoint) -> bool {
    return fp_is_zero(p.z);
}

// Point doubling for secp256k1 (a=0)
// Standard dbl-2009-l formulas
fn point_double(p: JacobianPoint) -> JacobianPoint {
    if (jacobian_is_zero(p) || fp_is_zero(p.y)) {
        return jacobian_zero();
    }

    let s = fp_mul(u256_from_u32(4u), fp_mul(p.x, fp_mul(p.y, p.y)));
    let m = fp_mul(u256_from_u32(3u), fp_mul(p.x, p.x)); // 3*X^2 (a=0)
    let x3 = fp_sub(fp_mul(m, m), fp_mul(u256_from_u32(2u), s));
    let y3 = fp_sub(fp_mul(m, fp_sub(s, x3)),
                    fp_mul(u256_from_u32(8u), fp_mul(fp_mul(p.y, p.y), fp_mul(p.y, p.y))));
    let z3 = fp_mul(u256_from_u32(2u), fp_mul(p.y, p.z));

    return JacobianPoint(x3, y3, z3);
}

// Mixed Jacobian + Affine addition (madd-2007-bl)
// Q is affine (Z=1 implied)
fn point_add_mixed(p: JacobianPoint, qx: U256, qy: U256) -> JacobianPoint {
    if (jacobian_is_zero(p)) {
        return JacobianPoint(qx, qy, u256_from_u32(1u));
    }

    let z1z1 = fp_mul(p.z, p.z);
    let u2 = fp_mul(qx, z1z1);
    let s2 = fp_mul(fp_mul(qy, p.z), z1z1);

    let h = fp_sub(u2, p.x);
    let r = fp_sub(s2, p.y);

    if (fp_is_zero(h) && fp_is_zero(r)) {
        return point_double(p);
    }
    if (fp_is_zero(h)) {
        return jacobian_zero(); // P + (-P) = infinity
    }

    let hh = fp_mul(h, h);
    let hhh = fp_mul(hh, h);
    let u1 = fp_mul(p.x, hh);

    let x3 = fp_sub(fp_sub(fp_mul(r, r), u1), fp_mul(u256_from_u32(2u), hh));
    let y3 = fp_sub(fp_mul(r, fp_sub(u1, x3)), fp_mul(p.y, hhh));
    let z3 = fp_mul(p.z, h);

    return JacobianPoint(x3, y3, z3);
}

// Add with precomputed inverse (for negation map + batch inversion)
// inv = 1 / (Px - Qx), no inversion needed
fn point_add_with_inv(px: U256, py: U256, qx: U256, qy: U256, inv: U256) -> AffinePoint {
    let dy = fp_sub(py, qy);
    let lam = fp_mul(dy, inv);
    let lam2 = fp_mul(lam, lam);
    let rx = fp_sub(fp_sub(lam2, px), qx);
    let ry = fp_mul(lam, fp_sub(px, rx));
    let ry_final = fp_sub(ry, py);
    return AffinePoint(rx, ry_final);
}

// Scalar multiplication of generator G (double-and-add, MSB first)
fn scalar_mul_g(k: U256) -> JacobianPoint {
    var result = jacobian_zero();
    var started = false;

    for (var i: i32 = 255; i >= 0; i--) {
        let limb_idx = u32(i) / 32u;
        let bit_idx = u32(i) % 32u;
        let bit = (k.limbs[limb_idx] >> bit_idx) & 1u;

        if (!jacobian_is_zero(result)) {
            result = point_double(result);
        }
        if (bit == 1u) {
            if (!started) {
                result = JacobianPoint(GX(), GY(), u256_from_u32(1u));
                started = true;
            } else {
                result = point_add_mixed(result, GX(), GY());
            }
        }
    }
    return result;
}

// Convert Jacobian to Affine (requires Z inverse)
fn jacobian_to_affine(p: JacobianPoint, z_inv: U256) -> AffinePoint {
    let z_inv2 = fp_mul(z_inv, z_inv);
    let z_inv3 = fp_mul(z_inv2, z_inv);
    let x = fp_mul(p.x, z_inv2);
    let y = fp_mul(p.y, z_inv3);
    return AffinePoint(x, y);
}
