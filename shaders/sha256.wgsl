// SHA-256 — single-block, specialized for 33-byte compressed public key
// Input: 33 bytes (prefix + 32-byte x coordinate)
// Output: 8 x u32 words (big-endian)

const SHA_K = array<u32, 64>(
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
    0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
    0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
    0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
    0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
    0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
);

const SHA_H0 = array<u32, 8>(
    0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
    0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u
);

fn rotr32(x: u32, n: u32) -> u32 {
    return (x >> n) | (x << (32u - n));
}

fn ch(x: u32, y: u32, z: u32) -> u32 {
    return (x & y) ^ (~x & z);
}

fn maj(x: u32, y: u32, z: u32) -> u32 {
    return (x & y) ^ (x & z) ^ (y & z);
}

fn ep0(x: u32) -> u32 {
    return rotr32(x, 2u) ^ rotr32(x, 13u) ^ rotr32(x, 22u);
}

fn ep1(x: u32) -> u32 {
    return rotr32(x, 6u) ^ rotr32(x, 11u) ^ rotr32(x, 25u);
}

fn sig0(x: u32) -> u32 {
    return rotr32(x, 7u) ^ rotr32(x, 18u) ^ (x >> 3u);
}

fn sig1(x: u32) -> u32 {
    return rotr32(x, 17u) ^ rotr32(x, 19u) ^ (x >> 10u);
}

fn be32_to_u32(b0: u32, b1: u32, b2: u32, b3: u32) -> u32 {
    return (b0 << 24u) | (b1 << 16u) | (b2 << 8u) | b3;
}

// SHA-256 of 33-byte compressed public key
// Input: x_aff (256-bit affine x), prefix (0x02 or 0x03)
fn sha256_pubkey(x_aff: U256, prefix: u32) -> array<u32, 8> {
    // Build 33-byte message as 16 u32 words (big-endian)
    // Byte layout: prefix || x[31] || x[30] || ... || x[0]
    var W = array<u32, 16>();

    // Load x-coordinate as 8 big-endian u32 words
    var xbe = array<u32, 8>();
    for (var i = 0u; i < 8u; i++) {
        // Little-endian limbs to big-endian words
        let limb = x_aff.limbs[i];
        xbe[i] = limb; // Already stored as LE u32, but we need BE byte order for SHA
    }

    // The 33-byte message: prefix(1) + x(32) = 33 bytes
    // Packed into 9 u32 words (last word partially used), then pad
    // Byte 0 = prefix, Bytes 1-32 = x (big-endian)
    // Actually: the compressed pubkey is: prefix(1 byte) + x_coord(32 bytes, big-endian)

    // x in LE limbs: limbs[0]=least significant, limbs[7]=most significant
    // For SHA-256, we need big-endian byte order
    // Word 0: prefix << 24 | x_limb7 >> 8  (but x is stored as LE limbs)

    // Convert x limbs to big-endian bytes then pack
    // x.limbs[7] is most significant
    W[0] = (prefix << 24u) | (x_aff.limbs[7] >> 8u);
    W[1] = (x_aff.limbs[7] << 24u) | (x_aff.limbs[6] >> 8u);
    W[2] = (x_aff.limbs[6] << 24u) | (x_aff.limbs[5] >> 8u);
    W[3] = (x_aff.limbs[5] << 24u) | (x_aff.limbs[4] >> 8u);
    W[4] = (x_aff.limbs[4] << 24u) | (x_aff.limbs[3] >> 8u);
    W[5] = (x_aff.limbs[3] << 24u) | (x_aff.limbs[2] >> 8u);
    W[6] = (x_aff.limbs[2] << 24u) | (x_aff.limbs[1] >> 8u);
    W[7] = (x_aff.limbs[1] << 24u) | (x_aff.limbs[0] >> 8u);
    W[8] = (x_aff.limbs[0] << 24u) | 0x00800000u; // pad bit after last data byte
    W[9] = 0u; W[10] = 0u; W[11] = 0u; W[12] = 0u; W[13] = 0u;
    W[14] = 0u;
    W[15] = 0x00000108u; // 33 bytes * 8 = 264 bits = 0x108

    var a = SHA_H0[0]; var b = SHA_H0[1]; var c = SHA_H0[2]; var d = SHA_H0[3];
    var e = SHA_H0[4]; var f = SHA_H0[5]; var g = SHA_H0[6]; var h = SHA_H0[7];

    for (var i = 0u; i < 64u; i++) {
        var wi: u32;
        if (i < 16u) {
            wi = W[i];
        } else {
            wi = W[i & 15u] + sig0(W[(i + 1u) & 15u]) + W[(i + 9u) & 15u] + sig1(W[(i + 14u) & 15u]);
            W[i & 15u] = wi;
        }
        let t1 = h + ep1(e) + ch(e, f, g) + SHA_K[i] + wi;
        let t2 = ep0(a) + maj(a, b, c);
        h = g; g = f; f = e; e = d + t1;
        d = c; c = b; b = a; a = t1 + t2;
    }

    var state = array<u32, 8>();
    state[0] = SHA_H0[0] + a; state[1] = SHA_H0[1] + b;
    state[2] = SHA_H0[2] + c; state[3] = SHA_H0[3] + d;
    state[4] = SHA_H0[4] + e; state[5] = SHA_H0[5] + f;
    state[6] = SHA_H0[6] + g; state[7] = SHA_H0[7] + h;
    return state;
}
