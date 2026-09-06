/*
 * loteria_cuda.cu — Multi-GPU Bitcoin Puzzle Solver v3 (GPU-NATIVE)
 * CUDA kernel: secp256k1 + SHA-256 + RIPEMD-160
 *
 * v3: Each thread computes its own key*G on GPU (no CPU bottleneck).
 *     Processes in waves to cover ranges > 2^64.
 *
 * Compile: nvcc -O3 -o loteria loteria_cuda.cu -arch=sm_89
 * Run:     ./loteria --wallet 71 --gpus 1
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <chrono>
#include <thread>
#include <atomic>
#include <vector>
#include <string>
#include <cuda_runtime.h>

#define BLOCK_SIZE       256
#define MAX_GPUS         8
#define FOUND_CACHE_SIZE 64
#define KEYS_PER_WAVE    (1ULL << 32)

/* ======================================================================
 * __constant__ arrays
 * ====================================================================== */

__constant__ uint32_t d_sha256_k[64] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};

__constant__ uint32_t d_KL[5]  = {0x00000000,0x5a827999,0x6ed9eba1,0x8f1bbcdc,0x95011149};
__constant__ uint32_t d_KR[5]  = {0x50a28be6,0x700447a0,0x98badcfe,0xa953fd4e,0x00000000};
__constant__ int d_RL[80] = {
    0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,
    7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,
    3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,
    1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,
    4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13
};
__constant__ int d_SL[80] = {
    11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,
    7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,
    11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,
    11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,
    9,15,5,11,6,8,13,12,5,12,13,14,11,8,6,5
};
__constant__ int d_RR[80] = {
    5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,
    6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,
    15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,
    8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,
    12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11
};
__constant__ int d_SR[80] = {
    8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,
    9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,
    9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,
    15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,
    8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11
};

/* ======================================================================
 * 256-bit integer — 8 x uint32 little-endian limbs
 * ====================================================================== */

struct uint256_t {
    uint32_t d[8];

    __host__ __device__ uint256_t() { d[0]=d[1]=d[2]=d[3]=d[4]=d[5]=d[6]=d[7]=0; }
    __host__ __device__ uint256_t(uint64_t a) {
        d[0]=(uint32_t)(a & 0xFFFFFFFFULL);
        d[1]=(uint32_t)(a >> 32);
        d[2]=d[3]=d[4]=d[5]=d[6]=d[7]=0;
    }
    __host__ __device__ uint256_t(uint32_t a0,uint32_t a1,uint32_t a2,uint32_t a3,
                                   uint32_t a4,uint32_t a5,uint32_t a6,uint32_t a7) {
        d[0]=a0;d[1]=a1;d[2]=a2;d[3]=a3;d[4]=a4;d[5]=a5;d[6]=a6;d[7]=a7;
    }
    __host__ __device__ bool isZero() const {
        return d[0]==0&&d[1]==0&&d[2]==0&&d[3]==0&&d[4]==0&&d[5]==0&&d[6]==0&&d[7]==0;
    }
    __host__ __device__ int getBit(int i) const {
        return (d[i/32] >> (i%32)) & 1;
    }
};

/* secp256k1 field prime P = 2^256 - 2^32 - 977 */
__host__ __device__ inline uint256_t get_prime_p() {
    uint256_t p;
    p.d[0]=0xFFFFFC2F; p.d[1]=0xFFFFFFFE; p.d[2]=0xFFFFFFFF; p.d[3]=0xFFFFFFFF;
    p.d[4]=0xFFFFFFFF; p.d[5]=0xFFFFFFFF; p.d[6]=0xFFFFFFFF; p.d[7]=0xFFFFFFFF;
    return p;
}

/* ======================================================================
 * 256-bit arithmetic
 * ====================================================================== */

__host__ __device__ uint256_t u256_add(const uint256_t& a, const uint256_t& b) {
    uint256_t r;
    uint64_t carry = 0;
    for (int i=0; i<8; i++) {
        uint64_t s = (uint64_t)a.d[i] + b.d[i] + carry;
        r.d[i] = (uint32_t)(s & 0xFFFFFFFFULL);
        carry = s >> 32;
    }
    return r;
}

__host__ __device__ uint256_t u256_sub(const uint256_t& a, const uint256_t& b) {
    uint256_t r;
    int64_t borrow = 0;
    for (int i=0; i<8; i++) {
        int64_t diff = (int64_t)a.d[i] - b.d[i] - borrow;
        r.d[i] = (uint32_t)(diff & 0xFFFFFFFFULL);
        borrow = (diff < 0) ? 1 : 0;
    }
    return r;
}

__host__ __device__ bool u256_gte(const uint256_t& a, const uint256_t& b) {
    for (int i=7; i>=0; i--) {
        if (a.d[i] > b.d[i]) return true;
        if (a.d[i] < b.d[i]) return false;
    }
    return true;
}

__host__ __device__ bool u256_lt(const uint256_t& a, const uint256_t& b) {
    return !u256_gte(a, b);
}

__host__ __device__ uint256_t u256_add_u64(const uint256_t& a, uint64_t b) {
    uint256_t r = a;
    uint64_t carry = b;
    for (int i = 0; i < 8 && carry; i++) {
        uint64_t s = (uint64_t)r.d[i] + (uint32_t)(carry & 0xFFFFFFFFULL);
        r.d[i] = (uint32_t)(s & 0xFFFFFFFFULL);
        carry = (carry >> 32) + (s >> 32);
    }
    return r;
}

__host__ __device__ uint64_t u256_to_u64(const uint256_t& a) {
    return ((uint64_t)a.d[1] << 32) | a.d[0];
}

__host__ void u256_print(const uint256_t& a) {
    bool started = false;
    for (int i = 7; i >= 0; i--) {
        if (started || a.d[i] != 0) {
            if (started) printf("%08x", a.d[i]);
            else printf("%x", a.d[i]);
            started = true;
        }
    }
    if (!started) printf("0");
}

/* ======================================================================
 * Field arithmetic (mod P), P = 2^256 - 2^32 - 977
 * ====================================================================== */

__host__ __device__ uint256_t field_add(const uint256_t& a, const uint256_t& b) {
    uint256_t r = u256_add(a, b);
    uint256_t p = get_prime_p();
    if (u256_gte(r, p)) r = u256_sub(r, p);
    return r;
}

__host__ __device__ uint256_t field_sub(const uint256_t& a, const uint256_t& b) {
    uint256_t p = get_prime_p();
    if (u256_gte(a, b)) return u256_sub(a, b);
    return u256_sub(u256_add(a, p), b);
}

__host__ __device__ uint256_t field_mul(const uint256_t& a, const uint256_t& b) {
    uint64_t prod[16];
    for (int i=0; i<16; i++) prod[i] = 0;
    for (int i=0; i<8; i++) {
        uint64_t carry = 0;
        for (int j=0; j<8; j++) {
            uint64_t v = prod[i+j] + (uint64_t)a.d[i] * b.d[j] + carry;
            prod[i+j] = v & 0xFFFFFFFFULL;
            carry = v >> 32;
        }
        prod[i+8] += carry;
    }

    const uint64_t C = 4294968273ULL;
    for (int iter = 0; iter < 3; iter++) {
        uint32_t hi[8];
        for (int i=0; i<4; i++) hi[i] = (uint32_t)prod[i+4];
        for (int i=4; i<8; i++) hi[i] = 0;

        bool hi_zero = true;
        for (int i=0; i<8; i++) if (hi[i] != 0) { hi_zero = false; break; }
        if (hi_zero) break;

        uint64_t hc[9];
        uint64_t carry = 0;
        for (int i=0; i<8; i++) {
            uint64_t v = (uint64_t)hi[i] * C + carry;
            hc[i] = v & 0xFFFFFFFFULL;
            carry = v >> 32;
        }
        hc[8] = carry;

        carry = 0;
        for (int i=0; i<8; i++) {
            uint64_t v = prod[i] + hc[i] + carry;
            prod[i] = v & 0xFFFFFFFFULL;
            carry = v >> 32;
        }
        for (int i=8; i<9 && carry; i++) {
            uint64_t v = hc[i] + carry;
            hc[i] = v & 0xFFFFFFFFULL;
            carry = v >> 32;
        }
        for (int i=4; i<8; i++) prod[i] = hc[i];
        prod[8] = hc[8];
        prod[9] = 0;
    }

    uint256_t result;
    for (int i=0; i<8; i++) result.d[i] = (uint32_t)prod[i];

    uint256_t p = get_prime_p();
    for (int iter=0; iter<3; iter++) {
        if (u256_gte(result, p)) result = u256_sub(result, p);
        else break;
    }
    return result;
}

__host__ __device__ uint256_t field_sqr(const uint256_t& a) { return field_mul(a, a); }

/* Modular inverse via Fermat: a^(P-2) mod P */
__host__ __device__ uint256_t field_inv(const uint256_t& a) {
    uint256_t result(1);
    uint256_t base = a;
    const uint32_t exp[8] = {
        0xFFFFFC2D, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF,
        0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF
    };
    for (int i=0; i<256; i++) {
        if ((exp[i/32] >> (i%32)) & 1) result = field_mul(result, base);
        base = field_sqr(base);
    }
    return result;
}

/* ======================================================================
 * secp256k1 point operations (Jacobian coordinates)
 * ====================================================================== */

struct JacPoint { uint256_t x, y, z; };
struct AffPoint { uint256_t x, y; };

__host__ __device__ JacPoint pt_double(const JacPoint& p) {
    if (p.z.isZero()) return p;
    uint256_t z2 = field_sqr(p.z);
    uint256_t s  = field_mul(uint256_t(4), field_mul(p.x, field_sqr(p.y)));
    uint256_t m  = field_mul(uint256_t(3), field_sqr(p.x));
    uint256_t x3 = field_sub(field_sqr(m), field_add(s, s));
    uint256_t y3 = field_sub(field_mul(m, field_sub(s, x3)),
                              field_mul(uint256_t(8), field_sqr(field_sqr(p.y))));
    uint256_t z3 = field_mul(uint256_t(2), field_mul(p.y, p.z));
    JacPoint r; r.x=x3; r.y=y3; r.z=z3;
    return r;
}

__host__ __device__ JacPoint pt_add_mixed(const JacPoint& p, const uint256_t& qx, const uint256_t& qy) {
    if (p.z.isZero()) { JacPoint r; r.x=qx; r.y=qy; r.z=uint256_t(1); return r; }
    uint256_t z1z1 = field_sqr(p.z);
    uint256_t u2 = field_mul(qx, z1z1);
    uint256_t s2 = field_mul(qy, field_mul(p.z, z1z1));
    uint256_t h = field_sub(u2, p.x);
    uint256_t r = field_sub(s2, p.y);
    if (h.isZero()) {
        if (r.isZero()) return pt_double(p);
        JacPoint inf; return inf;
    }
    uint256_t h2 = field_sqr(h);
    uint256_t h3 = field_mul(h, h2);
    uint256_t x3 = field_sub(field_sqr(r), field_add(h3, field_mul(uint256_t(2), field_mul(p.x, h2))));
    uint256_t y3 = field_sub(field_mul(r, field_sub(p.x, x3)), field_mul(p.y, h3));
    uint256_t z3 = field_mul(h, p.z);
    JacPoint r2; r2.x=x3; r2.y=y3; r2.z=z3;
    return r2;
}

__host__ __device__ AffPoint to_affine(const JacPoint& p) {
    AffPoint a; a.x=uint256_t(0); a.y=uint256_t(0);
    if (p.z.isZero()) return a;
    uint256_t zi  = field_inv(p.z);
    uint256_t zi2 = field_sqr(zi);
    a.x = field_mul(p.x, zi2);
    a.y = field_mul(p.y, field_mul(zi2, zi));
    return a;
}

/* k*G — double-and-add, MSB first, skip leading zeros */
__host__ __device__ JacPoint scalar_mul_g(const uint256_t& k) {
    uint256_t gx;
    gx.d[0]=0x16F81798; gx.d[1]=0x59F2815B; gx.d[2]=0x2DCE28D9; gx.d[3]=0x029BFCDB;
    gx.d[4]=0xCE870B07; gx.d[5]=0x55A06295; gx.d[6]=0x5DCBBAC5; gx.d[7]=0x79BE667E;
    uint256_t gy;
    gy.d[0]=0xFB10D4B8; gy.d[1]=0x9C47D08F; gy.d[2]=0xA6855419; gy.d[3]=0xFD17B448;
    gy.d[4]=0x0E1108A8; gy.d[5]=0x5DA4FBFC; gy.d[6]=0x26A3C465; gy.d[7]=0x483ADA77;

    int msb = -1;
    for (int i=255; i>=0; i--) {
        if (k.getBit(i)) { msb = i; break; }
    }
    if (msb < 0) { JacPoint inf; return inf; }

    JacPoint r;
    r.x=gx; r.y=gy; r.z=uint256_t(1);
    for (int i=msb-1; i>=0; i--) {
        r = pt_double(r);
        if (k.getBit(i)) r = pt_add_mixed(r, gx, gy);
    }
    return r;
}

/* ======================================================================
 * SHA-256
 * ====================================================================== */

__device__ inline uint32_t rotr32(uint32_t x, int n) { return (x>>n)|(x<<(32-n)); }

__device__ void sha256_compress(uint32_t st[8], const uint32_t blk[16]) {
    uint32_t w[64];
    for (int i=0; i<16; i++) w[i]=blk[i];
    for (int i=16; i<64; i++)
        w[i]=w[i-16]+(rotr32(w[i-15],7)^rotr32(w[i-15],18)^(w[i-15]>>3))
            +w[i-7]+(rotr32(w[i-2],17)^rotr32(w[i-2],19)^(w[i-2]>>10));
    uint32_t a=st[0],b=st[1],c=st[2],d=st[3],e=st[4],f=st[5],g=st[6],h=st[7];
    for (int i=0; i<64; i++) {
        uint32_t S1=rotr32(e,6)^rotr32(e,11)^rotr32(e,25);
        uint32_t ch=(e&f)^(~e&g);
        uint32_t t1=h+S1+ch+d_sha256_k[i]+w[i];
        uint32_t S0=rotr32(a,2)^rotr32(a,13)^rotr32(a,22);
        uint32_t mj=(a&b)^(a&c)^(b&c);
        uint32_t t2=S0+mj;
        h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
    }
    st[0]+=a;st[1]+=b;st[2]+=c;st[3]+=d;st[4]+=e;st[5]+=f;st[6]+=g;st[7]+=h;
}

__device__ void sha256_compressed(const uint256_t& x, uint8_t prefix, uint8_t out32[32]) {
    uint8_t msg[64];
    memset(msg, 0, 64);
    msg[0] = prefix;
    for (int i=0; i<32; i++) {
        int limb = 7 - i/4;
        int shift = (3 - (i%4)) * 8;
        msg[1+i] = (uint8_t)((x.d[limb]>>shift)&0xFF);
    }
    msg[33]=0x80;
    uint32_t w[16];
    for (int i=0; i<16; i++)
        w[i]=((uint32_t)msg[i*4])<<24|((uint32_t)msg[i*4+1])<<16|
             ((uint32_t)msg[i*4+2])<<8|msg[i*4+3];
    w[14]=0; w[15]=264;
    uint32_t st[8]={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
                     0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    sha256_compress(st, w);
    for (int i=0; i<8; i++) {
        out32[i*4]=(uint8_t)(st[i]>>24); out32[i*4+1]=(uint8_t)(st[i]>>16);
        out32[i*4+2]=(uint8_t)(st[i]>>8); out32[i*4+3]=(uint8_t)st[i];
    }
}

/* ======================================================================
 * RIPEMD-160
 * ====================================================================== */

__device__ inline uint32_t rotl32(uint32_t x, int n) { return (x<<n)|(x>>(32-n)); }

__device__ uint32_t rf(int j, uint32_t x, uint32_t y, uint32_t z) {
    if (j<16) return x^y^z;
    if (j<32) return (x&y)|(~x&z);
    if (j<48) return (x|~y)^z;
    if (j<64) return (x&z)|(y&~z);
    return x^(y|~z);
}

__device__ void ripemd160_compress(uint32_t st[5], const uint32_t blk[16]) {
    uint32_t al=st[0],bl=st[1],cl=st[2],dl=st[3],el=st[4];
    uint32_t ar=st[0],br=st[1],cr=st[2],dr=st[3],er=st[4];

    for (int j=0; j<80; j++) {
        int g = j/16;
        uint32_t t = al + rf(j,bl,cl,dl) + blk[d_RL[j]] + d_KL[g];
        t = rotl32(t, d_SL[j]) + el;
        al=el; el=dl; dl=rotl32(cl,10); cl=bl; bl=t;

        int rg = (79-j)/16;
        t = ar + rf(79-j,br,cr,dr) + blk[d_RR[j]] + d_KR[rg];
        t = rotl32(t, d_SR[j]) + er;
        ar=er; er=dr; dr=rotl32(cr,10); cr=br; br=t;
    }

    uint32_t t = st[1]+cl+dr;
    st[1]=st[2]+dl+er; st[2]=st[3]+el+ar;
    st[3]=st[4]+al+br; st[4]=st[0]+bl+cr; st[0]=t;
}

__device__ void ripemd160(const uint8_t* data, int len, uint8_t out20[20]) {
    uint32_t st[5]={0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0};
    int nblk = (len+9+63)/64;
    for (int b=0; b<nblk; b++) {
        uint8_t blk[64];
        memset(blk, 0, 64);
        int off=b*64, avail=len-off;
        if (avail>0) { int c=avail<64?avail:64; memcpy(blk,data+off,c); }
        if (avail>=0 && avail<64) blk[avail]=0x80;
        if (b==nblk-1) {
            uint64_t blen=(uint64_t)len*8;
            for (int i=0; i<8; i++) blk[56+i]=(uint8_t)(blen>>(i*8));
        }
        uint32_t w[16];
        for (int i=0; i<16; i++)
            w[i]=(uint32_t)blk[i*4]|((uint32_t)blk[i*4+1])<<8|
                 ((uint32_t)blk[i*4+2])<<16|((uint32_t)blk[i*4+3])<<24;
        ripemd160_compress(st, w);
    }
    for (int i=0; i<5; i++) {
        out20[i*4]=(uint8_t)st[i]; out20[i*4+1]=(uint8_t)(st[i]>>8);
        out20[i*4+2]=(uint8_t)(st[i]>>16); out20[i*4+3]=(uint8_t)(st[i]>>24);
    }
}

/* ======================================================================
 * Target hash160 matching
 * ====================================================================== */

struct TargetHash { uint8_t bytes[20]; };

__device__ bool hash_match(const uint8_t h[20], const TargetHash* t) {
    for (int i=0; i<20; i++) if (h[i]!=t->bytes[i]) return false;
    return true;
}

/* ======================================================================
 * CUDA error check
 * ====================================================================== */

#define CUDA_CHECK(call) do { \
    cudaError_t err=(call); \
    if (err!=cudaSuccess) { \
        fprintf(stderr,"CUDA error %s:%d: %s\n",__FILE__,__LINE__,cudaGetErrorString(err)); \
        exit(1); \
    } \
} while(0)

/* ======================================================================
 * GPU-NATIVE KERNEL — each thread computes its own key*G
 *
 * Each thread:
 *   1. key = wave_start + global_thread_id  (uint256 + uint64)
 *   2. P = scalar_mul_g(key)  on GPU
 *   3. (x, y) = to_affine(P)  (each thread does its own field_inv)
 *   4. h = RIPEMD160(SHA256(compressed_pubkey))
 *   5. if h == target: FOUND
 * ====================================================================== */

__global__ void search_kernel(
    uint32_t s0, uint32_t s1, uint32_t s2, uint32_t s3,
    uint32_t s4, uint32_t s5, uint32_t s6, uint32_t s7,
    const TargetHash* tgt, uint32_t* fcount,
    uint32_t* fkeys_lo, uint32_t* fkeys_hi)
{
    uint64_t tid = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;

    /* key = wave_start + tid */
    uint256_t key;
    uint64_t carry = tid;
    uint64_t sum = (uint64_t)s0 + (uint32_t)(carry & 0xFFFFFFFFULL);
    key.d[0] = (uint32_t)(sum & 0xFFFFFFFFULL);
    carry = (carry >> 32);
    sum = (uint64_t)s1 + (uint32_t)(carry & 0xFFFFFFFFULL) + (sum >> 32);
    key.d[1] = (uint32_t)(sum & 0xFFFFFFFFULL);
    carry = sum >> 32;
    sum = (uint64_t)s2 + carry;
    key.d[2] = (uint32_t)(sum & 0xFFFFFFFFULL); carry = sum >> 32;
    sum = (uint64_t)s3 + carry;
    key.d[3] = (uint32_t)(sum & 0xFFFFFFFFULL); carry = sum >> 32;
    sum = (uint64_t)s4 + carry;
    key.d[4] = (uint32_t)(sum & 0xFFFFFFFFULL); carry = sum >> 32;
    sum = (uint64_t)s5 + carry;
    key.d[5] = (uint32_t)(sum & 0xFFFFFFFFULL); carry = sum >> 32;
    sum = (uint64_t)s6 + carry;
    key.d[6] = (uint32_t)(sum & 0xFFFFFFFFULL); carry = sum >> 32;
    sum = (uint64_t)s7 + carry;
    key.d[7] = (uint32_t)(sum & 0xFFFFFFFFULL);

    /* Scalar multiply: P = key * G */
    JacPoint P = scalar_mul_g(key);
    if (P.z.isZero()) return;

    /* Convert to affine */
    AffPoint A = to_affine(P);

    /* Compressed public key */
    uint8_t prefix = (A.y.d[0] & 1) ? 0x03 : 0x02;

    /* SHA-256 + RIPEMD-160 */
    uint8_t sha[32], h160[20];
    sha256_compressed(A.x, prefix, sha);
    ripemd160(sha, 32, h160);

    /* Check against target */
    if (hash_match(h160, tgt)) {
        uint32_t idx = atomicAdd(fcount, 1u);
        if (idx < FOUND_CACHE_SIZE) {
            fkeys_lo[idx] = (uint32_t)(tid & 0xFFFFFFFFULL);
            fkeys_hi[idx] = (uint32_t)(tid >> 32);
        }
    }
}

/* ======================================================================
 * Host-side multi-GPU coordinator
 * ====================================================================== */

struct GPUContext {
    int id;
    TargetHash *d_tgt;
    uint32_t *d_fcount, *d_fkeys_lo, *d_fkeys_hi;
    cudaStream_t stream;
    uint64_t keys_checked, dispatches;
};

struct WalletDef {
    int num;
    const char* addr;
    uint256_t lo, hi;
    const uint8_t* h160;
};

static const uint8_t H160_65[20]={0x78,0x42,0x4c,0x04,0xb7,0xbb,0x54,0x1e,0x30,0xc4,
                                   0x3d,0x2e,0xb2,0x48,0x43,0x8a,0x3e,0x3e,0x0b,0xe5};
static const uint8_t H160_71[20]={0xd7,0x4d,0xe9,0x5f,0x65,0x79,0x97,0x93,0xf1,0x6b,
                                   0x91,0xed,0x89,0xb7,0x7d,0xce,0x98,0x4b,0xc8,0x32};

static WalletDef WALLETS[]={
    {65,"18ZMbwUFLMHoZBbfpCjUJQTCMCbktshgpe",
     uint256_t(0x00000000,0x00000000,0x00000001,0x00000000,0x00000000,0x00000000,0x00000000,0x00000000),
     uint256_t(0xFFFFFFFF,0xFFFFFFFF,0x00000001,0x00000000,0x00000000,0x00000000,0x00000000,0x00000000),
     H160_65},
    {71,"1PWo3JeB9jrGwfHDNpdGK54CRas7fsVzXU",
     uint256_t(0x00000000,0x00000000,0x00000000,0x40000000,0x00000000,0x00000000,0x00000000,0x00000000),
     uint256_t(0xFFFFFFFF,0xFFFFFFFF,0xFFFFFFFF,0x7FFFFFFF,0x00000000,0x00000000,0x00000000,0x00000000),
     H160_71},
};
static int N_WALLETS = 2;

struct WorkCfg {
    int gpu_id, num_gpus;
    uint256_t lo, hi;
    TargetHash tgt;
    GPUContext* g;
    std::atomic<bool>* running;
    std::atomic<int>* finished_count;
};

/* Compute total keys in range (hi - lo) as approximate uint64 */
static uint256_t range_size(const uint256_t& lo, const uint256_t& hi) {
    return u256_sub(hi, lo);
}

void gpu_thread(WorkCfg cfg) {
    GPUContext& g = *cfg.g;
    CUDA_CHECK(cudaSetDevice(cfg.gpu_id));
    CUDA_CHECK(cudaStreamCreate(&g.stream));

    uint256_t my_lo = cfg.lo;
    uint256_t my_hi = cfg.hi;
    if (cfg.num_gpus > 1) {
        uint256_t span = u256_sub(cfg.hi, cfg.lo);
        uint64_t span64 = u256_to_u64(span);
        uint64_t per = span64 / cfg.num_gpus;
        my_lo = u256_add_u64(cfg.lo, per * cfg.gpu_id);
        my_hi = (cfg.gpu_id == cfg.num_gpus - 1) ? cfg.hi : u256_add_u64(my_lo, per);
    }

    printf("[GPU %d] range: ", cfg.gpu_id);
    u256_print(my_lo);
    printf(" .. ");
    u256_print(my_hi);
    printf("\n");

    CUDA_CHECK(cudaMemcpy(g.d_tgt, &cfg.tgt, sizeof(TargetHash), cudaMemcpyHostToDevice));

    uint256_t cur = my_lo;
    uint256_t hi = my_hi;
    uint32_t zero = 0;
    int blocks = 1024;
    uint64_t threads_per_wave = (uint64_t)blocks * BLOCK_SIZE;

    while (*cfg.running && u256_lt(cur, hi)) {
        CUDA_CHECK(cudaMemcpyAsync(g.d_fcount, &zero, sizeof(uint32_t), cudaMemcpyHostToDevice, g.stream));

        search_kernel<<<blocks, BLOCK_SIZE, 0, g.stream>>>(
            cur.d[0], cur.d[1], cur.d[2], cur.d[3],
            cur.d[4], cur.d[5], cur.d[6], cur.d[7],
            g.d_tgt, g.d_fcount, g.d_fkeys_lo, g.d_fkeys_hi);

        CUDA_CHECK(cudaStreamSynchronize(g.stream));

        uint32_t hc = 0;
        CUDA_CHECK(cudaMemcpy(&hc, g.d_fcount, sizeof(uint32_t), cudaMemcpyDeviceToHost));
        if (hc > 0) {
            uint32_t klo[FOUND_CACHE_SIZE], khi[FOUND_CACHE_SIZE];
            int n = hc < FOUND_CACHE_SIZE ? hc : FOUND_CACHE_SIZE;
            CUDA_CHECK(cudaMemcpy(klo, g.d_fkeys_lo, n*sizeof(uint32_t), cudaMemcpyDeviceToHost));
            CUDA_CHECK(cudaMemcpy(khi, g.d_fkeys_hi, n*sizeof(uint32_t), cudaMemcpyDeviceToHost));
            for (int i = 0; i < n; i++) {
                uint64_t tid_found = ((uint64_t)khi[i] << 32) | klo[i];
                uint256_t fk = u256_add_u64(cur, tid_found);
                printf("\n*** FOUND key (GPU %d)! ***\n", cfg.gpu_id);
                printf("Key (LE): "); u256_print(fk); printf("\n");
            }
            cfg.running->store(false);
        }

        g.keys_checked += threads_per_wave;
        g.dispatches++;
        cur = u256_add_u64(cur, threads_per_wave);
    }
    CUDA_CHECK(cudaStreamDestroy(g.stream));
    cfg.finished_count->fetch_add(1);
}

void print_usage(){printf("Usage: ./loteria --wallet N [--gpus N]\n");}

int main(int argc, char** argv) {
    printf("=== Multi-GPU Bitcoin Puzzle Solver v3 (GPU-NATIVE) ===\n\n");
    printf("Each thread computes key*G on GPU (no CPU bottleneck)\n\n");

    int wnum=65, ngpu=0;
    for (int i=1; i<argc; i++) {
        if (!strcmp(argv[i],"--wallet")&&i+1<argc) wnum=atoi(argv[++i]);
        else if (!strcmp(argv[i],"--gpus")&&i+1<argc) ngpu=atoi(argv[++i]);
        else if (!strcmp(argv[i],"--help")) { print_usage(); return 0; }
    }

    int widx=-1;
    for (int i=0; i<N_WALLETS; i++) if (WALLETS[i].num==wnum) {widx=i;break;}
    if (widx<0) { printf("Wallet %d not found.\n",wnum); return 1; }

    WalletDef& w=WALLETS[widx];
    if (!w.h160) { printf("No hash160 for wallet %d.\n",wnum); return 1; }

    printf("Wallet #%d (%s)\n\n", w.num, w.addr);

    int dc;
    CUDA_CHECK(cudaGetDeviceCount(&dc));
    if (ngpu<=0) ngpu=dc;
    if (ngpu>dc) ngpu=dc;
    if (ngpu>MAX_GPUS) ngpu=MAX_GPUS;

    printf("GPUs: %d\n",ngpu);
    for (int i=0; i<ngpu; i++) {
        cudaDeviceProp p; CUDA_CHECK(cudaGetDeviceProperties(&p,i));
        printf("  GPU %d: %s (%.1f GB, %d SMs)\n",i,p.name,p.totalGlobalMem/(1e9),p.multiProcessorCount);
    }

    TargetHash tgt;
    memcpy(tgt.bytes, w.h160, 20);
    printf("\nTarget: "); for (int i=0;i<20;i++) printf("%02x",tgt.bytes[i]); printf("\n\n");

    GPUContext gpu[MAX_GPUS];
    memset(gpu,0,sizeof(gpu));
    for (int i=0; i<ngpu; i++) {
        CUDA_CHECK(cudaSetDevice(i));
        gpu[i].id=i; gpu[i].keys_checked=0; gpu[i].dispatches=0;
        CUDA_CHECK(cudaMalloc(&gpu[i].d_tgt, sizeof(TargetHash)));
        CUDA_CHECK(cudaMalloc(&gpu[i].d_fcount, sizeof(uint32_t)));
        CUDA_CHECK(cudaMalloc(&gpu[i].d_fkeys_lo, FOUND_CACHE_SIZE*sizeof(uint32_t)));
        CUDA_CHECK(cudaMalloc(&gpu[i].d_fkeys_hi, FOUND_CACHE_SIZE*sizeof(uint32_t)));
    }

    std::atomic<bool> running(true);
    std::atomic<int> finished_count(0);
    auto t0=std::chrono::high_resolution_clock::now();
    std::vector<std::thread> ths;
    for (int i=0; i<ngpu; i++) {
        WorkCfg c; c.gpu_id=i; c.num_gpus=ngpu; c.lo=w.lo; c.hi=w.hi;
        c.tgt=tgt; c.g=&gpu[i]; c.running=&running; c.finished_count=&finished_count;
        ths.emplace_back(gpu_thread, c);
    }

    while (running) {
        std::this_thread::sleep_for(std::chrono::seconds(3));
        uint64_t total=0;
        for (int i=0; i<ngpu; i++) total+=gpu[i].keys_checked;
        double elap=std::chrono::duration<double>(std::chrono::high_resolution_clock::now()-t0).count();
        printf("\r[%.0fs] %.2f B keys | %.2f GH/s   ",elap,total/1e9,elap>0?total/elap/1e9:0);
        fflush(stdout);
        if (finished_count.load() >= ngpu) { running = false; }
    }

    for (auto& t:ths) t.join();
    double elap=std::chrono::duration<double>(std::chrono::high_resolution_clock::now()-t0).count();
    uint64_t total=0;
    for (int i=0; i<ngpu; i++) {
        total+=gpu[i].keys_checked;
        CUDA_CHECK(cudaSetDevice(i));
        CUDA_CHECK(cudaFree(gpu[i].d_tgt));
        CUDA_CHECK(cudaFree(gpu[i].d_fcount));
        CUDA_CHECK(cudaFree(gpu[i].d_fkeys_lo));
        CUDA_CHECK(cudaFree(gpu[i].d_fkeys_hi));
    }
    printf("\n\n=== Done ===\nTotal: %.2f B keys in %.1fs (%.2f GH/s)\n",
           total/1e9,elap,elap>0?total/elap/1e9:0);
    return 0;
}
