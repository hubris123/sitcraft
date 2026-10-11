// Sitcom Garage — the show data in pieces (Oct 11, 2026).
// The live data is kept as small named pieces instead of one big file, so a save writes only the pieces that changed
// (usually one episode's script). The pieces are the same ones the Drive copy already uses (sync.js split/join), so a
// device can compare them directly.
// Big copies that never change once made — the lines of a script version, the script as first written — are moved out
// into a content store: each is saved once under a name made from its contents (same contents → same name → stored
// once) and the data keeps only that name ("elsRef"). Show versions (Versions & backup) are manifests over the same store.
// Works in the window (window.SCPieces) and in Node (require) — no other dependencies.
(function (root) {
  'use strict';
  var SEP = '\u0001';
  var WHOLE_MAX = 16000;   // must match sync.js: a section smaller than this is one piece; bigger ones per show / episode / item

  // Content name: a 53-bit hash (cyrb53) + the length, e.g. "1f3a9c0b2d4e5-2k9s". Fast, and with the length added the
  // chance of two different contents sharing a name is negligible at our sizes.
  function hash(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, i, ch;
    for (i = 0; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    var n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return ('0000000000000' + n.toString(16)).slice(-14) + '-' + str.length.toString(36);
  }

  // { format, version, data, ui } → { name: JSON text }   (same names and texts as sync.js split)
  function split(o) {
    var parts = {};
    ['data', 'ui'].forEach(function (top) {
      var obj = (o && o[top]) || {};
      Object.keys(obj).forEach(function (k) {
        var v = obj[k];
        if (v === undefined) return;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          var whole = JSON.stringify(v);
          if (whole.length <= WHOLE_MAX) parts[top + SEP + k] = whole;
          else Object.keys(v).forEach(function (sub) { if (v[sub] !== undefined) parts[top + SEP + k + SEP + sub] = JSON.stringify(v[sub]); });
        } else parts[top + SEP + k] = JSON.stringify(v);
      });
    });
    return parts;
  }
  // { name: JSON text } → { data, ui }   (same as sync.js join)
  function join(parts) {
    var o = { data: {}, ui: {} };
    Object.keys(parts || {}).sort().forEach(function (name) {
      var p = name.split(SEP), v = JSON.parse(parts[name]);
      if (!o[p[0]]) return;
      if (p.length === 2) o[p[0]][p[1]] = v;
      else { o[p[0]][p[1]] = o[p[0]][p[1]] || {}; o[p[0]][p[1]][p.slice(2).join(SEP)] = v; }
    });
    return o;
  }
  // Which store key / sub-key a piece name stands for (for patching the data in place)
  function where(name) { var p = name.split(SEP); return { top: p[0], key: p[1], sub: p.length > 2 ? p.slice(2).join(SEP) : null }; }
  // Compare two piece sets → { changed: [names], removed: [names] }
  function diff(now, before) {
    var changed = [], removed = [];
    Object.keys(now).forEach(function (n) { if (!before || before[n] !== now[n]) changed.push(n); });
    Object.keys(before || {}).forEach(function (n) { if (!(n in now)) removed.push(n); });
    return { changed: changed, removed: removed };
  }

  // Move the big unchanging copies out of the scripts: versions[].els and original.els → elsRef (in place).
  // put(name, text) stores a content piece. Returns how many were moved.
  function externalize(data, put) {
    var n = 0, sc = data && data.scripts;
    if (!sc || typeof sc !== 'object') return 0;
    var out = function (obj) {
      if (!obj || !Array.isArray(obj.els)) return;
      var t = JSON.stringify(obj.els), h = hash(t);
      put(h, t); obj.elsRef = h; delete obj.els; n++;
    };
    Object.keys(sc).forEach(function (k) {
      var s = sc[k]; if (!s || typeof s !== 'object') return;
      (s.versions || []).forEach(out);
      out(s.original);
    });
    return n;
  }
  // The lines of a version / original: kept inline, or read from the content store. get(name) → text or null.
  function els(obj, get) {
    if (!obj) return null;
    if (Array.isArray(obj.els)) return obj.els;
    if (!obj.elsRef) return null;
    var t = get ? get(obj.elsRef) : null;
    if (t == null) return null;
    try { return JSON.parse(t); } catch (e) { return null; }
  }
  // Every content name the data points to (so devices can tell which pieces must exist / be shared)
  function refs(data) {
    var out = {}, sc = data && data.scripts;
    Object.keys(sc || {}).forEach(function (k) {
      var s = sc[k]; if (!s) return;
      (s.versions || []).forEach(function (v) { if (v && v.elsRef) out[v.elsRef] = 1; });
      if (s.original && s.original.elsRef) out[s.original.elsRef] = 1;
    });
    return Object.keys(out);
  }

  // ---- Show versions (Versions & backup) as manifests over the content store ----
  // snapshot (the old one-file format, 'sitcom-writer/show') → manifest + the pieces it needs
  function manifest(snap, put) {
    var pieces = {};
    var add = function (name, v) { var t = JSON.stringify(v === undefined ? null : v), h = hash(t); put(h, t); pieces[name] = h; };
    Object.keys(snap || {}).forEach(function (k) {
      if (k === 'format' || k === 'version' || k === 'savedAt') return;
      var v = snap[k];
      // per-episode sections are stored per episode, so an unchanged episode is shared between versions
      if (v && typeof v === 'object' && !Array.isArray(v) && ['structures', 'timelines', 'timelineMeta', 'scripts', 'worldLog'].indexOf(k) >= 0) {
        Object.keys(v).forEach(function (sub) { add(k + SEP + sub, v[sub]); });
        if (!Object.keys(v).length) add(k, {});
      } else add(k, v);
    });
    return { format: 'sitcom-writer/show-manifest', version: 1, savedAt: (snap && snap.savedAt) || new Date().toISOString(), pieces: pieces };
  }
  // manifest → the snapshot again. get(name) → text or null. Returns { snap, missing: [names] }.
  function unmanifest(m, get) {
    var snap = { format: 'sitcom-writer/show', version: 1, savedAt: m.savedAt }, missing = [];
    Object.keys(m.pieces || {}).forEach(function (name) {
      var h = m.pieces[name], t = get(h);
      if (t == null) { if (missing.indexOf(h) < 0) missing.push(h); return; }
      var v = JSON.parse(t), p = name.split(SEP);
      if (p.length > 1) { snap[p[0]] = snap[p[0]] || {}; snap[p[0]][p.slice(1).join(SEP)] = v; }
      else if (!(p[0] in snap) || v !== null) snap[p[0]] = v;
    });
    return { snap: snap, missing: missing };
  }
  function manifestRefs(m) { var o = {}; Object.keys((m && m.pieces) || {}).forEach(function (n) { o[m.pieces[n]] = 1; }); return Object.keys(o); }

  // Every content name a piece's text points to (found without parsing it)
  var REF_RE = /"elsRef":"([0-9a-f]{14}-[0-9a-z]+)"/g;
  function refsIn(text) { var out = [], m; REF_RE.lastIndex = 0; while ((m = REF_RE.exec(text || ''))) out.push(m[1]); return out; }

  // ---- The store on a device: the live pieces + the content store, over a tiny backend ----
  // backend: { read(key) → text|null, write(key, text), remove(key), has?(key) }
  //   'index'   — which pieces make up the live data (+ the file's format and when it was saved)
  //   'p/<id>'  — one live piece (its id comes from its name, so a piece always lands in the same place)
  //   'c/<hash>'— one content piece (a script version's lines, a show version's section…), never changed once written
  // Keeps what it read in memory, so asking for the pieces again costs nothing.
  function createStore(b) {
    var cache = null;
    var fileOf = function (name) { return 'p-' + hash(name); };
    var has = function (k) { return b.has ? b.has(k) : b.read(k) != null; };
    function load() {
      if (cache) return cache;
      var t = b.read('index'); if (!t) return null;
      var idx; try { idx = JSON.parse(t); } catch (e) { return null; }
      var parts = {}, missing = [];
      Object.keys(idx.parts || {}).forEach(function (n) { var x = b.read('p/' + idx.parts[n]); if (x == null) missing.push(n); else parts[n] = x; });
      missing.forEach(function (n) { delete idx.parts[n]; });
      cache = { meta: idx.meta || { format: 'sitcom-writer/app-data', version: 1 }, savedAt: idx.savedAt || null, files: idx.parts || {}, parts: parts, missing: missing };
      return cache;
    }
    function writeIndex() { b.write('index', JSON.stringify({ format: 'sitcom-garage/data-pieces', version: 1, meta: cache.meta, savedAt: cache.savedAt, parts: cache.files })); }
    // Write only the given pieces (and forget the removed ones). The list is written last, so it never names a piece
    // that isn't there yet.
    function save(meta, changed, removed, savedAt) {
      load();
      if (!cache) cache = { meta: meta || { format: 'sitcom-writer/app-data', version: 1 }, savedAt: null, files: {}, parts: {}, missing: [] };
      var gone = [];
      Object.keys(changed || {}).forEach(function (n) { var f = cache.files[n] || fileOf(n); b.write('p/' + f, changed[n]); cache.files[n] = f; cache.parts[n] = changed[n]; });
      (removed || []).forEach(function (n) { if (cache.files[n]) gone.push(cache.files[n]); delete cache.files[n]; delete cache.parts[n]; });
      if (meta) cache.meta = { format: meta.format || 'sitcom-writer/app-data', version: meta.version || 1 };
      cache.savedAt = savedAt || new Date().toISOString();
      writeIndex();
      gone.forEach(function (f) { try { b.remove('p/' + f); } catch (e) {} });
      return { changed: Object.keys(changed || {}).length, removed: gone.length };
    }
    // Make the live pieces exactly these (a fresh copy from Drive): writes only the ones that differ
    function replace(meta, parts, savedAt) {
      var cur = (load() || { parts: {} }).parts, d = diff(parts, cur), ch = {};
      d.changed.forEach(function (n) { ch[n] = parts[n]; });
      return save(meta, ch, d.removed, savedAt);
    }
    return {
      load: load, save: save, replace: replace,
      exists: function () { return !!load(); },
      pieceGet: function (h) { return h ? b.read('c/' + h) : null; },
      pieceHas: function (h) { return !!h && has('c/' + h); },
      piecePut: function (h, text) { if (!h || has('c/' + h)) return false; b.write('c/' + h, text); return true; },
      forget: function () { cache = null; }
    };
  }

  var api = { SEP: SEP, hash: hash, split: split, join: join, where: where, diff: diff, externalize: externalize, els: els, refs: refs, refsIn: refsIn,
    manifest: manifest, unmanifest: unmanifest, manifestRefs: manifestRefs, createStore: createStore };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SCPieces = api;
})(typeof window !== 'undefined' ? window : this);
