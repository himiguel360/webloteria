// RIPEMD-160 — single-block, specialized for 32-byte SHA-256 output
// Input: 8 x u32 words (SHA-256 output, big-endian → byte-swapped to LE for RIPEMD)
// Output: 5 x u32 words

const RM_KL = array<u32, 5>(0x00000000u, 0x5A827999u, 0x6ED9EBA1u, 0x8F1BBCDCu, 0xA953FD4E);
const RM_KR = array<u32, 5>(0x50A28BE6u, 0x5C4DD124u, 0x6D703EF3u, 0x7A6D76E9u, 0x00000000u);

const RM_RL = array<u32, 80>(
    0u,1u,2u,3u,4u,5u,6u,7u,8u,9u,10u,11u,12u,13u,14u,15u,
    7u,4u,13u,1u,10u,6u,15u,3u,12u,0u,9u,5u,2u,14u,11u,8u,
    3u,10u,14u,4u,9u,15u,8u,1u,2u,7u,0u,6u,13u,11u,5u,12u,
    1u,9u,11u,10u,0u,8u,12u,4u,13u,3u,7u,15u,14u,5u,6u,2u,
    4u,0u,5u,9u,7u,12u,2u,10u,14u,1u,3u,8u,11u,6u,15u,13u
);

const RM_RR = array<u32, 80>(
    5u,14u,7u,0u,9u,2u,11u,4u,13u,6u,15u,8u,1u,10u,3u,12u,
    6u,11u,3u,7u,0u,13u,5u,10u,14u,15u,8u,12u,4u,9u,1u,2u,
    15u,5u,1u,3u,7u,14u,6u,9u,11u,8u,12u,2u,10u,0u,4u,13u,
    8u,6u,4u,1u,3u,11u,15u,0u,5u,12u,2u,13u,9u,7u,10u,14u,
    12u,15u,10u,4u,1u,5u,8u,7u,6u,2u,13u,14u,0u,3u,9u,11u
);

const RM_SL = array<u32, 80>(
    11u,14u,15u,12u,5u,8u,7u,9u,11u,13u,14u,15u,6u,7u,9u,8u,
    7u,6u,8u,13u,11u,9u,7u,15u,7u,12u,15u,9u,11u,7u,13u,12u,
    11u,13u,6u,7u,14u,9u,13u,15u,14u,8u,13u,6u,5u,12u,7u,5u,
    11u,12u,14u,15u,14u,15u,9u,8u,9u,14u,5u,6u,8u,6u,5u,12u,
    9u,15u,5u,11u,6u,8u,13u,12u,5u,12u,13u,14u,11u,8u,5u,6u
);

const RM_SR = array<u32, 80>(
    8u,9u,9u,11u,13u,15u,15u,5u,7u,7u,8u,11u,14u,14u,12u,6u,
    9u,13u,15u,7u,12u,8u,9u,11u,7u,7u,12u,7u,6u,15u,13u,11u,
    9u,7u,15u,11u,8u,6u,6u,14u,12u,13u,5u,14u,13u,13u,7u,5u,
    15u,5u,8u,11u,14u,14u,6u,14u,6u,9u,12u,9u,12u,5u,15u,8u,
    8u,5u,12u,9u,12u,5u,14u,6u,8u,13u,6u,5u,15u,13u,11u,11u
);

fn rm_f(round: u32, x: u32, y: u32, z: u32) -> u32 {
    if (round == 0u) { return x ^ y ^ z; }
    if (round == 1u) { return (x & y) | (~x & z); }
    if (round == 2u) { return (x | ~y) ^ z; }
    if (round == 3u) { return (x & z) | (y & ~z); }
    return x ^ (y | ~z);
}

fn ripemd160_compress(state: ptr<function, array<u32, 5>>, block: array<u32, 16>) {
    var al = state[0]; var bl = state[1]; var cl = state[2]; var dl = state[3]; var el = state[4];
    var ar = al; var br = bl; var cr = cl; var dr = dl; var er = el;

    for (var j = 0u; j < 80u; j++) {
        let rl_idx = RM_RL[j];
        let rr_idx = RM_RR[j];
        let sl = RM_SL[j];
        let sr = RM_SR[j];
        let kl_idx = j / 16u;
        let kr_idx = 4u - (j / 16u);

        var t = al + rm_f(kl_idx, bl, cl, dl) + block[rl_idx] + RM_KL[kl_idx];
        t = (t << sl) | (t >> (32u - sl));
        t += el;
        al = el; el = dl; dl = (cl << 10u) | (cl >> 22u); cl = bl; bl = t;

        t = ar + rm_f(kr_idx, br, cr, dr) + block[rr_idx] + RM_KR[kr_idx];
        t = (t << sr) | (t >> (32u - sr));
        t += er;
        ar = er; er = dr; dr = (cr << 10u) | (cr >> 22u); cr = br; br = t;
    }

    let t = (*state)[1] + cl + dr;
    (*state)[1] = (*state)[2] + dl + er;
    (*state)[2] = (*state)[3] + el + ar;
    (*state)[3] = (*state)[4] + al + br;
    (*state)[4] = (*state)[0] + bl + cr;
    (*state)[0] = t;
}

// RIPEMD-160 of 32-byte SHA-256 output
// sha_out: 8 x u32 big-endian → byte-swap to LE for RIPEMD
fn ripemd160_from_sha(sha_out: array<u32, 8>) -> array<u32, 5> {
    var block = array<u32, 16>();

    // Byte-swap each SHA-256 word (BE → LE for RIPEMD-160)
    for (var i = 0u; i < 8u; i++) {
        let w = sha_out[i];
        block[i] = ((w & 0xFF000000u) >> 24u) | ((w & 0x00FF0000u) >> 8u) |
                   ((w & 0x0000FF00u) << 8u)  | ((w & 0x000000FFu) << 24u);
    }
    block[8] = 0x00000080u; // padding bit
    for (var i = 9u; i < 14u; i++) { block[i] = 0u; }
    block[14] = 0x00000100u; // 32 bytes = 256 bits
    block[15] = 0u;

    var state = array<u32, 5>(
        0x67452301u, 0xEFCDAB89u, 0x98BADCFEu, 0x10325476u, 0xC3D2E1F0u
    );
    ripemd160_compress(&state, block);
    return state;
}
