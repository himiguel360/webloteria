/* ============================================================================
   WORKER DE BUSCA - Pipeline em Funil + Busca Aleatória Multi-lane
   ----------------------------------------------------------------------------
   Estratégia (brute-force aleatória + sequencial):
   - Cada worker roda LANES fronteiras simultâneas (testa várias chaves/regiões
     de uma vez = "várias saídas / múltiplos cálculos").
   - Cada lane sorteia uma chave ALEATÓRIA no intervalo, calcula o ponto kG e
     varre um trecho SEQUENCIAL curto (janela) por +G.
   - Ao fim da janela, pula para uma NOVA chave aleatória (reset).
   - Funil de etapas por lote: gerar pontos -> inversão batch -> affine ->
     SHA-256 -> RIPEMD-160 -> match em camadas (primeiros 4 bytes, depois 20).
   ============================================================================ */

var P_ = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
var GX_ = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
var GY_ = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;

function fmul(a,b){ return (a*b)%P_; }
function modpow_(b,e){ var r=1n; b%=P_; while(e>0n){ if(e&1n) r=r*b%P_; b=b*b%P_; e>>=1n; } return r; }
function jacdbl(X,Y,Z){
  if(Y===0n) return [0n,0n,0n];
  var A=fmul(X,X),B=fmul(Y,Y),C=fmul(B,B);
  var S=((((((2n*((X+B)%P_))%P_)*((X+B)%P_))%P_) - 2n*A - 2n*C)%P_); if(S<0n)S+=P_;
  var E=(3n*A)%P_,F=fmul(E,E);
  var X3=(F-2n*S)%P_; if(X3<0n)X3+=P_;
  var Y3=(fmul(E,((S-X3)%P_+P_)%P_)-8n*C)%P_; if(Y3<0n)Y3+=P_;
  var Z3=(2n*fmul(Y,Z))%P_;
  return [X3,Y3,Z3];
}
function jacaddG(X1,Y1,Z1){
  if(Z1===0n) return [GX_,GY_,1n];
  var Z1Z1=fmul(Z1,Z1);
  var U2=fmul(GX_,Z1Z1);
  var S2=fmul(fmul(GY_,Z1),Z1Z1);
  var H=(U2-X1)%P_; if(H<0n)H+=P_;
  var R=(S2-Y1)%P_; if(R<0n)R+=P_;
  if(H===0n){ if(R===0n) return jacdbl(X1,Y1,Z1); return [0n,0n,0n]; }
  var HH=fmul(H,H),HHH=fmul(HH,H),U1HH=fmul(X1,HH);
  var X3=(R*R - HHH - 2n*U1HH)%P_; if(X3<0n)X3+=P_;
  var Y3=(R*((U1HH-X3)%P_+P_)%P_ - Y1*HHH)%P_; if(Y3<0n)Y3+=P_;
  var Z3=fmul(H,Z1);
  return [X3,Y3,Z3];
}
function scalarMul(k){
  var X=0n,Y=0n,Z=0n,d,a;
  for(var i=255;i>=0;i--){
    if(X!==0n||Z!==0n){
      d=jacdbl(X,Y,Z);X=d[0];Y=d[1];Z=d[2];
      if((k>>BigInt(i))&1n){ a=jacaddG(X,Y,Z);X=a[0];Y=a[1];Z=a[2]; }
    } else if((k>>BigInt(i))&1n){ X=GX_;Y=GY_;Z=1n; }
  }
  return [X,Y,Z];
}

/* ---------------- RNG (mulberry32 + bigRange) ---------------- */
function RNG(seed){ this.s = seed >>> 0; }
RNG.prototype.uint32 = function(){
  this.s = (this.s + 0x6D2B79F5) >>> 0;
  var t = this.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0);
};
RNG.prototype.bigRange = function(min, max){
  var span = max - min + 1n;
  var lim = (span << 256n);
  var lim2 = lim - (lim % span);
  var v, i;
  do {
    v = 0n;
    for (i = 0; i < 8; i++) v = (v << 32n) | BigInt(this.uint32());
  } while (v >= lim2);
  return min + (v % span);
};

/* ---------------- SHA-256 (1 bloco, 33 bytes) ---------------- */
var K256 = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
var H256 = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
function SHA256Core(){ this.W = new Uint32Array(64); this.H8 = new Uint32Array(8); }
SHA256Core.prototype.hash = function(out, inp){
  var W = this.W, i;
  for(i=0;i<8;i++) W[i]=((inp[i*4]<<24)|(inp[i*4+1]<<16)|(inp[i*4+2]<<8)|(inp[i*4+3]))>>>0;
  W[8]=((inp[32]<<24)|(0x80<<16)|0)>>>0;
  W[9]=0;W[10]=0;W[11]=0;W[12]=0;W[13]=0;W[14]=0; W[15]=0x108;
  for(i=16;i<64;i++){
    var s0=W[i-15], s1=W[i-2];
    var x=((s0>>>7)|(s0<<25))^((s0>>>18)|(s0<<14))^(s0>>>3);
    var y=((s1>>>17)|(s1<<15))^((s1>>>19)|(s1<<13))^(s1>>>10);
    W[i]=(W[i-16]+x+W[i-7]+y)>>>0;
  }
  var a=H256[0],b=H256[1],c=H256[2],d=H256[3],e=H256[4],f=H256[5],g=H256[6],h=H256[7];
  for(i=0;i<64;i++){
    var S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));
    var ch=(e&f)^(~e&g);
    var t1=(h+S1+ch+K256[i]+W[i])>>>0;
    var S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));
    var maj=(a&b)^(a&c)^(b&c);
    var t2=(S0+maj)>>>0;
    h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
  }
  var H8=this.H8;
  H8[0]=(a+H256[0])>>>0;H8[1]=(b+H256[1])>>>0;H8[2]=(c+H256[2])>>>0;H8[3]=(d+H256[3])>>>0;
  H8[4]=(e+H256[4])>>>0;H8[5]=(f+H256[5])>>>0;H8[6]=(g+H256[6])>>>0;H8[7]=(h+H256[7])>>>0;
  for(i=0;i<8;i++){ var v=H8[i]; out[i*4]=(v>>>24); out[i*4+1]=(v>>>16); out[i*4+2]=(v>>>8); out[i*4+3]=v; }
};

/* ---------------- RIPEMD-160 ---------------- */
var RL = new Uint32Array([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13]);
var RR = new Uint32Array([5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11]);
var SL = new Uint32Array([11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6]);
var SR = new Uint32Array([8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11]);
var FNL = new Uint32Array([0,0x5a827999,0x6ed9eba1,0x8f1bbcdc,0xa953fd4e,0,0x5a827999,0x6ed9eba1,0x8f1bbcdc,0xa953fd4e]);
var FNR = new Uint32Array([0x50a28be6,0x5c4dd124,0x6d703ef3,0x7a6d76e9,0,0x50a28be6,0x5c4dd124,0x6d703ef3,0x7a6d76e9,0]);
function RIPEMD160Core(){ this.Xt = new Uint32Array(16); this.H5 = new Uint32Array(5); }
RIPEMD160Core.prototype.hash = function(out32, inp){
  var Xt=this.Xt, i, s, f, T;
  for(i=0;i<8;i++) Xt[i]=(inp[i*4]|(inp[i*4+1]<<8)|(inp[i*4+2]<<16)|(inp[i*4+3]<<24))>>>0;
  Xt[8]=0x80>>>0;
  for(i=9;i<15;i++) Xt[i]=0;
  Xt[14]=0x100;
  var A1=0x67452301,B1=0xefcdab89,C1=0x98badcfe,D1=0x10325476,E1=0xc3d2e1f0;
  var A2=A1,B2=B1,C2=C1,D2=D1,E2=E1;
  for(s=0;s<80;s++){
    var Rl=RL[s],Sl=SL[s],Kl=FNL[s>>>4];
    if(s<16){f=(B1^C1^D1);} else if(s<32){f=((B1&C1)|(~B1&D1));} else if(s<48){f=((B1|~C1)^D1);} else if(s<64){f=((B1&D1)|(C1&~D1));} else {f=(B1^(C1|~D1));}
    T=Xt[Rl]+Kl+f+A1>>>0; T=(T<<Sl | T>>>(32-Sl))>>>0; T=(T+E1)>>>0;
    A1=E1;E1=D1;D1=((C1<<10)|(C1>>>22))>>>0;C1=B1;B1=T;
    var Rr=RR[s],Sr=SR[s],Kr=FNR[s>>>4];
    if(s<16){f=(B2^(C2|~D2));} else if(s<32){f=((B2&D2)|(C2&~D2));} else if(s<48){f=((B2|~C2)^D2);} else if(s<64){f=((B2&C2)|(~B2&D2));} else {f=(B2^C2^D2);}
    T=Xt[Rr]+Kr+f+A2>>>0; T=(T<<Sr | T>>>(32-Sr))>>>0; T=(T+E2)>>>0;
    A2=E2;E2=D2;D2=((C2<<10)|(C2>>>22))>>>0;C2=B2;B2=T;
  }
  var H5=this.H5;
  H5[0]=((0xefcdab89+C1+D2)>>>0); H5[1]=((0x98badcfe+D1+E2)>>>0); H5[2]=((0x10325476+E1+A2)>>>0);
  H5[3]=((0xc3d2e1f0+A1+B2)>>>0); H5[4]=((0x67452301+B1+C2)>>>0);
  for(i=0;i<5;i++){ var v=H5[i]; out32[i*4]=v&255; out32[i*4+1]=(v>>>8)&255; out32[i*4+2]=(v>>>16)&255; out32[i*4+3]=(v>>>24)&255; }
};

/* ---------------- Pipeline Funil ---------------- */
function hexToBytes(h){ var b=new Uint8Array(h.length/2); for(var i=0;i<h.length;i+=2) b[i/2]=parseInt(h.substr(i,2),16); return b; }

function BatchPipeline(B){
  this.B = B;
  this.Xs = new Array(B); this.Ys = new Array(B); this.Zs = new Array(B);
  this.invZ = new Array(B); this.fwd = new Array(B);
  this.pub = new Uint8Array(33);
  this.sha = new SHA256Core();
  this.rmd = new RIPEMD160Core();
  this.shaOut = new Uint8Array(32);
  this.rmdOut = new Uint8Array(20);
  this.tb = new Uint8Array(20);
  this.nx=0n; this.ny=0n; this.nz=0n;
  this.scanCount = 0;
}
BatchPipeline.prototype.setTarget = function(hex20){
  var tb=this.tb;
  for(var i=0;i<20;i++) tb[i]=parseInt(hex20.substr(i*2,2),16);
};
BatchPipeline.prototype.generate = function(cx,cy,cz){
  var Xs=this.Xs,Ys=this.Ys,Zs=this.Zs,B=this.B,i,r;
  for(i=0;i<B;i++){ Xs[i]=cx; Ys[i]=cy; Zs[i]=cz; r=jacaddG(cx,cy,cz); cx=r[0]; cy=r[1]; cz=r[2]; }
  this.nx=cx; this.ny=cy; this.nz=cz;
};
BatchPipeline.prototype.invert = function(){
  var Zs=this.Zs,fwd=this.fwd,invZ=this.invZ,B=this.B,i;
  fwd[0]=Zs[0];
  for(i=1;i<B;i++) fwd[i]=fmul(fwd[i-1],Zs[i]);
  var inv=modpow_(fwd[B-1],P_-2n);
  for(i=B-1;i>=0;i--){ invZ[i]= i===0 ? inv : fmul(inv,fwd[i-1]); inv=fmul(inv,Zs[i]); }
};
BatchPipeline.prototype.scan = function(){
  var Xs=this.Xs,Ys=this.Ys,invZ=this.invZ,B=this.B;
  var pub=this.pub,sha=this.sha,rmd=this.rmd,shaOut=this.shaOut,rmdOut=this.rmdOut,tb=this.tb;
  var i,j,inv2,inv3,x,yp,w0,w1,w2,w3,w4,w5,w6,w7;
  for(i=0;i<B;i++){
    inv2=fmul(invZ[i],invZ[i]); inv3=fmul(inv2,invZ[i]);
    x=fmul(Xs[i],inv2); yp=fmul(Ys[i],inv3);
    pub[0]= (yp&1n)===1n ? 3 : 2;
    w0=Number(x & 0xffffffffn); x>>=32n;
    w1=Number(x & 0xffffffffn); x>>=32n;
    w2=Number(x & 0xffffffffn); x>>=32n;
    w3=Number(x & 0xffffffffn); x>>=32n;
    w4=Number(x & 0xffffffffn); x>>=32n;
    w5=Number(x & 0xffffffffn); x>>=32n;
    w6=Number(x & 0xffffffffn); x>>=32n;
    w7=Number(x & 0xffffffffn);
    pub[1]=w7>>>24;pub[2]=w7>>>16;pub[3]=w7>>>8;pub[4]=w7;
    pub[5]=w6>>>24;pub[6]=w6>>>16;pub[7]=w6>>>8;pub[8]=w6;
    pub[9]=w5>>>24;pub[10]=w5>>>16;pub[11]=w5>>>8;pub[12]=w5;
    pub[13]=w4>>>24;pub[14]=w4>>>16;pub[15]=w4>>>8;pub[16]=w4;
    pub[17]=w3>>>24;pub[18]=w3>>>16;pub[19]=w3>>>8;pub[20]=w3;
    pub[21]=w2>>>24;pub[22]=w2>>>16;pub[23]=w2>>>8;pub[24]=w2;
    pub[25]=w1>>>24;pub[26]=w1>>>16;pub[27]=w1>>>8;pub[28]=w1;
    pub[29]=w0>>>24;pub[30]=w0>>>16;pub[31]=w0>>>8;pub[32]=w0;
    sha.hash(shaOut,pub);
    rmd.hash(rmdOut,shaOut);
    if(((rmdOut[0]^tb[0])|(rmdOut[1]^tb[1])|(rmdOut[2]^tb[2])|(rmdOut[3]^tb[3]))!==0) continue;
    for(j=4;j<20;j++) if(rmdOut[j]!==tb[j]) break;
    if(j===20) return i;
  }
  return -1;
};
BatchPipeline.prototype.run = function(cx,cy,cz){
  this.generate(cx,cy,cz);
  this.invert();
  var idx = this.scan();
  return [idx, this.nx, this.ny, this.nz];
};

/* ---------------- Acelerador WASM (secp256k1 + SHA-256 + RIPEMD-160) ---------------- */
/* Módulo compilado em WAT via wabt (docs/wasm-modules/full.wat -> full.wasm, 6863 bytes).
   Endereçamento batch: BPTS@0x100000 (96 B/pt), BFWD@0x160000, BINVZ@0x180000,
   BT0..BT5@0x1A0000.., BPUB@0x1B0000, BSHA@0x1B1000, BRMD@0x1B2000, BTGT@0x1B3000.
   EC jacobiano em domínio Montgomery (8x32-bit limbs, base 2^32, LSB-first). */
var WASM_B64 = "AGFzbQEAAAABNglgAn9/AX9gA39/fwBgAn9/AGABfwF/YAAAYAR/f39/AGAFf39/f38Bf2AEf39/fwF/YAF/AAMbGgABAgMCAQEBAgICAAIEBAMFBgAABwICBQgABQMBAEAGggM6fwBBseqUkX0LfwBBAAt/AEEgC38AQcAAC38AQeAAC38AQYABC38AQcABC38AQeABC38AQaACC38AQYAEC38AQaAEC38AQcAEC38AQeAEC38AQYAFC38AQYAIC38AQaAIC38AQcAIC38AQeAIC38AQYAJC38AQaAJC38AQcAJC38AQeAJC38AQYAKC38AQaAKC38AQcAKC38AQeAKC38AQYALC38AQaALC38AQcALC38AQYAgC38AQaAgC38AQcAgC38AQeAgC38AQYAhC38AQaAhC38AQYCAwAALfwBBgIDYAAt/AEGAgOAAC38AQYCA6AALfwBBoIDoAAt/AEHAgOgAC38AQeCA6AALfwBBgIHoAAt/AEGggegAC38AQYCA7AALfwBBgKDsAAt/AEGAwOwAC38AQYDg7AALfwBBgMAAC38AQYDgAAt/AEGAoAELfwBBgOQAC38AQYDsAAt/AEGA9AALfwBBgPwAC38AQYCEAQt/AEGAhgELfwBBgKgBCwe3ARMDbWVtAgADYWRkAAUDc3ViAAYDbXVsAAcDc3FyAAgJdG9fbm9ybWFsAAkHdG9fbW9udAAKA2ludgAMBmphY2RibAANB2phY2FkZEcADgdpc196ZXJvAA8Jc2NhbGFyTXVsABAJdG9fYWZmaW5lABEIZ2V0X2xpbWIAEgZzaGEyNTYAFQlyaXBlbWQxNjAAFg5iYXRjaF9nZW5lcmF0ZQAXDGJhdGNoX2ludmVydAAYBHNjYW4AGQqAIBoNACAAIAFBAnRqKAIACw8AIAAgAUECdGogAjYCAAsqAQF/QQAhAgJAA0AgASACIAAgAhAAEAEgAkEBaiECIAJBCE8NAQwACwsLSQEEf0EBIQRBByEBAkADQCAAIAEQACECIwEgARAAIQMgAiADSw0BIAIgA0kEQEEAIQQMAgsgAUEARg0BIAFBAWshAQwACwsgBAuWAQIEfwF+QQAhAgJAA0AgAkECTw0BIAFBAEcEQEEBIQMFIAAQAyEDCyADQQBGBEAMAgtBACEFQQAhBAJAA0AgACAEEACtIwEgBBAArX0gBa19IQYgACAEIAZC/////w+DpxABIAZCAFMEf0EBBUEACyEFIARBAWohBCAEQQhPDQEMAAsLIAEgBWshASACQQFqIQIMAAsLC1cCAn8BfkEAIQRBACEDAkADQCAAIAMQAK0gASADEACtfCAErXwhBSACIAMgBUL/////D4OnEAEgBUIgiKchBCADQQFqIQMgA0EITw0BDAALCyACIAQQBAutAQMCfwF+AX9BACEEQQAhAwJAA0AgACADEACtIAEgAxAArX0gBK19IQUgAiADIAVC/////w+DpxABIAVCAFMEf0EBBUEACyEEIANBAWohAyADQQhPDQEMAAsLIARBAEcEQEEAIQZBACEDAkADQCACIAMQAK0jASADEACtfCAGrXwhBSACIAMgBUL/////D4OnEAEgBUIgiKchBiADQQFqIQMgA0EITw0BDAALCwsLuAMCBH8DfkEAIQMCQANAIwUgA0ECdGpBADYCACADQQFqIQMgA0EKTw0BDAALC0EAIQMCQANAIAAgAxAAIQVCACEHQQAhBAJAA0AgBa0gASAEEACtfiMFIARBAnRqKAIArXwhCCAIIAd8IQgjBSAEQQJ0aiAIQv////8Pg6c2AgAgCEIgiCEHIARBAWohBCAEQQhPDQEMAAsLIwVBIGooAgCtIAd8IQgjBUEgaiAIQv////8Pg6c2AgAjBUEkaiAIQiCIpzYCACMFKAIArSMArX5C/////w+DpyEGQgAhByAGrSMBKAIArX4jBSgCAK18IQggCCAHfCEIIAhCIIghB0EBIQQCQANAIAatIwEgBBAArX4jBSAEQQJ0aigCAK18IQggCCAHfCEIIwUgBEEBa0ECdGogCEL/////D4OnNgIAIAhCIIghByAEQQFqIQQgBEEITw0BDAALCyMFQSBqKAIArSAHfCEIIwVBHGogCEL/////D4OnNgIAIAhCIIghCSMFQSBqIwVBJGooAgAgCadqNgIAIANBAWohAyADQQhPDQEMAAsLIwUgAhACIAIjBUEgaigCABAECwoAIAAgACABEAcLCgAgACMDIAEQBwsKACAAIwQgARAHCx4BAn8gAUEgbiECIAFBH3EhAyAAIAIQACADdkEBcQtUAQF/IAAjBhACIwIjBxACQQAhAgJAA0AjCCACEAtBAEcEQCMHIwYjBxAHCyACQQFqIQIgAkGA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";

function wasmBytes(b64){
  var bin = atob(b64), arr = new Uint8Array(bin.length), i;
  for(i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function WasmBatchPipe(inst, B){
  this.B = Math.min(B, 4096);
  this.e = inst.exports;
  this.mem = new Uint8Array(this.e.mem.buffer);
  this.dv = new DataView(this.e.mem.buffer);
  this.OUT = 0x1B4000;
  this.done = false;
}
WasmBatchPipe._tryBuild = function(B, sharedModule){
  try {
    var mod = sharedModule || new WebAssembly.Module(wasmBytes(WASM_B64));
    var inst = new WebAssembly.Instance(mod);
    return new WasmBatchPipe(inst, B);
  } catch(e){ return null; }
};
WasmBatchPipe._rebuild = function(prev, newB, sharedModule){
  try {
    var mod = sharedModule || (prev && prev.mod ? prev.mod : null);
    if(!mod) mod = new WebAssembly.Module(wasmBytes(WASM_B64));
    var inst = new WebAssembly.Instance(mod);
    var pipe = new WasmBatchPipe(inst, newB);
    pipe.mod = mod;
    if(prev) pipe.setTarget(prev._targetHex);
    return pipe;
  } catch(e){ return prev || null; }
};
WasmBatchPipe.prototype.setTarget = function(hex20){
  var t = this.dv, addr = 0x1B3000, i;
  for(i=0;i<20;i++) t.setUint8(addr+i, parseInt(hex20.substr(i*2,2),16));
};
WasmBatchPipe.prototype.writeMont = function(addr, big){
  var dv = this.dv, i;
  for(i=0;i<8;i++){ dv.setUint32(addr+i*4, Number(big & 0xffffffffn), true); big >>= 32n; }
  this.e.to_mont(addr, addr);
};
WasmBatchPipe.prototype.readPlain = function(addr){
  var dv = this.dv, out = this.OUT, i, v;
  this.e.to_normal(addr, out);
  v = 0n;
  for(i=7;i>=0;i--) v = (v << 32n) | BigInt(dv.getUint32(out+i*4, true));
  return v;
};
WasmBatchPipe.prototype.generate = function(cx,cy,cz){
  var e = this.e;
  e.batch_generate(this.B, 0x1000, 0x1020, 0x1040);
  return [this.readPlain(0x1000), this.readPlain(0x1020), this.readPlain(0x1040)];
};
WasmBatchPipe.prototype.invert = function(){
  this.e.batch_invert(this.B);
};
WasmBatchPipe.prototype.scan = function(){
  return this.e.scan(0x1B3000, this.B);
};
WasmBatchPipe.prototype.run = function(cx,cy,cz){
  this.writeMont(0x1000, cx); this.writeMont(0x1020, cy); this.writeMont(0x1040, cz);
  var f = this.generate();
  this.invert();
  var idx = this.scan();
  return [idx, f[0], f[1], f[2]];
};

/* ---------------- Lane (fronteira aleatória + janela sequencial) ---------------- */
function Lane(rng, min, max, window){
  this.rng = rng;
  this.min = min; this.max = max;
  this.window = window;
  this.reset();
}
Lane.prototype.setPoint = function(){
  var pt = scalarMul(this.baseKey);
  this.cx = pt[0]; this.cy = pt[1]; this.cz = pt[2];
  this.foundBase = 0n;
  this.consumed = 0n;
};
Lane.prototype.reset = function(){
  this.baseKey = this.rng.bigRange(this.min, this.max);
  this.setPoint();
};

/* ---------------- Controlador (Searcher) ---------------- */
var ADAPTIVE_TARGET_MS = 150;
var ADAPTIVE_MIN_B = 512;
var ADAPTIVE_MAX_B = 1 << 21;
var ADAPTIVE_RATE = 0.5;
function Searcher(cfg){
  this.minKey = BigInt('0x'+cfg.startKey);
  this.maxKey = BigInt('0x'+cfg.endKey);
  this.searchMode = cfg.searchMode || 'random';
  this.sequential = (this.searchMode === 'sequential');
  this.hybrid = (this.searchMode === 'hybrid');
  this.maxKeysTotal = cfg.maxKeysTotal ? BigInt(cfg.maxKeysTotal) : 0n;
  this.workerIndex = cfg.workerIndex || 0;
  this.blockKeys = cfg.blockKeys ? BigInt(cfg.blockKeys) : 0n;
  this.keysTested = 0n;
  var B = cfg.pipeB || 2048;
  this.sharedModule = cfg.wasmModule || null;
  this.wasm = WasmBatchPipe._tryBuild(B, this.sharedModule);
  this.pipe = this.wasm || new BatchPipeline(B);
  this.pipe.setTarget(cfg.targetHash160);
  this.pipe._targetHex = cfg.targetHash160;
  this.pipeB = B;
  this.adaptiveB = B;
  this.pipeRebuildThreshold = B * 0.2;
  this.reportEvery = (cfg.batchSize || 5000) >>> 0;
  this.since = 0;

  /* Sequential state */
  this.seqKey = this.minKey;
  this.seqEnd = this.maxKey;
  var kp = scalarMul(this.minKey);
  this.seqCx = kp[0]; this.seqCy = kp[1]; this.seqCz = kp[2];

  /* Random lanes state (used by random and hybrid) */
  this.idx = 0;
  var lanes = cfg.lanes || 4;
  var win = BigInt(cfg.windowKeys || 262144);
  var wi = this.workerIndex;
  this.lanes = [];
  if (!this.sequential) {
    var i;
    for(i=0;i<lanes;i++){
      var seed = ((wi * 2654435761) ^ (i * 2246822519) ^ 0x9E3779B9) >>> 0;
      this.lanes.push(new Lane(new RNG(seed), this.minKey, this.maxKey, win));
    }
    if (cfg.fixedStart !== undefined){
      this.lanes[0].baseKey = BigInt('0x'+cfg.fixedStart);
      this.lanes[0].setPoint();
    }
  }

  /* Hybrid: alternate between sequential and random */
  this.hybridTurn = 0;
  this.hybridSeqRatio = 1;
  this.hybridRandRatio = 3;
}
Searcher.prototype.tick = function(){
  var B = this.pipe.B;

  if (this.hybrid) {
    var isSeqTurn = (this.hybridTurn % (this.hybridSeqRatio + this.hybridRandRatio)) < this.hybridSeqRatio;
    this.hybridTurn++;
    if (isSeqTurn) return this._tickSequential();
    else return this._tickRandom();
  }

  if (this.sequential) return this._tickSequential();
  return this._tickRandom();
};

Searcher.prototype._tickSequential = function(){
  var B = this.pipe.B;
  if (this.seqKey > this.seqEnd) {
    if (!this.hybrid) { self.postMessage({type:'done', workerIndex: this.workerIndex, count: Number(this.keysTested)}); return true; }
    this.seqKey = this.minKey;
    var kp = scalarMul(this.minKey);
    this.seqCx = kp[0]; this.seqCy = kp[1]; this.seqCz = kp[2];
  }
  var tickStart = performance.now();
  var f = this.pipe.run(this.seqCx, this.seqCy, this.seqCz);
  this.seqCx = f[1]; this.seqCy = f[2]; this.seqCz = f[3];
  if (f[0] >= 0) {
    var foundKey = this.seqKey + BigInt(f[0]);
    self.postMessage({type:'found', key: foundKey.toString(16).padStart(64,'0')});
    return true;
  }
  this.seqKey += BigInt(B);
  this.keysTested += BigInt(B);
  if (this.maxKeysTotal > 0n && this.keysTested >= this.maxKeysTotal) {
    self.postMessage({type:'done', workerIndex: this.workerIndex, count: Number(this.keysTested), reason:'quota'});
    return true;
  }
  if (this.blockKeys > 0n && this.keysTested >= this.blockKeys) {
    self.postMessage({type:'done', workerIndex: this.workerIndex, count: Number(this.keysTested)});
    return true;
  }
  var elapsed = performance.now() - tickStart;
  this.adaptiveB += ADAPTIVE_RATE * (B * (ADAPTIVE_TARGET_MS / Math.max(elapsed,1)) - this.adaptiveB);
  this.adaptiveB = Math.min(ADAPTIVE_MAX_B, Math.max(ADAPTIVE_MIN_B, Math.round(this.adaptiveB)));
  if(Math.abs(this.adaptiveB - this.pipeB) > this.pipeRebuildThreshold) this._rebuildPipe(this.adaptiveB);
  this.since += B;
  if (this.since >= this.reportEvery) {
    self.postMessage({type:'progress', count: this.since, currentKey: this.seqKey.toString(16).padStart(64,'0')});
    this.since = 0;
  }
  return false;
};

Searcher.prototype._tickRandom = function(){
  var B = this.pipe.B;
  var lane = this.lanes[this.idx];
  var tickStart = performance.now();
  var runsLeft = 4;
  var cx = lane.cx, cy = lane.cy, cz = lane.cz;
  var f;
  var actualRuns = 0;
  while(runsLeft-- > 0){
    f = this.pipe.run(cx, cy, cz);
    cx = f[1]; cy = f[2]; cz = f[3];
    actualRuns++;
    if(f[0] >= 0){
      self.postMessage({type:'found', key:(lane.baseKey + lane.foundBase + BigInt(f[0])).toString(16).padStart(64,'0')});
      return true;
    }
    lane.foundBase += BigInt(this.pipe.B);
    lane.consumed += BigInt(this.pipe.B);
    if(lane.consumed >= lane.window) break;
  }
  lane.cx = cx; lane.cy = cy; lane.cz = cz;
  if (lane.consumed >= lane.window) lane.reset();
  var elapsed = performance.now() - tickStart;
  this.adaptiveB += ADAPTIVE_RATE * (B * (ADAPTIVE_TARGET_MS / Math.max(elapsed,1)) - this.adaptiveB);
  this.adaptiveB = Math.min(ADAPTIVE_MAX_B, Math.max(ADAPTIVE_MIN_B, Math.round(this.adaptiveB)));
  if(Math.abs(this.adaptiveB - this.pipeB) > this.pipeRebuildThreshold) this._rebuildPipe(this.adaptiveB);
  this.keysTested += BigInt(B * actualRuns);
  if (this.maxKeysTotal > 0n && this.keysTested >= this.maxKeysTotal) {
    self.postMessage({type:'done', workerIndex: this.workerIndex, count: Number(this.keysTested), reason:'quota'});
    return true;
  }
  if (this.blockKeys > 0n && this.keysTested >= this.blockKeys) {
    self.postMessage({type:'done', workerIndex: this.workerIndex, count: Number(this.keysTested)});
    return true;
  }
  this.since += B * actualRuns;
  if (this.since >= this.reportEvery){
    var estKey = lane.baseKey + lane.consumed;
    self.postMessage({type:'progress', count:this.since, currentKey:estKey.toString(16).padStart(64,'0')});
    this.since = 0;
  }
  this.idx = (this.idx + 1) % this.lanes.length;
  return false;
};
Searcher.prototype._rebuildPipe = function(newB){
  newB = Math.min(ADAPTIVE_MAX_B, Math.max(ADAPTIVE_MIN_B, newB));
  var savedTarget = this.pipe._targetHex;
  if(this.wasm){
    if(newB > 4096) newB = 4096;
    this.pipe = WasmBatchPipe._rebuild(this.wasm, newB, this.sharedModule) || this.pipe;
  } else {
    this.pipe = new BatchPipeline(newB);
  }
  if(savedTarget) this.pipe.setTarget(savedTarget);
  this.pipe._targetHex = savedTarget;
  this.pipeB = newB;
  this.pipeRebuildThreshold = newB * 0.2;
};

var _sr = null;
var _repositionCfg = null;
var _srYield = 16;
var _workerStopped = false;

self.onmessage = function(e){
  var m = e.data;
  if (m.type === 'stop'){
    _workerStopped = true;
    _sr = null;
    return;
  }
  if (m.type === 'start'){
    _workerStopped = false;
    _sr = new Searcher(m);
    _srYield = _sr.sequential ? 40 : (_sr.hybrid ? 20 : 16);
    (function loop(){
      if (_workerStopped) return;
      if (_repositionCfg) {
        _sr = new Searcher(_repositionCfg);
        _repositionCfg = null;
        _srYield = _sr.sequential ? 40 : (_sr.hybrid ? 20 : 16);
      }
      for (var t = 0; t < _srYield; t++) {
        if (_sr.tick()) return;
      }
      setTimeout(loop, 0);
    })();
  } else if (m.type === 'reposition'){
    _repositionCfg = m;
  } else if (m.type === 'verify'){
    var keys = m.keys;
    var targetH160 = m.targetHash160;
    var tb = new Uint8Array(20);
    for(var ti=0;ti<20;ti++) tb[ti]=parseInt(targetH160.substr(ti*2,2),16);
    var results = [];
    var REPORT_EVERY = 512;
    var wasmInst = null;
    var wasmDv = null;
    try {
      var mod = m.wasmModule || new WebAssembly.Module(wasmBytes(WASM_B64));
      wasmInst = new WebAssembly.Instance(mod);
      wasmDv = new DataView(wasmInst.exports.mem.buffer);
    } catch(e) { wasmInst = null; }
    if(wasmInst){
      var pubBytes = new Uint8Array(33);
      var wasmMem8 = new Uint8Array(wasmInst.exports.mem.buffer);
      var wasmDv2 = new DataView(wasmInst.exports.mem.buffer);
      var K_ADDR = 0x40000;
      for(var k=0; k<keys.length; k++){
        try {
          var hex = keys[k];
          var ka32 = K_ADDR + 31;
          for(var h=0;h<64;h+=2) wasmMem8[ka32-(h>>>1)] = parseInt(hex.substr(h,2),16);
          wasmInst.exports.scalarMul(K_ADDR, 0x40020, 0x40040, 0x40060);
          var parity = wasmInst.exports.to_affine(0x40020, 0x40040, 0x40060, 0x40080, 0x400A0);
          pubBytes[0] = parity === 0 ? 2 : 3;
          for(var lw=0;lw<8;lw++){
            var limb = wasmDv2.getUint32(0x40080+lw*4, true);
            pubBytes[29-lw*4] = (limb>>>24)&0xff;
            pubBytes[30-lw*4] = (limb>>>16)&0xff;
            pubBytes[31-lw*4] = (limb>>>8)&0xff;
            pubBytes[32-lw*4] = limb&0xff;
          }
          for(var pi=0;pi<33;pi++) wasmMem8[0x400C0+pi] = pubBytes[pi];
          wasmInst.exports.sha256(0x400C0, 0x40100);
          wasmInst.exports.ripemd160(0x40100, 0x40120);
          var r0=wasmMem8[0x40120]^tb[0], r1=wasmMem8[0x40121]^tb[1], r2=wasmMem8[0x40122]^tb[2], r3=wasmMem8[0x40123]^tb[3];
          if((r0|r1|r2|r3)===0){
            var full=true;
            for(var j=4;j<20;j++) if(wasmMem8[0x40120+j]!==tb[j]){full=false;break;}
            if(full) results.push({idx:k, match:true});
          }
        } catch(ek) {}
        if((k+1)%REPORT_EVERY===0 || k===keys.length-1) self.postMessage({type:'verify-progress', done:k+1});
      }
    } else {
      var sha = new SHA256Core();
      var rmd = new RIPEMD160Core();
      var shaOut = new Uint8Array(32);
      var rmdOut = new Uint8Array(20);
      var pub = new Uint8Array(33);
      for(var k=0; k<keys.length; k++){
        try {
          var keyBI = BigInt('0x' + keys[k]);
          var kp = scalarMul(keyBI);
          if(kp[1] !== 0n){
            var Xj=kp[0], Yj=kp[1], Zj=kp[2];
            var invZ=modpow_(Zj,P_-2n);
            var inv2=fmul(invZ,invZ);
            var x=fmul(Xj,inv2);
            var yp=fmul(Yj,fmul(inv2,invZ));
            pub[0]=(yp&1n)===1n?3:2;
            var w0=Number(x&0xffffffffn); x>>=32n;
            var w1=Number(x&0xffffffffn); x>>=32n;
            var w2=Number(x&0xffffffffn); x>>=32n;
            var w3=Number(x&0xffffffffn); x>>=32n;
            var w4=Number(x&0xffffffffn); x>>=32n;
            var w5=Number(x&0xffffffffn); x>>=32n;
            var w6=Number(x&0xffffffffn); x>>=32n;
            var w7=Number(x&0xffffffffn);
            pub[1]=w7>>>24;pub[2]=w7>>>16;pub[3]=w7>>>8;pub[4]=w7;
            pub[5]=w6>>>24;pub[6]=w6>>>16;pub[7]=w6>>>8;pub[8]=w6;
            pub[9]=w5>>>24;pub[10]=w5>>>16;pub[11]=w5>>>8;pub[12]=w5;
            pub[13]=w4>>>24;pub[14]=w4>>>16;pub[15]=w4>>>8;pub[16]=w4;
            pub[17]=w3>>>24;pub[18]=w3>>>16;pub[19]=w3>>>8;pub[20]=w3;
            pub[21]=w2>>>24;pub[22]=w2>>>16;pub[23]=w2>>>8;pub[24]=w2;
            pub[25]=w1>>>24;pub[26]=w1>>>16;pub[27]=w1>>>8;pub[28]=w1;
            pub[29]=w0>>>24;pub[30]=w0>>>16;pub[31]=w0>>>8;pub[32]=w0;
            sha.hash(shaOut, pub);
            rmd.hash(rmdOut, shaOut);
            var match4=((rmdOut[0]^tb[0])|(rmdOut[1]^tb[1])|(rmdOut[2]^tb[2])|(rmdOut[3]^tb[3]))===0;
            if(match4){
              var full=true;
              for(var j=4;j<20;j++) if(rmdOut[j]!==tb[j]){full=false;break;}
              if(full) results.push({idx:k, match:true});
            }
          }
        } catch(ek) {}
        if((k+1)%REPORT_EVERY===0 || k===keys.length-1) self.postMessage({type:'verify-progress', done:k+1});
      }
    }
    if(results.length>0) self.postMessage({type:'verify-result', results:results});
    self.postMessage({type:'verify-done'});
  }
};