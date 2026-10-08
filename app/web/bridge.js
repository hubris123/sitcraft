// SitCraft iPad app — the iPad's version of the PC's bridge (preload.js + main.js), so the same screens run unchanged.
//   storage  → IndexedDB on the iPad (loaded into memory before the screens start)
//   Drive    → Google sign-in in the browser (the "SitCraft iPad" Web client) + Drive over https
//   sync     → the same sync.js engine as the PC (device kind 'ipad')
//   deleting → never on the iPad ("Delete on your PC"); AI → not yet (stage 3)
(function () {
  'use strict';
  var DATA_KEY = 'sitcomwriter.show-data.v1';
  var CLIENT_ID = '887682540626-40gmhov9d4sv3tat6pcbo4krbfeqk3pf.apps.googleusercontent.com';
  var SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
  var G = 'https://www.googleapis.com';
  var ROOT = 'SitCraft Backups';
  var K = window.SC_KIT;

  // ---------------- storage (IndexedDB, mirrored in memory so reads are instant) ----------------
  var mem = {}, db = null, pending = Promise.resolve();
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('sitcraft', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  // Ask the iPad to keep SitCraft's storage for good (Safari may otherwise clear a website's storage after weeks unused)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
  function loadAll() {
    return idb().then(function (d) {
      db = d;
      return new Promise(function (res) {
        var tx = d.transaction('kv', 'readonly'), st = tx.objectStore('kv'), c = st.openCursor();
        c.onsuccess = function () { var cur = c.result; if (cur) { mem[cur.key] = cur.value; cur.continue(); } else res(); };
        c.onerror = function () { res(); };
      });
    }).catch(function () { db = null; });
  }
  function persist(k, v) {
    if (v === undefined) delete mem[k]; else mem[k] = v;
    if (!db) return pending;
    pending = pending.then(function () {
      return new Promise(function (res) {
        var tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
        if (v === undefined) st.delete(k); else st.put(v, k);
        tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
      });
    });
    return pending;
  }
  var flushed = function () { return pending; };

  // ---------------- Google sign-in (token lasts about an hour; signing in again needs a tap) ----------------
  var tokenClient = null, signWaiters = null;
  function gisReady() {
    return new Promise(function (res, rej) {
      var n = 0; (function wait() { if (window.google && google.accounts && google.accounts.oauth2) return res(); if (++n > 100) return rej(new Error('Google sign-in didn’t load — check the internet connection.')); setTimeout(wait, 100); })();
    });
  }
  function signIn(hint) {
    return gisReady().then(function () {
      return new Promise(function (res) {
        signWaiters = res;
        if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID, scope: SCOPE,
          callback: function (r) {
            var done = signWaiters; signWaiters = null;
            if (!r || !r.access_token) { if (done) done({ ok: false, error: (r && (r.error_description || r.error)) || 'Sign-in didn’t finish' }); return; }
            var t = { tok: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000, email: (mem.gtoken && mem.gtoken.email) || '' };
            persist('gtoken', t);
            fetch(G + '/oauth2/v3/userinfo', { headers: { authorization: 'Bearer ' + t.tok } }).then(function (x) { return x.ok ? x.json() : {}; }).then(function (u) {
              if (u && u.email) { t.email = u.email; persist('gtoken', t); }
              if (done) done({ ok: true, email: t.email });
              if (sync) sync.tick();
            }, function () { if (done) done({ ok: true, email: t.email }); });
          },
          error_callback: function (e) { var done = signWaiters; signWaiters = null; if (done) done({ ok: false, error: (e && (e.message || e.type)) || 'The sign-in window was closed or blocked' }); }
        });
        tokenClient.requestAccessToken(hint && mem.gtoken && mem.gtoken.email ? { login_hint: mem.gtoken.email, prompt: '' } : {});
      });
    }, function (e) { return { ok: false, error: e.message }; });
  }
  // Sign in another way: go to Google's own page and come back with the sign-in in the address (for the Home Screen app,
  // where the usual sign-in window may not open). The address must be listed in the Web client's "Authorized redirect URIs".
  function standalone() { try { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; } }
  function backTo() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function signInRedirect(hint) {
    var st = Math.random().toString(36).slice(2) + Date.now().toString(36);
    persist('oauthState', { s: st, at: Date.now() });
    return flushed().then(function () {
      var u = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=token&include_granted_scopes=true&client_id=' + encodeURIComponent(CLIENT_ID) +
        '&redirect_uri=' + encodeURIComponent(backTo()) + '&scope=' + encodeURIComponent(SCOPE) + '&state=' + encodeURIComponent(st) +
        (hint && mem.gtoken && mem.gtoken.email ? '&login_hint=' + encodeURIComponent(mem.gtoken.email) : '');
      location.assign(u);
      return new Promise(function () {}); // the page is leaving
    });
  }
  // Coming back from Google's page: keep the sign-in, tidy the address
  function takeRedirect() {
    var h = location.hash || '';
    if (!/[#&](access_token|error)=/.test(h)) return Promise.resolve(null);
    var P = {}; h.replace(/^#/, '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) P[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    var want = mem.oauthState; persist('oauthState', undefined);
    if (!want || want.s !== P.state || Date.now() - want.at > 15 * 60000) return Promise.resolve({ ok: false, error: 'That sign-in didn’t come from this iPad — try again' });
    if (!P.access_token) return Promise.resolve({ ok: false, error: P.error === 'access_denied' ? 'Sign-in was cancelled' : (P.error_description || P.error || 'Sign-in didn’t finish') });
    var t = { tok: P.access_token, exp: Date.now() + (Number(P.expires_in) || 3600) * 1000, email: (mem.gtoken && mem.gtoken.email) || '' };
    persist('gtoken', t);
    return fetch(G + '/oauth2/v3/userinfo', { headers: { authorization: 'Bearer ' + t.tok } }).then(function (x) { return x.ok ? x.json() : {}; }).then(function (u) {
      if (u && u.email) { t.email = u.email; persist('gtoken', t); }
      return { ok: true, email: t.email, redirect: true };
    }, function () { return { ok: true, email: t.email, redirect: true }; });
  }
  function token() {
    var t = mem.gtoken;
    if (t && t.tok && t.exp > Date.now() + 60000) return t.tok;
    throw Object.assign(new Error('Google sign-in needed'), { code: 'drive_auth' });
  }
  var tokenOk = function () { try { token(); return true; } catch (e) { return false; } };

  // ---------------- Google Drive over https ----------------
  function gcall(url, opts) {
    var tok; try { tok = token(); } catch (e) { return Promise.reject(e); }
    opts = opts || {};
    return fetch(url, Object.assign({}, opts, { headers: Object.assign({ authorization: 'Bearer ' + tok }, opts.headers || {}) })).then(function (r) {
      if (r.ok) return r;
      return r.text().then(function (t) {
        if (r.status === 401) { var g = mem.gtoken; if (g) persist('gtoken', Object.assign({}, g, { exp: 0 })); }
        throw Object.assign(new Error('Google Drive error ' + r.status + ' ' + String(t).slice(0, 160)), { status: r.status, code: r.status === 404 ? 'not_found' : (r.status === 401 ? 'drive_auth' : 'drive_error') });
      });
    });
  }
  var rootId = null;
  function q(s) { return encodeURIComponent(s); }
  function esc(n) { return String(n).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function findRoot() {
    if (rootId) return Promise.resolve(rootId);
    return gcall(G + '/drive/v3/files?fields=files(id,name)&q=' + q("mimeType='application/vnd.google-apps.folder' and trashed=false and name='" + ROOT + "'")).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.files || !j.files.length) throw Object.assign(new Error('Your “SitCraft Backups” folder wasn’t found in Google Drive. Turn on Drive sync on your PC first.'), { code: 'no_data' });
      rootId = j.files[0].id; return rootId;
    });
  }
  function folderIn(name, parent) {
    return gcall(G + '/drive/v3/files?fields=files(id,name)&q=' + q("mimeType='application/vnd.google-apps.folder' and trashed=false and name='" + esc(name) + "' and '" + parent + "' in parents")).then(function (r) { return r.json(); }).then(function (j) {
      if (j.files && j.files.length) return j.files[0].id;
      return gcall(G + '/drive/v3/files?fields=id', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) }).then(function (r) { return r.json(); }).then(function (x) { return x.id; });
    });
  }
  function createFile(name, bytes, mime, parent) {
    var b = 'sc' + Math.random().toString(16).slice(2);
    var meta = JSON.stringify({ name: name, parents: [parent], mimeType: mime });
    var body = new Blob(['--' + b + '\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + b + '\r\ncontent-type: ' + mime + '\r\n\r\n', bytes, '\r\n--' + b + '--']);
    return gcall(G + '/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'content-type': 'multipart/related; boundary=' + b }, body: body }).then(function (r) { return r.json(); }).then(function (j) { return j.id; });
  }
  var drive = {
    find: function (name, parent) {
      return (parent ? Promise.resolve(parent) : findRoot()).then(function (p) {
        return gcall(G + '/drive/v3/files?fields=files(id,name)&orderBy=modifiedTime%20desc&q=' + q("trashed=false and name='" + esc(name) + "' and '" + p + "' in parents"));
      }).then(function (r) { return r.json(); }).then(function (j) { return j.files && j.files.length ? j.files[0].id : null; });
    },
    create: function (name, bytes, mime, parent) { return (parent ? Promise.resolve(parent) : findRoot()).then(function (p) { return createFile(name, bytes, mime, p); }); },
    update: function (id, bytes, mime) { return gcall(G + '/upload/drive/v3/files/' + encodeURIComponent(id) + '?uploadType=media&fields=id', { method: 'PATCH', headers: { 'content-type': mime }, body: new Blob([bytes]) }).then(function () {}); },
    download: function (id) { return gcall(G + '/drive/v3/files/' + encodeURIComponent(id) + '?alt=media').then(function (r) { return r.arrayBuffer(); }).then(function (a) { return new Uint8Array(a); }); },
    remove: function (id) { return gcall(G + '/drive/v3/files/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {}); },
    folder: function (name) { return findRoot().then(function (r) { return folderIn(name, r); }); }
  };

  // ---------------- the sync engine (same as the PC's) ----------------
  var sync = null, fns = [], booting = true;
  function settingsGet() { return Object.assign({}, mem.settings || {}); }
  function settingsSet(p) { persist('settings', Object.assign({}, mem.settings || {}, p)); }
  function emit(ev, p) {
    fns.slice().forEach(function (f) { try { f(ev, p); } catch (e) {} });
    if (ev === 'status' && p && p.on && p.lastCheck && mem.device && (!p.paired || p.paired.id !== mem.device.id)) unpaired(p.paired);
    // A fresh copy from Drive replaced the data: reload the screens once it's safely stored (not while starting up)
    // (just viewing while the other device writes? don't yank the screen — offer an update button, and update when you come back)
    if (ev === 'data' && !booting) {
      if (p && p.reason === 'refresh') refreshLater(p.by);
      else flushed().then(function () { location.reload(); });
    }
    if (ev === 'data' && booting) sync.windowLoaded();
  }
  var wantReload = false;
  function refreshLater(by) {
    wantReload = true;
    if (document.visibilityState === 'hidden') return;
    var b = document.getElementById('sc-refresh');
    if (!b) {
      b = document.createElement('button'); b.id = 'sc-refresh';
      b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:52px;z-index:60;font:600 15px Geist,system-ui,sans-serif;border-radius:999px;padding:12px 18px;min-height:46px;border:1px solid #1f5c52;background:#11231f;color:#9fd9cf;box-shadow:0 10px 30px rgba(0,0,0,.5)';
      b.onclick = function () { flushed().then(function () { location.reload(); }); };
      document.body.appendChild(b);
    }
    b.textContent = 'Newer changes from ' + (by ? (by.kind === 'ipad' ? 'the iPad' : (by.name || 'your PC')) : 'your PC') + ' — tap to update';
  }
  // Going to the background (another app, the Home Screen, the iPad locking): upload anything new straight away, like the
  // PC does before it sleeps. Coming back: check Drive (and show anything newer).
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { if (sync) sync.sleeping(); return; }
    if (wantReload) { flushed().then(function () { location.reload(); }); return; }
    if (sync) sync.woke();
  });
  window.addEventListener('pagehide', function () { if (sync) sync.sleeping(); });
  // Back online after working without internet: check Drive and upload anything written meanwhile
  window.addEventListener('online', function () { if (sync) sync.woke(); });
  window.addEventListener('offline', function () { if (sync) sync.tick(); });
  function unpaired(other) {
    // Disconnected (another iPad was paired, or Remove on the PC): forget the shows, the settings and the Google sign-in
    if (sync) sync.stop();
    Object.keys(mem).forEach(function (k) { if (k !== 'unpaired') persist(k, undefined); });
    persist('unpaired', { by: other ? other.name : '', removed: !other, at: Date.now() });
    flushed().then(function () { location.reload(); });
  }
  function startSync() {
    if (sync || !mem.device) return sync;
    sync = window.SitSync.createSync({
      drive: drive, device: mem.device, emit: emit,
      local: { read: function () { return mem[DATA_KEY] || null; }, write: function (t) { persist(DATA_KEY, t); }, rescue: function (f, t) { persist('rescue:' + f, t); } },
      settings: { get: settingsGet, set: settingsSet }
    });
    return sync;
  }

  // ---------------- files: print / PDF / download ----------------
  function printHtml(html) {
    return new Promise(function (res) {
      var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
      document.body.appendChild(f);
      f.onload = function () { setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(function () { f.remove(); res({ ok: true }); }, 1000); }, 300); };
      f.srcdoc = html;
    });
  }
  function saveFile(name, data) {
    var blob = new Blob([data], { type: /\.json$/i.test(name) ? 'application/json' : 'text/plain' });
    try { if (navigator.canShare && navigator.share) { var file = new File([blob], name, { type: blob.type }); if (navigator.canShare({ files: [file] })) return navigator.share({ files: [file] }).then(function () { return { ok: true }; }, function () { return { ok: false, canceled: true }; }); } } catch (e) {}
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return Promise.resolve({ ok: true });
  }

  var noAI = { code: 'no_key', message: 'AI on the iPad is coming soon. For now, use AI on your PC.' };
  var NOT_ON_IPAD = { ok: false, error: 'ipad', message: 'Do this on your PC.' };
  var D = {
    isDesktop: true, isIPad: true,
    store: {
      getItem: function (k) { return mem['ls:' + k] !== undefined ? mem['ls:' + k] : (k === DATA_KEY ? (mem[DATA_KEY] || null) : null); },
      setItem: function (k, v) {
        v = String(v);
        if ((k === DATA_KEY || k === DATA_KEY + '.bak') && sync && sync.blocksWrites()) return;
        if (k === DATA_KEY) { persist(DATA_KEY, v); if (sync) sync.localChanged(); return; }
        persist('ls:' + k, v);
      },
      removeItem: function (k) { if (k === DATA_KEY) return; persist('ls:' + k, undefined); }
    },
    paths: function () { return { docs: 'This iPad (kept in sync with Google Drive)', dataFile: 'This iPad · Google Drive › SitCraft Backups' }; },
    reveal: function () { return Promise.resolve({ ok: true }); },
    claude: {
      status: function () { return { hasKey: false, keyHint: '', model: 'claude-sonnet-5-5', secure: true }; },
      setKey: function () { return Promise.resolve({ ok: false, error: 'On the iPad, AI keys come from your PC (coming in a later step).' }); },
      clearKey: function () { return Promise.resolve({ ok: true }); }, setModel: function () { return Promise.resolve({ ok: true }); },
      json: function () { return Promise.resolve({ error: noAI }); }, abort: function () {}, onDelta: function () {}, onPhase: function () {}
    },
    openai: {
      status: function () { return { hasKey: false, keyHint: '', model: '', models: [], provider: 'claude' }; },
      setKey: function () { return Promise.resolve({ ok: false, error: 'On the iPad, AI keys come from your PC (coming in a later step).' }); },
      clearKey: function () { return Promise.resolve({ ok: true }); }, setModel: function () { return Promise.resolve({ ok: true }); },
      refreshModels: function () { return Promise.resolve({ ok: false }); }, json: function () { return Promise.resolve({ error: noAI }); }
    },
    setPunchProvider: function () { return Promise.resolve({ ok: true }); },
    printHtml: printHtml, savePdf: function (name, html) { return printHtml(html); }, saveFile: saveFile,
    backups: {
      write: function (show, file, data) { persist('bk:' + show + '/' + file, data); return Promise.resolve({ ok: true }); },
      read: function (show, file) { return Promise.resolve({ data: mem['bk:' + show + '/' + file] || null }); },
      remove: function (show, file) { persist('bk:' + show + '/' + file, undefined); return Promise.resolve({ ok: true }); }
    },
    // The delete lock lives only on the PC: nothing can be deleted from the iPad
    lock: {
      status: function () { return { set: true, ipad: true, backupLeft: 0, email: '', google: true, gmail: false, verified: true, secure: true }; },
      begin: function () { return Promise.resolve(NOT_ON_IPAD); }, confirm: function () { return Promise.resolve(NOT_ON_IPAD); },
      verify: function () { return Promise.resolve(NOT_ON_IPAD); }, newBackup: function () { return Promise.resolve(NOT_ON_IPAD); },
      sendTest: function () { return Promise.resolve(NOT_ON_IPAD); }, checkTest: function () { return Promise.resolve(NOT_ON_IPAD); },
      sendReset: function () { return Promise.resolve(NOT_ON_IPAD); }, useReset: function () { return Promise.resolve(NOT_ON_IPAD); }
    },
    drive: {
      status: function () { return { connected: tokenOk(), email: (mem.gtoken && mem.gtoken.email) || '', clientId: '', builtIn: true }; },
      connect: function () { return signIn(true); },
      disconnect: function () { persist('gtoken', undefined); return Promise.resolve({ ok: true }); },
      check: function () { return Promise.resolve(tokenOk() ? { ok: true } : { ok: false, code: 'drive_auth' }); },
      upload: function (show, file, data) {
        return findRoot().then(function (r) { return folderIn(String(show).replace(/[\\/:*?"<>|]/g, '').trim() || 'Show', r); })
          .then(function (f) { return createFile(file, K.bytes(data), 'application/json', f); })
          .then(function (id) { return { ok: true, id: id }; }, function (e) { return { ok: false, code: e.code || 'drive_error', error: e.message }; });
      },
      download: function (id) { return drive.download(id).then(function (b) { return { ok: true, data: K.text(b) }; }, function (e) { return { ok: false, error: e.message }; }); },
      remove: function () { return Promise.resolve(NOT_ON_IPAD); }
    },
    sync: {
      status: function () { return sync ? sync.status() : { on: false, role: 'off', history: [] }; },
      enable: function () { return sync ? sync.enable() : Promise.resolve({ ok: false }); },
      disable: function () { return Promise.resolve({ ok: false, error: 'ipad' }); },
      makePrimary: function () { return sync ? sync.makePrimary() : Promise.resolve({ ok: false, error: 'drive_off' }); },
      forceTakeover: function () { return sync ? sync.forceTakeover() : Promise.resolve({ ok: false, error: 'drive_off' }); },
      syncNow: function () { return sync ? sync.flush() : Promise.resolve({ ok: false }); },
      check: function () { return sync ? sync.tick().then(function () { return sync.status(); }) : Promise.resolve({}); },
      dismiss: function () { if (sync) sync.dismiss(); return Promise.resolve({ ok: true }); },
      rescuedData: function (id) { return sync ? sync.rescuedData(id) : Promise.resolve({ ok: false }); },
      rescuedDone: function () { return Promise.resolve({ ok: false }); },
      onEvent: function (f) { fns.push(f); return function () { var i = fns.indexOf(f); if (i >= 0) fns.splice(i, 1); }; }
    }
  };
  window.sitcomDesktop = D;

  // For the start-up and setup screens (web/start.js)
  var W0 = window.SC_WEB = {
    DATA_KEY: DATA_KEY, mem: mem, persist: persist, flushed: flushed,
    ready: loadAll(),
    redirected: null,
    signIn: signIn, signInRedirect: signInRedirect, standalone: standalone, tokenOk: tokenOk, findRoot: findRoot, drive: drive,
    startSync: startSync, sync: function () { return sync; },
    booted: function () { booting = false; },
    newId: function () { return 'ipad-' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); }
  };
  W0.redirected = W0.ready.then(takeRedirect);
})();
