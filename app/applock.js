// Sitcom Garage — the App lock's PIN (a 6-digit PIN to open the app; security-plan.md). The PIN itself is never stored:
// only a salted, slowed-down fingerprint of it (PBKDF2-SHA-256), kept in the show data so the PC and the iPad share it.
// Basic security on purpose: it stops someone at the computer or holding the iPad, it doesn't scramble the files.
(function (root) {
  'use strict';
  var IT = 150000;
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  function subtle() { try { return root.crypto && root.crypto.subtle && root.TextEncoder ? root.crypto.subtle : null; } catch (e) { return null; } }
  function fp(pin, salt, it) {
    var S = subtle(), enc = new root.TextEncoder();
    if (!S) {   // (very old browsers only) a plain hash instead
      var txt = salt + ':' + pin, h = 2166136261; for (var i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return Promise.resolve('f' + h.toString(16));
    }
    return S.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits'])
      .then(function (k) { return S.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(String(salt)), iterations: it }, k, 256); })
      .then(hex);
  }
  function salt() {
    var a = new Uint8Array(16);
    try { root.crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256); }
    return hex(a.buffer);
  }
  var api = {
    ok: function (pin) { return /^\d{6}$/.test(String(pin || '')); },
    // → { on, salt, hash, it, at } to keep in the data (the minutes setting is kept alongside)
    make: function (pin) { var s = salt(); return fp(pin, s, IT).then(function (h) { return { on: true, v: 1, salt: s, hash: h, it: IT, at: new Date().toISOString() }; }); },
    check: function (pin, rec) { if (!rec || !rec.hash || !api.ok(pin)) return Promise.resolve(false); return fp(pin, rec.salt, rec.it || IT).then(function (h) { return h === rec.hash; }); },
    isOn: function (rec) { return !!(rec && rec.on && rec.hash); },
    // A new PIN typed twice → what to show under the boxes, and whether the button may be used:
    //   both empty → yellow "No PIN chosen yet" · still typing → grey "6 digits" · second full but different → red
    //   "PINs don't match" · same → green "✓ PINs match" (the button turns green and pulses)
    pair: function (a, b) {
      a = String(a || ''); b = String(b || '');
      if (!a && !b) return { state: 'empty', text: 'No PIN chosen yet — type a 6-digit PIN in both boxes.', color: '#f2b33d', ready: false };
      if (b.length === 6 && a !== b) return { state: 'mismatch', text: 'PINs don’t match.', color: '#f5a39b', ready: false };
      if (api.ok(a) && a === b) return { state: 'match', text: '✓ PINs match', color: '#2ec4b0', ready: true };
      return { state: 'typing', text: a.length < 6 ? '6 digits' : 'Type the same 6 digits again.', color: '#8d9098', ready: false };
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SCAppLock = api;
})(typeof window !== 'undefined' ? window : this);
