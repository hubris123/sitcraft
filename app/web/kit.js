// SitCraft iPad app — the browser's versions of the sync engine's helpers (hashing, zipping, text ⇄ bytes).
// sha-256 is plain JavaScript so it can run without waiting (the engine expects an instant answer); zipping uses pako.
(function () {
  'use strict';
  var enc = new TextEncoder(), dec = new TextDecoder();
  var K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256Bytes(msg) {
    var l = msg.length, nBlocks = ((l + 9 + 63) >> 6), buf = new Uint8Array(nBlocks * 64);
    buf.set(msg); buf[l] = 0x80;
    var bits = l * 8, hi = Math.floor(bits / 0x100000000), lo = bits >>> 0, e = buf.length;
    buf[e - 8] = hi >>> 24; buf[e - 7] = hi >>> 16; buf[e - 6] = hi >>> 8; buf[e - 5] = hi;
    buf[e - 4] = lo >>> 24; buf[e - 3] = lo >>> 16; buf[e - 2] = lo >>> 8; buf[e - 1] = lo;
    var H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
    for (var b = 0; b < nBlocks; b++) {
      var o = b * 64;
      for (var i = 0; i < 16; i++) W[i] = (buf[o + i * 4] << 24) | (buf[o + i * 4 + 1] << 16) | (buf[o + i * 4 + 2] << 8) | buf[o + i * 4 + 3];
      for (i = 16; i < 64; i++) {
        var x = W[i - 15], y = W[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], ee = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((ee >>> 6) | (ee << 26)) ^ ((ee >>> 11) | (ee << 21)) ^ ((ee >>> 25) | (ee << 7));
        var ch = (ee & f) ^ (~ee & g);
        var t1 = (h + S1 + ch + K[i] + W[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var mj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + mj) | 0;
        h = g; g = f; f = ee; ee = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + ee) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = '';
    for (i = 0; i < 8; i++) out += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    return out;
  }
  var kit = {
    sha: function (s) { return sha256Bytes(enc.encode(String(s))); },
    gzip: function (s) { return window.pako.gzip(enc.encode(String(s))); },
    gunzip: function (b) { return dec.decode(window.pako.ungzip(b instanceof Uint8Array ? b : new Uint8Array(b))); },
    bytes: function (s) { return enc.encode(String(s)); },
    text: function (b) { return dec.decode(b instanceof Uint8Array ? b : new Uint8Array(b)); },
    len: function (s) { return enc.encode(String(s)).length; }
  };
  window.SC_KIT = kit;
  if (window.SitSync) window.SitSync.configure(kit);
})();
