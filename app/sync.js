// Sitcom Garage — Drive sync: one device in charge ("primary") at a time, the others view only.
// Everything travels through the writer's own Google Drive folder "SitCraft Backups":
//   SitCraft Control.json      — who is in charge, the data version, a heartbeat, a handoff request, the history log (tiny; checked often)
//   SitCraft Live Index.json   — the list of pieces that make up the live copy, each with a fingerprint
//   Live data/p-….json.gz      — the pieces: one per episode script / storyboard / timeline, one per show bible, the library, etc.
//   Rescued edits/…            — edits a device couldn't upload before another device took control (never thrown away)
//   Pieces/<name>.json.gz      — things that never change once made (a saved script version's lines…), stored once each
//                                under a name made from their contents and shared by every copy that uses them
// Only pieces whose fingerprint changed are uploaded or downloaded, so typing in one script sends only that episode.
// Each device keeps the same pieces locally too (renderer/pieces.js; local.parts / local.replace / local.pieces); a device
// that still has the old one-file data (local.read / local.write only) works as before.
// No Electron in here, so it can be tested on its own (tools/test/sync-engine.js) with a pretend Drive.
'use strict';
// The few things that differ between the PC (Node) and the iPad (browser): hashing, zipping, text ⇄ bytes.
// On the PC they come from Node; the iPad web app calls configure() with its own (pure-JS sha-256 + pako).
const K = (function () {
  if (typeof require === 'function' && typeof process !== 'undefined' && process.versions && process.versions.node) {
    const zlib = require('zlib'), crypto = require('crypto');
    return {
      sha: (s) => crypto.createHash('sha256').update(s).digest('hex'),
      gzip: (s) => zlib.gzipSync(Buffer.from(s)),
      gunzip: (b) => zlib.gunzipSync(b).toString('utf8'),
      bytes: (s) => Buffer.from(s),
      text: (b) => Buffer.from(b).toString('utf8'),
      len: (s) => Buffer.byteLength(s)
    };
  }
  return {};
})();
function configure(k) { Object.assign(K, k || {}); }

const CONTROL = 'SitCraft Control.json';
const INDEX = 'SitCraft Live Index.json';
const PARTS_FOLDER = 'Live data';
const RESCUE_FOLDER = 'Rescued edits';
const PIECES_FOLDER = 'Pieces';
const QUIET_MS = 8000;        // upload this long after the last change…
const MAX_WAIT_MS = 30000;    // …but never wait longer than this while changes keep coming
const CHECK_MS = 10000;       // how often every device peeks at the control file
const BEAT_MS = 20000;        // the primary refreshes its "still here" time this often
const AWAY_MS = 45000;        // a primary not seen for this long is treated as switched off or asleep
const WHOLE_MAX = 16000;      // a section smaller than this travels as one piece; bigger ones are split per show / episode / item
const HISTORY_MAX = 40;
const SEP = '\u0001';

// renderer/merge.js: the per-item fingerprint each device keeps at its last sync (so "Unsaved changes" can tell who changed what)
let MERGE = null;
function mergeApi() {
  if (MERGE) return MERGE;
  try { if (typeof module === 'object' && typeof require === 'function') MERGE = require('./renderer/merge.js'); } catch (e) {}
  if (!MERGE && typeof SCMerge !== 'undefined') MERGE = SCMerge;   // eslint-disable-line no-undef
  return MERGE;
}
function baseOf(text) { try { const M = mergeApi(); return M && text ? M.fingerprint(text) : null; } catch (e) { return null; } }
const kindName = (k) => k === 'ipad' ? 'iPad' : 'PC';
function clock(t) { const d = new Date(t); const h = d.getHours(), m = d.getMinutes(); return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM'); }
const sha = (s) => K.sha(s);
const partFile = (name) => 'p-' + sha(name).slice(0, 24) + '.json.gz';
// The content pieces a live piece points to (a script version's lines: "elsRef":"<name>")
const REF_RE = /"elsRef":"([0-9a-f]{14}-[0-9a-z]+)"/g;
function refsIn(text) { const out = []; let m; REF_RE.lastIndex = 0; while ((m = REF_RE.exec(text || ''))) out.push(m[1]); return out; }
// slimObj for pieces that are already split (only the Versions & backup list can hold such contents)
function slimParts(parts) {
  const pre = 'data' + SEP + 'backups'; let out = parts;
  const f = (a) => Array.isArray(a) ? a.map(x => (x && x.driveId && x.data) ? Object.assign({}, x, { data: '' }) : x) : a;
  Object.keys(parts).forEach(n => {
    if (n !== pre && n.indexOf(pre + SEP) !== 0) return;
    const t = parts[n]; if (typeof t !== 'string' || t.indexOf('"driveId"') < 0) return;
    try { let v = JSON.parse(t); if (n === pre) Object.keys(v || {}).forEach(k => { v[k] = f(v[k]); }); else v = f(v); if (out === parts) out = Object.assign({}, parts); out[n] = JSON.stringify(v); } catch (e) {}
  });
  return out;
}

// Version contents that are already safe in Drive are left out of the live copy (their files are fetched from Drive when needed)
function slimObj(o) {
  const b = o && o.data && o.data.backups;
  if (b && typeof b === 'object') Object.keys(b).forEach(k => {
    if (Array.isArray(b[k])) b[k] = b[k].map(x => (x && x.driveId && x.data) ? Object.assign({}, x, { data: '' }) : x);
  });
  return o;
}
function slim(text) { try { return JSON.stringify(slimObj(JSON.parse(text))); } catch (e) { return text; } }

// The data file → named pieces (JSON text each)
function split(text) {
  const o = slimObj(JSON.parse(text)), parts = {};
  ['data', 'ui'].forEach(top => {
    const obj = o[top] || {};
    Object.keys(obj).forEach(k => {
      const v = obj[k];
      if (v === undefined) return;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const whole = JSON.stringify(v);
        if (whole.length <= WHOLE_MAX) parts[top + SEP + k] = whole;
        else Object.keys(v).forEach(sub => { if (v[sub] !== undefined) parts[top + SEP + k + SEP + sub] = JSON.stringify(v[sub]); });
      } else parts[top + SEP + k] = JSON.stringify(v);
    });
  });
  return { meta: { format: o.format || 'sitcom-writer/app-data', version: o.version || 1 }, parts };
}
// Named pieces → the data file
function join(meta, parts, savedAt) {
  const o = { format: meta.format, version: meta.version, savedAt: savedAt || new Date().toISOString(), data: {}, ui: {} };
  Object.keys(parts).sort().forEach(name => {
    const p = name.split(SEP), v = JSON.parse(parts[name]);
    if (p.length === 2) o[p[0]][p[1]] = v;
    else { o[p[0]][p[1]] = o[p[0]][p[1]] || {}; o[p[0]][p[1]][p.slice(2).join(SEP)] = v; }
  });
  return JSON.stringify(o);
}
async function pool(items, n, fn) {
  let i = 0; const out = [];
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

function createSync(o) {
  const drive = o.drive, local = o.local, settings = o.settings, me = o.device, now = o.now || (() => Date.now());
  const emit = o.emit || (() => {});
  // (wrapped so browsers don't complain about calling setTimeout as a method)
  const T = o.timers || { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h), every: (f, ms) => setInterval(f, ms), stop: (h) => clearInterval(h) };
  const st = Object.assign({ syncOn: false, syncPrimary: false, syncVersion: 0, syncHash: '', syncDirtySince: 0, syncLastUpload: 0, syncNotice: null }, settings.get());
  const save = (p) => { Object.assign(st, p); settings.set(p); };
  const s = { ids: {}, quiet: null, check: null, offline: false, error: '', lastCheck: 0, control: null, index: null, block: false, lastBeat: 0, lastSent: null };

  // One Drive job at a time, so a save never interleaves with a handoff
  let chain = Promise.resolve();
  const run = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  const devOf = (d) => d ? { id: d.id, name: d.name, kind: d.kind } : null;
  const isMe = (d) => !!(d && d.id === me.id);
  const fail = (err) => {
    const auth = !!(err && (err.code === 'drive_auth' || err.code === 'drive_off'));
    s.offline = !auth; s.error = auth ? err.code : String((err && err.message) || err);
    status(true);
  };
  const ok = () => { s.offline = false; s.error = ''; };

  // ---- this device's live copy, as pieces ----
  const shaMemo = {};   // a piece's fingerprint is only worked out again when its text changed
  const partSha = (n, t) => { const m = shaMemo[n]; if (m && m[0] === t) return m[1]; const h = sha(t); shaMemo[n] = [t, h]; return h; };
  const liveHash = (live) => live ? sha(Object.keys(live.parts).sort().map(n => n + '\u0002' + partSha(n, live.parts[n])).join('\u0003')) : '';
  const liveText = (live) => join(live.meta || { format: 'sitcom-writer/app-data', version: 1 }, live.parts, live.savedAt);
  function localLive() {
    if (local.parts) { const p = local.parts(); return p ? { meta: p.meta, parts: slimParts(p.parts), savedAt: p.savedAt } : null; }
    const t = local.read(); if (!t) return null;
    const sp = split(t); return { meta: sp.meta, parts: sp.parts };
  }
  function writeLocal(live) { if (local.replace) local.replace(live); else local.write(liveText(live)); }
  // The fingerprint saved at the last sync used to be over the whole file: switch it to the pieces (same data → same answer)
  if (st.syncHashKind !== 'parts') {
    try { const t = local.read(); const h = (t && st.syncHash && sha(slim(t)) === st.syncHash) ? liveHash(localLive()) : st.syncHash; save({ syncHash: h || '', syncHashKind: 'parts' }); } catch (e) {}
  }
  // ---- content pieces in Drive (Pieces/<name>.json.gz) ----
  s.upPieces = {};
  async function sendPieces(texts) {
    const want = {}; texts.forEach(t => refsIn(t).forEach(h => { want[h] = 1; }));
    return upPieces(Object.keys(want));
  }
  async function upPieces(list) {
    if (!local.pieces) return 0;
    const hs = list.filter(h => !s.upPieces[h]); if (!hs.length) return 0;
    const folder = await drive.folder(PIECES_FOLDER); let n = 0;
    await pool(hs, 4, async (h) => {
      if (await fileId(h + '.json.gz', folder)) { s.upPieces[h] = 1; return; }
      const t = local.pieces.get(h); if (t == null) return;      // not on this device: nothing to send
      s.ids[folder + '/' + h + '.json.gz'] = await drive.create(h + '.json.gz', K.gzip(t), 'application/gzip', folder);
      s.upPieces[h] = 1; n++;
    });
    return n;
  }
  async function getPiece(h) {
    if (!local.pieces) return false;
    if (local.pieces.has(h)) return true;
    const folder = await drive.folder(PIECES_FOLDER);
    const id = await fileId(h + '.json.gz', folder);
    if (!id) return false;
    local.pieces.put(h, K.gunzip(await drive.download(id)));
    return true;
  }

  async function fileId(name, parent) {
    const key = (parent || 'root') + '/' + name;
    if (s.ids[key]) return s.ids[key];
    const id = await drive.find(name, parent || null);
    if (id) s.ids[key] = id;
    return id;
  }
  async function put(name, buf, mime, parent, knownId) {
    const key = (parent || 'root') + '/' + name;
    let id = knownId || await fileId(name, parent);
    if (id) { try { await drive.update(id, buf, mime); s.ids[key] = id; return id; } catch (e) { if (e && e.code === 'not_found') { delete s.ids[key]; id = null; } else throw e; } }
    id = await drive.create(name, buf, mime, parent || null);
    s.ids[key] = id; return id;
  }
  async function readJSONFile(name) {
    const id = await fileId(name);
    if (!id) return null;
    let buf; try { buf = await drive.download(id); } catch (e) { if (e && e.code === 'not_found') { delete s.ids['root/' + name]; return null; } throw e; }
    try { return JSON.parse(K.text(buf)); } catch (e) { return null; }
  }
  async function readControl() { const c = await readJSONFile(CONTROL); if (c) s.control = c; return c; }
  async function writeControl(c) {
    c.format = 'sitcraft/control'; c.v = 2;
    c.history = (c.history || []).slice(-HISTORY_MAX);
    await put(CONTROL, K.bytes(JSON.stringify(c, null, 1)), 'application/json');
    s.control = c;
  }
  async function readIndex(version) {
    if (s.index && version != null && s.index.version === version) return s.index;
    const x = await readJSONFile(INDEX); if (x) s.index = x; return x;
  }
  // The last thing worth telling the writer ("The iPad took control at 3:52 PM"), kept until dismissed (survives the reload)
  const notice = (n) => save({ syncNotice: n ? Object.assign({ at: new Date(now()).toISOString() }, n) : null });
  // List a rescued copy in the control file so whichever device is in charge can file it under Versions & backup
  async function register(r) {
    if (!r || !r.driveId) return;
    try { const c = await readControl(); if (!c) return; c.rescued = (c.rescued || []).filter(x => x.id !== r.driveId).concat([{ id: r.driveId, label: r.label, from: devOf(me), at: new Date(now()).toISOString() }]).slice(-20); await writeControl(c); } catch (e) {}
  }
  const log = (c, type, extra) => { c.history = c.history || []; c.history.push(Object.assign({ at: new Date(now()).toISOString(), type, to: devOf(c.primary) }, extra || {})); };

  // Put the live copy together from Drive, reusing every piece this device already has with the same fingerprint
  async function downloadLive(version) {
    const idx = await readIndex(version);
    if (!idx) return null;
    let mine = {};
    try { const l = localLive(); if (l) mine = l.parts; } catch (e) {}
    const names = Object.keys(idx.parts || {}), parts = {};
    const need = names.filter(n => !(mine[n] != null && partSha(n, mine[n]) === idx.parts[n].h));
    names.forEach(n => { if (need.indexOf(n) < 0) parts[n] = mine[n]; });
    let got = 0;
    await pool(need, 4, async (n) => {
      const p = idx.parts[n];
      const txt = K.gunzip(await drive.download(p.id));
      if (sha(txt) !== p.h) throw Object.assign(new Error('The Drive copy is still being written. Trying again shortly.'), { code: 'busy' });
      parts[n] = txt; got += p.b || 0;
    });
    s.lastGot = { parts: need.length, bytes: got };
    // the content pieces the new pieces point to come down too, so e.g. restoring a script version works offline
    if (local.pieces) {
      const hs = {}; need.forEach(n => refsIn(parts[n]).forEach(h => { if (!local.pieces.has(h)) hs[h] = 1; }));
      await pool(Object.keys(hs), 4, async (h) => { try { await getPiece(h); } catch (e) {} });
    }
    return { meta: idx.meta || { format: 'sitcom-writer/app-data', version: 1 }, parts, savedAt: idx.savedAt };
  }
  // Replace this device's data file with the Drive copy. The window is asked to reload; until it reads the
  // new file back, its old in-memory copy is not allowed to save over it.
  function replaceLocal(live, reason, extra) {
    s.block = true;
    writeLocal(live);
    save({ syncHash: liveHash(live), syncDirtySince: 0, syncBase: baseOf(liveText(live)) });
    emit('data', Object.assign({ reason }, extra || {}));
  }
  async function rescue(label) {
    const text = local.read();
    if (!text) return null;
    const file = label.replace(/[\\/:*?"<>|]/g, '.') + '.json';
    let driveId = null, body = text;
    // the fingerprint of this device's last sync goes with it, so the device in charge can tell what was changed here
    try { const o = JSON.parse(text); o.rescue = { base: st.syncBase || null, from: devOf(me), at: new Date(now()).toISOString(), label }; body = JSON.stringify(o); } catch (e) {}
    try { local.rescue(file, body); } catch (e) {}
    try { const folder = await drive.folder(RESCUE_FOLDER); driveId = await put(file + '.gz', K.gzip(body), 'application/gzip', folder); } catch (e) {}
    return { label, file, driveId };
  }
  function unsyncedLabel() {
    const a = clock(st.syncDirtySince || now()), b = clock(now());
    const d = new Date(now());
    return 'Unsynced ' + kindName(me.kind) + ' edits · ' + (a.slice(-2) === b.slice(-2) ? a.slice(0, -3) : a) + '–' + b + ' · ' + d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getDate() + ' ' + d.getFullYear();
  }
  const hasUnsynced = () => { const l = localLive(); return !!(l && liveHash(l) !== st.syncHash); };

  // Another device is now in charge. Keep anything we hadn't uploaded, then take the Drive copy and view only.
  async function overruled(c) {
    const rescued = hasUnsynced() ? await rescue(unsyncedLabel()) : null;
    T.clear(s.quiet); s.quiet = null;
    save({ syncPrimary: false });
    const text = await downloadLive(c.version);
    save({ syncVersion: c.version || 0 });
    if (rescued) await register(rescued);
    notice({ type: 'taken', by: devOf(c.primary), takenAt: c.takenAt || null, rescued: rescued ? rescued.label : null });
    if (text != null) replaceLocal(text, 'taken', { by: devOf(c.primary), at: c.takenAt, rescued });
    emit('taken', { by: devOf(c.primary), at: c.takenAt, rescued });
    status(true);
  }

  async function uploadNow() {
    if (!st.syncOn || !st.syncPrimary) return { ok: true, skipped: true };
    const live = localLive();
    if (!live) return { ok: true, skipped: true };
    const h = liveHash(live);
    const c = await readControl();
    if (c && c.primary && !isMe(c.primary)) { await overruled(c); return { ok: false, taken: true }; }
    if (c && (c.version || 0) > st.syncVersion) {
      // Someone saved a newer copy while we thought we were in charge (shouldn't happen). Keep ours aside, take theirs.
      const rescued = await rescue(unsyncedLabel());
      const t2 = await downloadLive(c.version);
      save({ syncVersion: c.version });
      if (rescued) await register(rescued);
      notice({ type: 'conflict', rescued: rescued ? rescued.label : null });
      if (t2 != null) replaceLocal(t2, 'conflict', { rescued });
      emit('conflict', { rescued });
      return { ok: false, conflict: true };
    }
    if (h === st.syncHash && c) { save({ syncDirtySince: 0 }); return { ok: true, same: true }; }
    const sp = live;
    const old = (c && await readIndex(c.version)) || { parts: {} };
    const folder = await drive.folder(PARTS_FOLDER);
    const names = Object.keys(sp.parts), parts = {};
    const changed = names.filter(n => { const hh = partSha(n, sp.parts[n]); parts[n] = { h: hh }; return !(old.parts && old.parts[n] && old.parts[n].h === hh && old.parts[n].id); });
    names.forEach(n => { if (changed.indexOf(n) < 0) { parts[n].id = old.parts[n].id; parts[n].b = old.parts[n].b; } });
    let sent = 0;
    await pool(changed, 4, async (n) => {
      const gz = K.gzip(sp.parts[n]);
      parts[n].id = await put(partFile(n), gz, 'application/gzip', folder, old.parts && old.parts[n] && old.parts[n].id);
      parts[n].b = gz.length; sent += gz.length;
    });
    // the content pieces those point to go up before the list that names them
    const sentPieces = await sendPieces(changed.map(n => sp.parts[n]));
    const t = now(), version = (st.syncVersion || 0) + 1, iso = new Date(t).toISOString();
    const idx = { format: 'sitcraft/live-index', v: 1, version, savedAt: iso, savedBy: devOf(me), meta: sp.meta, parts };
    await put(INDEX, K.bytes(JSON.stringify(idx)), 'application/json');
    s.index = idx;
    const total = names.reduce((a, n) => a + (parts[n].b || 0), 0);
    const nc = Object.assign({ history: [] }, c || {}, {
      primary: c && c.primary ? c.primary : devOf(me), version, savedAt: iso, savedBy: devOf(me), seenAt: iso, closed: false, clean: true, dirtySince: null,
      live: { parts: names.length, bytes: total, sentParts: changed.length, sentBytes: sent }
    });
    if (!c) { nc.takenAt = iso; log(nc, 'start'); }
    await writeControl(nc);
    s.lastBeat = t; s.lastSent = { parts: changed.length, bytes: sent, pieces: sentPieces };
    // Pieces nobody uses any more (a deleted episode) are tidied away
    const gone = Object.keys(old.parts || {}).filter(n => !parts[n] && old.parts[n].id);
    await pool(gone, 4, async (n) => { try { await drive.remove(old.parts[n].id); } catch (e) {} });
    // Anything typed while uploading stays "dirty" and goes up next time
    const still = liveHash(localLive()) !== h;
    s.markedDirty = false;
    save({ syncVersion: version, syncHash: h, syncLastUpload: t, syncDirtySince: still ? (st.syncDirtySince || t) : 0, syncBase: baseOf(liveText(live)) });
    if (still) schedule();
    return { ok: true, sentParts: changed.length, sentBytes: sent, parts: names.length, bytes: total };
  }
  const flush = () => run(async () => { T.clear(s.quiet); s.quiet = null; try { const r = await uploadNow(); ok(); status(true); return r; } catch (e) { fail(e); return { ok: false, error: s.error }; } });

  function schedule() {
    T.clear(s.quiet);
    const since = st.syncDirtySince || now();
    const wait = Math.max(0, Math.min(QUIET_MS, since + MAX_WAIT_MS - now()));
    s.quiet = T.set(() => { s.quiet = null; flush(); }, wait);
  }

  // The window saved the data file
  function localChanged() {
    if (!st.syncOn || !st.syncPrimary) return;
    if (!st.syncDirtySince) save({ syncDirtySince: now() });
    schedule();
    if (!s.markedDirty) { s.markedDirty = true; markDirty(); }
    status();
  }
  // Tell other devices this one has changes on the way (so if it then loses its connection, they know to warn)
  const markDirty = () => run(async () => {
    if (!st.syncOn || !st.syncPrimary || !st.syncDirtySince) return;
    try {
      const c = await readControl();
      if (c && isMe(c.primary) && c.clean !== false) { c.clean = false; c.dirtySince = new Date(st.syncDirtySince).toISOString(); c.seenAt = new Date(now()).toISOString(); await writeControl(c); s.lastBeat = now(); }
      ok();
    } catch (e) { s.markedDirty = false; fail(e); }
  });
  // While viewing only (or while a fresh Drive copy is loading), the window may not save over the data file
  const blocksWrites = () => !!(s.block || (st.syncOn && !st.syncPrimary));
  const windowLoaded = () => { s.block = false; };

  // Regular peek at the control file
  const tick = () => run(async () => {
    if (!st.syncOn) return;
    try {
      const c = await readControl();
      s.lastCheck = now();
      if (!c) {
        if (st.syncPrimary) await uploadNow();          // the control file was removed: put it back
      } else if (st.syncPrimary) {
        if (!isMe(c.primary)) await overruled(c);
        else if (c.request && !isMe(c.request)) await handOver(c);
        else if (st.syncDirtySince && now() - st.syncDirtySince >= MAX_WAIT_MS) await uploadNow();
        else if (now() - s.lastBeat >= BEAT_MS || c.closed) { c.seenAt = new Date(now()).toISOString(); c.closed = false; await writeControl(c); s.lastBeat = now(); }
      } else if (isMe(c.primary)) {
        await becomePrimary(c, 'handoff');               // control was handed to us while we weren't looking
      } else if ((c.version || 0) > st.syncVersion) {
        const text = await downloadLive(c.version);      // stay up to date while viewing
        save({ syncVersion: c.version });
        if (text != null) replaceLocal(text, 'refresh', { by: devOf(c.savedBy || c.primary) });
      }
      ok();
    } catch (e) { fail(e); }
    status();
  });

  // The other device asked for control: upload anything new, then step back to viewing only
  async function handOver(c) {
    const r = await uploadNow();
    if (!r.ok) return;
    const c2 = await readControl() || c;
    const to = c2.request || c.request;
    c2.primary = devOf(to); c2.request = null; c2.takenAt = new Date(now()).toISOString(); c2.closed = false;
    log(c2, 'handoff', { from: devOf(me) });
    await writeControl(c2);
    save({ syncPrimary: false });
    notice({ type: 'handedOff', to: devOf(to) });
    emit('handedOff', { to: devOf(to) });
    status(true);
  }
  async function becomePrimary(c, type, extra) {
    emit('progress', { step: 'download' });
    const text = await downloadLive(c.version);
    notice(Object.assign({ type: 'primary', how: type, got: s.lastGot || null }, extra || {}));
    save({ syncPrimary: true, syncVersion: c.version || 0, syncDirtySince: 0 });
    s.lastBeat = now();
    if (text != null) replaceLocal(text, 'primary', { type });
    emit('primary', Object.assign({ type }, extra || {}));
    status(true);
  }

  // Turn sync on. If Drive already has Sitcom Garage data from another device, this device starts as viewer
  // (its own copy is kept as a rescued backup first if it differs).
  const enable = () => run(async () => {
    save({ syncOn: true });
    try {
      const c = await readControl();
      if (!c) { save({ syncPrimary: true, syncVersion: 0, syncHash: '' }); await uploadNow(); }
      else if (isMe(c.primary)) {
        save({ syncPrimary: true });
        if ((c.version || 0) > st.syncVersion) await becomePrimary(c, 'resume');
        else await uploadNow();
      } else {
        const text = await downloadLive(c.version);
        const mine = localLive();
        const rescued = (mine && text != null && liveHash(mine) !== liveHash(text)) ? await rescue('This ' + kindName(me.kind) + '’s copy before sync · ' + clock(now()) + ' · ' + new Date(now()).toDateString().slice(4)) : null;
        save({ syncPrimary: false, syncVersion: c.version || 0 });
        if (rescued) await register(rescued);
        if (text != null) replaceLocal(text, 'joined', { rescued, primary: devOf(c.primary) });
      }
      ok();
    } catch (e) { fail(e); }
    start();
    return status(true);
  });
  // Turn sync off: only while this device is in charge (otherwise two copies would drift apart)
  const disable = () => run(async () => {
    if (st.syncOn && !st.syncPrimary) return { ok: false, error: 'not_primary' };
    try {
      const c = await readControl();
      if (c && c.primary && !isMe(c.primary)) { await overruled(c); return { ok: false, error: 'not_primary' }; }
      await uploadNow(); ok();
    } catch (e) {}
    save({ syncOn: false }); stop(); status(true);
    return { ok: true };
  });

  // Normal handoff: ask the device in charge to step back. If it was closed (it said so when it quit, with everything
  // uploaded) we go ahead straight away. If it's asleep or offline, the window offers Force takeover instead.
  const makePrimary = (opt) => run(async () => {
    const waitMs = (opt && opt.waitMs) || 25000, step = (opt && opt.stepMs) || 2000;
    try {
      let c = await readControl();
      if (!c) { save({ syncOn: true, syncPrimary: true }); await uploadNow(); ok(); return { ok: true, type: 'start' }; }
      if (isMe(c.primary)) { if (!st.syncPrimary) await becomePrimary(c, 'resume'); ok(); return { ok: true, type: 'already' }; }
      const other = devOf(c.primary);
      if (c.closed) {
        c.primary = devOf(me); c.request = null; c.takenAt = new Date(now()).toISOString(); c.closed = false; c.seenAt = c.takenAt;
        log(c, 'handoff', { from: other, note: 'closed' });
        await writeControl(c); await becomePrimary(c, 'handoff', { from: other }); ok();
        return { ok: true, type: 'handoff', from: other };
      }
      const seen = c.seenAt ? Date.parse(c.seenAt) : 0;
      if (now() - seen < AWAY_MS) {
        c.request = Object.assign(devOf(me), { at: new Date(now()).toISOString() });
        await writeControl(c);
        emit('asking', { other }); emit('progress', { step: 'asking', other });
        const until = now() + waitMs;
        while (now() < until) {
          await new Promise(r => T.set(r, step));
          c = await readControl();
          if (c && isMe(c.primary)) { await becomePrimary(c, 'handoff', { from: other }); ok(); return { ok: true, type: 'handoff', from: other }; }
        }
        c = await readControl() || c;
        if (isMe(c.primary)) { await becomePrimary(c, 'handoff', { from: other }); ok(); return { ok: true, type: 'handoff', from: other }; }
      }
      // Asleep, switched off or offline, but its last upload had everything: a normal handoff is safe.
      // (If it did change something after all, that's rescued on that device when it next checks Drive.)
      if (c.clean !== false) {
        c.primary = devOf(me); c.request = null; c.takenAt = new Date(now()).toISOString(); c.closed = false; c.seenAt = c.takenAt;
        log(c, 'handoff', { from: other, note: 'away' });
        await writeControl(c); await becomePrimary(c, 'handoff', { from: other, away: true }); ok();
        return { ok: true, type: 'handoff', from: other, away: true };
      }
      if (c.request && isMe(c.request)) { c.request = null; await writeControl(c); }
      ok();
      return { ok: false, needForce: true, other, savedAt: c.savedAt || null, seenAt: c.seenAt || null, dirtySince: c.dirtySince || null };
    } catch (e) { fail(e); return { ok: false, error: s.error, offline: s.offline }; }
  });
  // Force takeover (after the slide-to-confirm): the other device's unsent edits are rescued when it next checks Drive
  const forceTakeover = () => run(async () => {
    try {
      const c = await readControl() || {};
      const prev = devOf(c.primary);
      c.primary = devOf(me); c.request = null; c.takenAt = new Date(now()).toISOString(); c.closed = false; c.seenAt = c.takenAt;
      log(c, 'forced', { from: prev, lastSavedAt: c.savedAt || null });
      await writeControl(c);
      await becomePrimary(c, 'forced', { from: prev });
      ok();
      return { ok: true, from: prev };
    } catch (e) { fail(e); return { ok: false, error: s.error, offline: s.offline }; }
  });

  // On quit: upload anything new and tell other devices this one is closed (so they can take over without forcing)
  const closing = () => run(async () => {
    if (!st.syncOn || !st.syncPrimary) return { ok: true };
    try {
      const r = await uploadNow();
      if (!r.ok) return r;
      const c = await readControl();
      if (c && isMe(c.primary)) { c.closed = true; c.seenAt = new Date(now()).toISOString(); await writeControl(c); }
      return { ok: true };
    } catch (e) { return { ok: false }; }
  });

  // "Unsaved changes": rescued copies wait in the control file until the device in charge merges, overwrites with or discards
  // them; then they move to the "handled" list (the copy itself stays in Drive › Rescued edits).
  const rescuedData = (id) => run(async () => { try { return { ok: true, data: K.gunzip(await drive.download(id)) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } });
  const rescuedDone = (id, how) => run(async () => {
    try {
      const c = await readControl();
      if (c && c.rescued) {
        const r = c.rescued.filter(x => x.id === id)[0];
        c.rescued = c.rescued.filter(x => x.id !== id);
        if (r && how) c.handled = (c.handled || []).concat([Object.assign({}, r, { how: String(how), doneAt: new Date(now()).toISOString(), by: devOf(me) })]).slice(-10);
        await writeControl(c);
      }
      ok(); status(true); return { ok: true };
    } catch (e) { fail(e); return { ok: false }; }
  });
  const dismiss = () => { notice(null); status(true); };
  // Pairing (and other small changes to the control file): read it fresh, change it, write it back — one job at a time
  const peek = () => run(async () => { try { const c = await readControl(); ok(); return c; } catch (e) { fail(e); throw e; } });
  const updateControl = (fn) => run(async () => {
    const c = await readControl(); if (!c) return null;
    if (fn(c) === false) return c;
    await writeControl(c); status(true); return c;
  });

  // Windows is about to sleep or lock: upload right away
  const sleeping = () => flush();
  // Waking up / back online: check Drive, then upload anything written meanwhile (e.g. with no internet) straight away
  const woke = () => tick().then(() => { if (st.syncOn && st.syncPrimary && st.syncDirtySince) return flush(); });

  function start() { stop(); s.check = T.every(() => tick(), CHECK_MS); }
  function stop() { if (s.check) T.stop(s.check); s.check = null; T.clear(s.quiet); s.quiet = null; }

  let lastJson = '';
  function status(force) {
    const c = s.control;
    const v = {
      on: !!st.syncOn, role: !st.syncOn ? 'off' : (st.syncPrimary ? 'primary' : 'viewer'),
      me: devOf(me), primary: c ? devOf(c.primary) : (st.syncPrimary ? devOf(me) : null),
      takenAt: c ? c.takenAt || null : null, savedAt: c ? c.savedAt || null : null, savedBy: c ? devOf(c.savedBy) : null,
      seenAt: c ? c.seenAt || null : null, closed: !!(c && c.closed),
      version: st.syncVersion, lastUpload: st.syncLastUpload || 0, dirty: !!st.syncDirtySince, dirtySince: st.syncDirtySince || 0,
      offline: s.offline, error: s.error, lastCheck: s.lastCheck,
      live: c && c.live ? c.live : null, lastSent: s.lastSent, lastGot: s.lastGot || null,
      history: c ? (c.history || []).slice(-12).reverse() : [],
      notice: st.syncNotice || null, rescued: c && c.rescued ? c.rescued.slice() : [], handled: c && c.handled ? c.handled.slice().reverse() : [],
      paired: c && c.paired ? c.paired : null, pairing: c && c.pairing ? { expires: c.pairing.expires, at: c.pairing.at } : null,
      // AI on the iPad: on/off, a fingerprint of the PC's keys (never the keys), the PC's model choices, who has the current keys
      ai: c && c.ai ? { on: !!c.ai.on, fp: c.ai.fp || '', cfg: c.ai.cfg || null, hints: c.ai.hints || null, got: c.ai.got || null, handoff: c.ai.handoff ? { name: c.ai.handoff.name, expires: c.ai.handoff.expires, kh: c.ai.handoff.kh, at: c.ai.handoff.at } : null } : null
    };
    const j = JSON.stringify(v);
    if (force || j !== lastJson) { lastJson = j; emit('status', v); }
    return v;
  }

  if (st.syncOn) { start(); T.set(() => tick(), 0); }
  // A content piece this device doesn't have yet (e.g. an old script version's lines), straight from Drive
  // Content pieces a show version (Versions & backup) uses go up to Drive › Pieces before its list does — sync on or off
  const sharePieces = (hs) => run(async () => { try { const n = await upPieces((hs || []).map(String)); return { ok: true, sent: n }; } catch (e) { return { ok: false, code: (e && e.code) || 'drive_error', error: String((e && e.message) || e) }; } });
  const fetchPiece = (h) => run(async () => { try { const got = await getPiece(h); return { ok: got, text: got ? local.pieces.get(h) : null }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } });
  return { status, fetchPiece, sharePieces, enable, disable, localChanged, sleeping, woke, rescuedData, rescuedDone, dismiss, peek, updateControl, sha: (x) => sha(x), blocksWrites, windowLoaded, tick, flush, makePrimary, forceTakeover, closing, stop };
}

const SYNC_API = { createSync, configure, slim, split, join, refsIn, CONTROL, INDEX, PARTS_FOLDER, RESCUE_FOLDER, PIECES_FOLDER, timings: { QUIET_MS, MAX_WAIT_MS, CHECK_MS, BEAT_MS, AWAY_MS, WHOLE_MAX } };
if (typeof module !== 'undefined' && module.exports) module.exports = SYNC_API;
else if (typeof window !== 'undefined') window.SitSync = SYNC_API;
