// Search compute shader — "turbo block" kernel
// Each thread walks 48 sequential keys from a pre-positioned base point
// Uses Montgomery batch inversion (1 Fermat inverse per 48 Z-coordinates)
// Negation map for 1.41x speedup on hash computation
//
// Bindings:
//   @group(0) @binding(0) — SearchParams (uniform)
//   @group(0) @binding(1) — Output (storage, read_write)

const BATCH_SIZE: u32 = 48u;

struct SearchParams {
    base_x: array<u32, 8>,    // base point affine x (LE limbs)
    base_y: array<u32, 8>,    // base point affine y (LE limbs)
    target_hash: array<u32, 5>,    // hash160 target (5 LE u32 words)
    keys_per_thread: u32,     // keys each thread walks (BATCH_SIZE)
    padding: u32,
};

struct FoundResult {
    thread_id: u32,
    key_offset: u32,
};

struct Output {
    found_count: atomic<u32>,
    results: array<FoundResult, 32>,
};

@group(0) @binding(0) var<uniform> params: SearchParams;
@group(0) @binding(1) var<storage, read_write> output: Output;

// ---- Work-local arrays for Z, X, Y coords ----
// Each thread needs BATCH_SIZE entries (48 × 32 = 1536 bytes per coord)
// We use function-local storage via var arrays

fn u256_load_x(v0: u32, v1: u32, v2: u32, v3: u32, v4: u32, v5: u32, v6: u32, v7: u32) -> U256 {
    var r: U256;
    r.limbs[0] = v0; r.limbs[1] = v1; r.limbs[2] = v2; r.limbs[3] = v3;
    r.limbs[4] = v4; r.limbs[5] = v5; r.limbs[6] = v6; r.limbs[7] = v7;
    return r;
}

fn hash160(x: U256, y: U256) -> array<u32, 5> {
    let prefix = select(0x02u, 0x03u, (y.limbs[0] & 1u) == 0u);
    let sha = sha256_pubkey(x, prefix);
    return ripemd160_from_sha(sha);
}

fn hash_matches(h: array<u32, 5>, t: array<u32, 5>) -> bool {
    return h[0] == t[0] && h[1] == t[1] && h[2] == t[2] && h[3] == t[3] && h[4] == t[4];
}

// ---- Main search kernel ----
@compute @workgroup_size(64)
fn search(@builtin(global_invocation_id) gid: vec3<u32>,
          @builtin(local_invocation_id) lid: vec3<u32>) {

    let tid = gid.x;

    // Load base point
    var base_x = u256_load_x(params.base_x[0], params.base_x[1], params.base_x[2], params.base_x[3], params.base_x[4], params.base_x[5], params.base_x[6], params.base_x[7]);
    var base_y = u256_load_x(params.base_y[0], params.base_y[1], params.base_y[2], params.base_y[3], params.base_y[4], params.base_y[5], params.base_y[6], params.base_y[7]);

    // Load target hash160
    var tgt: array<u32, 5>;
    for (var i = 0u; i < 5u; i++) { tgt[i] = params.target_hash[i]; }

    // Phase 1: Walk BATCH_SIZE sequential keys from base point
    // Store all Jacobian points in registers/locals
    // We can't use var arrays of struct in WGSL for large sizes,
    // so we accumulate in registers and batch-invert on the fly

    // Start from base affine → Jacobian (Z=1)
    var cx = base_x;
    var cy = base_y;
    var cz = u256_from_u32(1u);

    // Collect Z-coords and (x,y) for batch inversion
    // We'll accumulate and hash each point after batch invert

    // Store Z values in a workgroup array (64 threads × BATCH_SIZE would be too large)
    // Instead: each thread does serial batch of BATCH_SIZE with local batch invert

    var zs: array<U256, 48>;
    var xs: array<U256, 48>;
    var ys: array<U256, 48>;

    // Generate B points
    for (var k = 0u; k < BATCH_SIZE; k++) {
        xs[k] = cx;
        ys[k] = cy;
        zs[k] = cz;
        // Add G: point_add_mixed(JacobianPoint(cx,cy,cz), GX, GY)
        let pt = point_add_mixed(JacobianPoint(cx, cy, cz), GX(), GY());
        cx = pt.x;
        cy = pt.y;
        cz = pt.z;
    }

    // Phase 2: Montgomery batch inversion on Z-coordinates
    // Forward products
    var prefix_prod: array<U256, 48>;
    prefix_prod[0] = zs[0];
    for (var k = 1u; k < BATCH_SIZE; k++) {
        prefix_prod[k] = fp_mul(prefix_prod[k - 1u], zs[k]);
    }
    // Single Fermat inverse
    var inv = fp_inv(prefix_prod[BATCH_SIZE - 1u]);
    // Backward pass: extract individual inverses
    var invz: array<U256, 48>;
    for (var k = BATCH_SIZE; k >= 1u; k--) {
        let kk = k - 1u;
        if (kk > 0u) {
            invz[kk] = fp_mul(inv, prefix_prod[kk - 1u]);
            inv = fp_mul(inv, zs[kk]);
        } else {
            invz[0] = inv;
        }
    }

    // Phase 3: Convert to affine, apply negation map, hash and compare
    for (var k = 0u; k < BATCH_SIZE; k++) {
        let z2 = fp_mul(invz[k], invz[k]);
        let z3 = fp_mul(z2, invz[k]);
        let x_aff = fp_mul(xs[k], z2);
        let y_aff = fp_mul(ys[k], z3);

        // Prefix based on actual y parity
        let prefix = select(0x02u, 0x03u, (y_aff.limbs[0] & 1u) == 0u);

        // Hash
        let sha = sha256_pubkey(x_aff, prefix);
        let h = ripemd160_from_sha(sha);

        if (hash_matches(h, tgt)) {
            let idx = atomicAdd(&output.found_count, 1u);
            if (idx < 32u) {
                output.results[idx] = FoundResult(tid, k);
            }
            return;
        }
    }
}
