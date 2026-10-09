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

  // ---------------- Sign-in log: why the "tap to reconnect" bar appears (App settings → iPad shows it) ----------------
  function logSign(ev, x) {
    var L = (mem.signLog || []).concat([Object.assign({ at: Date.now(), ev: ev }, x || {})]);
    persist('signLog', L.slice(-40));
  }
  var expLogged = '';
  function gotPass(t, how) {
    var mins = Math.round((t.exp - Date.now()) / 60000);
    return function (email) { logSign('got', { how: how, mins: mins, email: email || '' }); };
  }
  // ---------------- Google sign-in ----------------
  // Google gives a web app 1-hour passes. The SitCraft sign-in helper (a Cloudflare Worker that keeps the Google secret,
  // dev-tools/cloudflare/sitcraft-signin.js) turns one sign-in into a long-lasting "refresh" pass, kept here locked with
  // a key that can't be copied out of this iPad, and renews the 1-hour pass quietly whenever it runs out.
  var HELPER = 'https://sitcraft-signin.mvavrick.workers.dev';
  var subtle = window.crypto && crypto.subtle;
  function u8b64(u) { var s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function b64u8(b) { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function lockKey() {
    if (mem.gLock) return Promise.resolve(mem.gLock);
    return subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (k) { persist('gLock', k); return k; });
  }
  function saveRefresh(rt) {
    if (!rt || !subtle) return Promise.resolve(false);
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return lockKey().then(function (k) { return subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(rt)); })
      .then(function (ct) { persist('gRef', { iv: u8b64(iv), ct: u8b64(new Uint8Array(ct)), at: Date.now() }); return true; }, function () { return false; });
  }
  function readRefresh() {
    var r = mem.gRef; if (!r || !mem.gLock || !subtle) return Promise.resolve(null);
    return subtle.decrypt({ name: 'AES-GCM', iv: b64u8(r.iv) }, mem.gLock, b64u8(r.ct)).then(function (b) { return new TextDecoder().decode(b); }, function () { return null; });
  }
  var stays = function () { return !!(mem.gRef && mem.gLock); };
  function setPass(at, secs, how, email) {
    var t = { tok: at, exp: Date.now() + (Number(secs) || 3600) * 1000, email: email || (mem.gtoken && mem.gtoken.email) || '' };
    persist('gtoken', t); expLogged = '';
    var lg = gotPass(t, how);
    return fetch(G + '/oauth2/v3/userinfo', { headers: { authorization: 'Bearer ' + t.tok } }).then(function (x) { return x.ok ? x.json() : {}; }).then(function (u) {
      if (u && u.email) { t.email = u.email; persist('gtoken', t); }
      lg(t.email); return t;
    }, function () { lg(t.email); return t; });
  }
  // A new 1-hour pass from the helper (one at a time). Resolves with the pass, or rejects with code drive_auth.
  var renewing = null;
  function renew(why) {
    if (renewing) return renewing;
    renewing = readRefresh().then(function (rt) {
      if (!rt) throw Object.assign(new Error('Google sign-in needed'), { code: 'drive_auth' });
      return fetch(HELPER + '/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.ok && j.access_token) {
            var t = { tok: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, email: (mem.gtoken && mem.gtoken.email) || '' };
            persist('gtoken', t); expLogged = ''; logSign('renewed', { why: why || '' }); return t.tok;
          }
          if (r.status === 401 || j.error === 'revoked') {   // removed in the Google account (or Unpair): sign in again
            persist('gRef', undefined); logSign('renewFail', { why: 'revoked' });
            try { window.dispatchEvent(new Event('sc-signin-lost')); } catch (e) {}
          } else logSign('renewFail', { why: j.error || ('http ' + r.status) });
          throw Object.assign(new Error('Google sign-in needed'), { code: 'drive_auth' });
        });
      }, function () { logSign('renewFail', { why: 'offline' }); throw Object.assign(new Error('Couldn’t reach the sign-in helper'), { code: 'drive_error' }); });
    });
    var done = function () { renewing = null; };
    renewing.then(done, done);
    return renewing;
  }
  var tokenClient = null, codeClient = null, signWaiters = null;
  function gisReady() {
    return new Promise(function (res, rej) {
      var n = 0; (function wait() { if (window.google && google.accounts && google.accounts.oauth2) return res(); if (++n > 100) return rej(new Error('Google sign-in didn’t load — check the internet connection.')); setTimeout(wait, 100); })();
    });
  }
  // The Google pop-up. With the helper it asks for a sign-in code, which the helper turns into passes that keep you signed in.
  function signIn(hint) {
    if (standalone()) { logSign('signStart', { how: 'Google’s page (Home Screen app)' }); return signInRedirect(hint); }
    logSign('signStart', { how: 'pop-up' });
    return gisReady().then(function () {
      return new Promise(function (res) {
        signWaiters = res;
        var fail = function (msg) { logSign('signFail', { why: String(msg || '').slice(0, 120) }); var done = signWaiters; signWaiters = null; if (done) done({ ok: false, error: msg }); };
        if (google.accounts.oauth2.initCodeClient) {
          codeClient = google.accounts.oauth2.initCodeClient({
            client_id: CLIENT_ID, scope: SCOPE, ux_mode: 'popup', select_account: !hint,
            hint: hint && mem.gtoken && mem.gtoken.email ? mem.gtoken.email : undefined,
            callback: function (r) {
              if (!r || !r.code) return fail((r && (r.error_description || r.error)) || 'Sign-in didn’t finish');
              fetch(HELPER + '/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: r.code }) })
                .then(function (x) { return x.json().catch(function () { return {}; }); })
                .then(function (j) {
                  if (!j.access_token) return fail('The sign-in helper couldn’t finish (' + (j.error || 'no answer') + ')');
                  var keep = j.refresh_token ? saveRefresh(j.refresh_token) : Promise.resolve(false);
                  return keep.then(function (kept) {
                    return setPass(j.access_token, j.expires_in, kept ? 'pop-up · stays signed in' : 'pop-up').then(function (t) {
                      var done = signWaiters; signWaiters = null;
                      if (done) done({ ok: true, email: t.email, stays: kept });
                      if (sync) sync.tick();
                    });
                  });
                }, function () { fail('Couldn’t reach the sign-in helper — check the internet connection'); });
            },
            error_callback: function (e) { fail((e && (e.message || e.type)) || 'The sign-in window was closed or blocked'); }
          });
          codeClient.requestCode();
          return;
        }
        // (older Google script without the code pop-up: a 1-hour pass only)
        if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID, scope: SCOPE,
          callback: function (r) {
            if (!r || !r.access_token) return fail((r && (r.error_description || r.error)) || 'Sign-in didn’t finish');
            setPass(r.access_token, r.expires_in, 'pop-up').then(function (t) { var done = signWaiters; signWaiters = null; if (done) done({ ok: true, email: t.email }); if (sync) sync.tick(); });
          },
          error_callback: function (e) { fail((e && (e.message || e.type)) || 'The sign-in window was closed or blocked'); }
        });
        tokenClient.requestAccessToken(hint && mem.gtoken && mem.gtoken.email ? { login_hint: mem.gtoken.email, prompt: '' } : {});
      });
    }, function (e) { return { ok: false, error: e.message }; });
  }
  // Sign in another way: go to Google's own page (through the helper, so it also keeps you signed in) and come back.
  // The helper's /callback address is listed in the "SitCraft iPad" client's Authorized redirect URIs.
  function standalone() { try { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; } }
  function backTo() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function signInRedirect(hint) {
    var st = Math.random().toString(36).slice(2) + Date.now().toString(36);
    persist('oauthState', { s: st, at: Date.now() });
    return flushed().then(function () {
      var u = HELPER + '/start?back=' + encodeURIComponent(backTo()) + '&state=' + encodeURIComponent(st) +
        (hint && mem.gtoken && mem.gtoken.email ? '&hint=' + encodeURIComponent(mem.gtoken.email) : '');
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
    if (!want || want.s !== P.state || Date.now() - want.at > 15 * 60000) { logSign('signFail', { why: 'came back without this iPad’s code' }); return Promise.resolve({ ok: false, error: 'That sign-in didn’t come from this iPad — try again' }); }
    if (!P.access_token) { logSign('signFail', { why: P.error || 'no pass' }); return Promise.resolve({ ok: false, error: P.error === 'access_denied' ? 'Sign-in was cancelled' : (P.error_description || P.error || 'Sign-in didn’t finish') }); }
    var keep = P.refresh_token ? saveRefresh(P.refresh_token) : Promise.resolve(false);
    return keep.then(function (kept) {
      return setPass(P.access_token, P.expires_in, kept ? 'sign in another way · stays signed in' : 'sign in another way').then(function (t) { return { ok: true, email: t.email, redirect: true, stays: kept }; });
    });
  }
  function token() {
    var t = mem.gtoken;
    if (t && t.tok && t.exp > Date.now() + 60000) return t.tok;
    if (t && t.tok && t.exp && expLogged !== t.tok && !stays()) { expLogged = t.tok; logSign('expired', {}); }
    throw Object.assign(new Error('Google sign-in needed'), { code: 'drive_auth' });
  }
  // Signed in = a pass that's still good, or a kept sign-in the helper can renew
  var tokenOk = function () { try { token(); return true; } catch (e) { return stays(); } };
  // A good pass for the next call: renews it quietly (5 minutes early) when the sign-in is kept
  function ensure() {
    var t = mem.gtoken;
    if (stays() && (!t || !t.tok || t.exp < Date.now() + 5 * 60000)) return renew(t && t.tok ? 'ran out' : 'start').catch(function (e) { try { return token(); } catch (x) { throw e; } });
    try { return Promise.resolve(token()); } catch (e) { return Promise.reject(e); }
  }

  // ---------------- Google Drive over https ----------------
  function gcall(url, opts, again) {
    opts = opts || {};
    var where = String(url).replace(/^https:\/\/[^/]+/, '').split('?')[0].slice(0, 40);
    return ensure().then(function (tok) {
      return fetch(url, Object.assign({}, opts, { headers: Object.assign({ authorization: 'Bearer ' + tok }, opts.headers || {}) })).then(function (r) {
        if (r.ok) { if (again) logSign('retryOk', { where: where }); return r; }
        // Google sometimes says "not signed in" for a moment: get a fresh pass (or wait) and try once more
        if (r.status === 401 && !again) {
          var next = stays() ? renew('drive said no').then(function () {}, function () {}) : new Promise(function (res) { setTimeout(res, 1500); });
          return next.then(function () { return gcall(url, opts, true); });
        }
        return r.text().then(function (t) {
          if (r.status === 401) { var g = mem.gtoken; logSign('drive401', { where: where, mins: g && g.exp ? Math.round((g.exp - Date.now()) / 60000) : null }); if (g) persist('gtoken', Object.assign({}, g, { exp: 0 })); if (!stays()) { try { window.dispatchEvent(new Event('sc-signin-lost')); } catch (e) {} } }
          throw Object.assign(new Error('Google Drive error ' + r.status + ' ' + String(t).slice(0, 160)), { status: r.status, code: r.status === 404 ? 'not_found' : (r.status === 401 ? 'drive_auth' : 'drive_error') });
        });
      });
    });
  }
  var rootId = null;
  var picCache = {};   // full character-sheet pictures already fetched this session (by Drive id)
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
      b.onclick = function () { if (b.disabled) return; b.disabled = true; b.style.opacity = '.75'; b.innerHTML = '<span class="sc-spin" style="display:inline-block;width:16px;height:16px;vertical-align:-3px;margin-right:9px"></span>Updating…'; flushed().then(function () { location.reload(); }); };
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
    Object.keys(mem).forEach(function (k) { if (k !== 'unpaired' && k !== 'homeSkip') persist(k, undefined); });
    persist('unpaired', { by: other ? other.name : '', removed: !other, at: Date.now() });
    flushed().then(function () { location.reload(); });
  }
  // Battery: the sync's regular Drive check skips while the app is hidden (it checks again on return) and, when this
  // iPad is only viewing and hasn't been touched for 2 minutes, runs every 3rd time (30 s instead of 10 s).
  // The device in charge keeps every check, so its "still here" note and handover answers stay on time.
  var lastTouch = Date.now();
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, function () { lastTouch = Date.now(); }, true); });
  var syncTimers = {
    set: function (f, ms) { return setTimeout(f, ms); }, clear: function (h) { clearTimeout(h); }, stop: function (h) { clearInterval(h); },
    every: function (f, ms) {
      var n = 0;
      return setInterval(function () {
        if (document.visibilityState === 'hidden') return;
        var idle = Date.now() - lastTouch > 120000, viewing = false;
        try { viewing = !!(sync && sync.status && sync.status().role !== 'primary'); } catch (e) {}
        if (idle && viewing && (++n % 3)) return;
        f();
      }, ms);
    }
  };
  function startSync() {
    if (sync || !mem.device) return sync;
    sync = window.SitSync.createSync({
      drive: drive, device: mem.device, emit: emit,
      local: { read: function () { return mem[DATA_KEY] || null; }, write: function (t) { persist(DATA_KEY, t); }, rescue: function (f, t) { persist('rescue:' + f, t); } },
      settings: { get: settingsGet, set: settingsSet },
      timers: syncTimers
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
      status: function () { var g = mem.gtoken || {}; return { connected: tokenOk(), email: g.email || '', clientId: '', builtIn: true, exp: g.exp || 0, stays: stays(), signLog: (mem.signLog || []).slice(-14) }; },
      stayIn: function () { return signIn(true); },
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
    // Character sheet pictures: on the iPad they go straight to Drive › SitCraft Backups › <Show> › Character sheets
    // (the PC keeps its own copy when it next shows them). Removing is PC-only.
    pics: {
      save: function (show, file, bytes, mime) {
        var showDir = String(show).replace(/[\\/:*?"<>|]/g, '').trim() || 'Show', name = String(file).replace(/[\\/:*?"<>|]/g, '').trim() || 'Picture.jpg';
        return findRoot().then(function (r) { return folderIn(showDir, r); }).then(function (f) { return folderIn('Character sheets', f); })
          .then(function (f) { return createFile(name, bytes, mime || 'image/jpeg', f); })
          .then(function (id) { picCache[id] = { bytes: bytes, mime: mime || 'image/jpeg' }; return { ok: true, file: name, drive: id, driveErr: '' }; }, function (e) { return { ok: false, code: e.code || 'drive_error', error: e.message }; });
      },
      upload: function () { return Promise.resolve({ ok: false, code: 'pc_only' }); },
      read: function (show, file, id) {
        if (!id) return Promise.resolve({ ok: false, error: 'This picture is still only on your PC — open SitCraft on the PC (with Drive on) to send it.' });
        if (picCache[id]) return Promise.resolve({ ok: true, bytes: picCache[id].bytes, mime: picCache[id].mime });
        var mime = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
        return drive.download(id).then(function (b) { picCache[id] = { bytes: b, mime: mime }; return { ok: true, bytes: b, mime: mime }; }, function (e) { return { ok: false, code: e.code || 'drive_error', error: e.message }; });
      },
      has: function () { return Promise.resolve({ ok: true, has: false }); },
      remove: function () { return Promise.resolve(NOT_ON_IPAD); },
      reveal: function () { return Promise.resolve({ ok: true }); }
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
  window.sitcomDesktop = window.SitBusy ? window.SitBusy(D, window) : D;   // slow buttons get a spinner (renderer/busy.js)

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
  W0.logSign = logSign;
  // a new start of the app (iPadOS may reload a Home Screen app it put to sleep)
  W0.ready.then(function () { var g = mem.gtoken; logSign('open', { left: g && g.tok && g.exp ? Math.round((g.exp - Date.now()) / 60000) : null }); });
})();
