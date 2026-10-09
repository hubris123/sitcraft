// SitCraft iPad app — start-up. First time: the setup screen (sign in → find your data → scan the code from your PC → name
// this iPad). After that: load the copy saved on this iPad, check Drive for anything newer, then start the normal screens.
(function () {
  'use strict';
  var W = window.SC_WEB, K = window.SC_KIT, mem = W.mem;
  var $ = function (h) { var d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstChild; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var clock = function (iso) { if (!iso) return '?'; var t = new Date(iso), h = t.getHours(), m = t.getMinutes(); return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM'); };
  var day = function (iso) { var t = new Date(iso); return t.toLocaleString('en-US', { month: 'short' }) + ' ' + t.getDate(); };
  var who = function (d) { return d ? (d.kind === 'ipad' ? 'the iPad' : (d.name || 'your PC')) : 'your PC'; };
  var normCode = function (s) { return String(s || '').toUpperCase().replace(/^SITCRAFT-PAIR:/, '').replace(/[^A-Z0-9]/g, ''); };

  // ---------- setup screen ----------
  var S = { other: false, step: 1, email: '', ctl: null, code: '', name: 'iPad', err: '', busy: '', scanning: false };
  var root = null, stream = null, scanTimer = null;
  function css() {
    if (document.getElementById('sc-setup-css')) return;
    var st = document.createElement('style'); st.id = 'sc-setup-css';
    st.textContent = '#sc-setup{min-height:100%;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 40px;box-sizing:border-box;font-family:Geist,system-ui,sans-serif;color:#ecebe8}' +
      '#sc-setup .card{width:min(620px,100%);border-radius:22px;background:#1a1c21;border:1px solid #2c3038;padding:26px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px}' +
      '#sc-setup h1{margin:0;font-size:24px;font-weight:600}#sc-setup .sub{font-size:14px;color:#9a9ca3;line-height:1.5}' +
      '#sc-setup .st{display:flex;gap:14px;align-items:flex-start;padding:14px;border-radius:14px;background:#15171b;border:1px solid #2a2e36}' +
      '#sc-setup .n{flex:none;width:28px;height:28px;border-radius:99px;display:grid;place-items:center;font-size:14px;font-weight:700}' +
      '#sc-setup .done{background:#1f5c52;color:#7fe0d3}#sc-setup .cur{background:#ecebe8;color:#101114}#sc-setup .todo{background:#262930;color:#8d9098}' +
      '#sc-setup .t{font-size:16px;font-weight:600}#sc-setup .s{font-size:13.5px;color:#9a9ca3;line-height:1.5;margin-top:3px}' +
      '#sc-setup button{font:inherit;font-size:16px;font-weight:600;border-radius:12px;padding:12px 18px;min-height:48px;border:1px solid #3a3e46;background:transparent;color:#ecebe8;cursor:pointer}' +
      '#sc-setup button.pri{background:#ecebe8;color:#101114;border-color:#ecebe8}#sc-setup button[disabled]{opacity:.45}' +
      '#sc-setup input{font:inherit;font-size:17px;color:#ecebe8;background:#0f1013;border:1px solid #3a3e46;border-radius:10px;padding:12px 14px;width:100%;box-sizing:border-box;margin-top:8px}' +
      '#sc-setup .code{font-family:"Geist Mono",monospace;letter-spacing:.12em;text-transform:uppercase}' +
      '#sc-setup .err{font-size:14px;color:#f5a39b;line-height:1.5}#sc-setup .busy{font-size:14px;color:#c9c7c2}' +
      '#sc-setup video{width:100%;max-height:300px;border-radius:12px;background:#000;margin-top:10px;object-fit:cover}' +
      '#sc-setup .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}' +
      '@keyframes scSpin{to{transform:rotate(360deg)}}.sc-spin{display:inline-block;flex:none;width:16px;height:16px;box-sizing:border-box;border-radius:50%;border:2px solid rgba(46,196,176,.28);border-top-color:#2ec4b0;animation:scSpin .8s linear infinite;vertical-align:-3px;margin-right:9px}' +
      '#sc-setup .busy{display:flex;align-items:center}';
    document.head.appendChild(st);
  }
  function stepBox(n, title, body, state) {
    return '<div class="st"><span class="n ' + state + '">' + (state === 'done' ? '✓' : n) + '</span><div style="flex:1;min-width:0"><div class="t">' + title + '</div>' + body + '</div></div>';
  }
  function render() {
    css();
    var app = document.getElementById('app');
    if (!root) { root = document.createElement('div'); root.id = 'sc-setup'; app.innerHTML = ''; app.appendChild(root); }
    // Opened in Safari/Chrome (not from the Home Screen): first ask to add SitCraft to the Home Screen — the Home Screen app
    // keeps its own storage, so setting up in the browser would only have to be done again there.
    if (!W.standalone() && !mem.homeSkip && S.step === 1 && !S.busy) { root.innerHTML = homeCard(); root.querySelector('[data-a="here"]').onclick = function () { W.persist('homeSkip', { at: Date.now() }); render(); }; return; }
    var st = function (n) { return S.step > n ? 'done' : (S.step === n ? 'cur' : 'todo'); };
    var c = S.ctl, h = '<div class="card"><div><h1>Set up SitCraft on this iPad</h1><div class="sub">Your shows come from your own Google Drive. Your PC stays the home base.</div></div>';
    if (mem.unpaired) h += '<div class="sub" style="color:#f2b33d">' + (mem.unpaired.removed ? 'This iPad was removed on your PC, so it forgot your shows.' : 'This iPad was disconnected' + (mem.unpaired.by ? ' because “' + esc(mem.unpaired.by) + '” was paired instead' : '') + '.') + ' Set it up again to use it.</div>';
    h += stepBox(1, 'Sign in with Google', S.step > 1 ? '<div class="s">Signed in' + (S.email ? ' as ' + esc(S.email) : '') + '</div>' :
      '<div class="s">Use the same Google account as SitCraft on your PC. If Google says the app isn’t verified, choose <b>Advanced</b> → <b>Go to SitCraft</b>.</div><div class="row"><button class="pri" data-a="signin">Sign in with Google</button>' + (S.other || W.standalone() ? '<button data-a="signin2">Sign in another way</button>' : '') + '</div>', st(1));
    h += stepBox(2, 'Find your SitCraft data', S.step > 2 && c ? '<div class="s">Found it in Drive · <b style="color:#ecebe8">' + esc(who(c.primary).replace(/^the /, '')) + '</b> is in charge · last saved ' + esc(day(c.savedAt)) + ' at ' + esc(clock(c.savedAt)) + '</div>' : '<div class="s">Looks for the “SitCraft Backups” folder your PC keeps in Drive.</div>', st(2));
    h += stepBox(3, 'Scan the code on your PC', S.step > 3 ? '<div class="s">Code accepted</div>' : (S.step < 3 ? '<div class="s">On your PC: App settings → iPad → <b>Pair an iPad</b>.</div>' :
      '<div class="s">On your PC open App settings → iPad → <b>Pair an iPad</b>, then scan the code it shows — or type the short code under it.</div>' +
      (S.scanning ? '<video id="sc-cam" playsinline muted></video><div class="row"><button data-a="stopscan">Stop camera</button></div>' : '<div class="row"><button class="pri" data-a="scan">Scan with the camera</button></div>') +
      '<input class="code" id="sc-code" placeholder="or type the code, e.g. K7MQ-4T2P" autocomplete="off" autocapitalize="characters" value="' + esc(S.code) + '"><div class="row"><button data-a="usecode">Use this code</button></div>'), st(3));
    h += stepBox(4, 'Name this iPad', S.step < 4 ? '<div class="s">Only one iPad at a time — using this one replaces any other.</div>' :
      '<input id="sc-name" value="' + esc(S.name) + '" maxlength="40" aria-label="Name this iPad"><div class="s" style="margin-top:8px">Only one iPad at a time — using this one replaces any other.</div><div class="row" style="justify-content:flex-end"><button class="pri" data-a="use">Use this iPad</button></div>', st(4));
    if (S.busy) h += '<div class="busy" role="status"><span class="sc-spin"></span>' + esc(S.busy) + '</div>';
    if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
    h += '</div>';
    root.innerHTML = h;
    // while something is working, every button waits (greyed) so it isn't pressed again
    root.querySelectorAll('button[data-a]').forEach(function (b) { if (S.busy && b.getAttribute('data-a') !== 'stopscan') b.disabled = true; b.onclick = function () { if (!S.busy) act(b.getAttribute('data-a')); }; });
    var ci = document.getElementById('sc-code'); if (ci) ci.oninput = function () { S.code = ci.value; };
    var ni = document.getElementById('sc-name'); if (ni) ni.oninput = function () { S.name = ni.value; };
    if (S.scanning) startCamera();
  }
  function homeCard() {
    var ua = navigator.userAgent || '', chrome = /CriOS|EdgiOS|FxiOS/.test(ua), name = /EdgiOS/.test(ua) ? 'Edge' : (/FxiOS/.test(ua) ? 'Firefox' : (chrome ? 'Chrome' : 'Safari'));
    var share = '<b>Share</b> button (a square with an arrow pointing up)';
    var steps = chrome ?
      [['Tap the ' + share, 'It’s at the right end of the address bar. (No Share button? Tap ⋯ and choose <b>Share…</b>.)'], ['Scroll down and tap <b>Add to Home Screen</b>', 'It’s in the list of actions under the row of apps.'], ['Tap <b>Add</b>', 'The SitCraft icon appears on your Home Screen.'], ['Open SitCraft from the new icon', 'Set it up there — sign in and scan the code from your PC.']] :
      [['Tap the ' + share, 'It’s at the top of the screen, next to the address bar.'], ['Tap <b>Add to Home Screen</b>', 'Scroll down the list if you don’t see it.'], ['Tap <b>Add</b>', 'The SitCraft icon appears on your Home Screen.'], ['Open SitCraft from the new icon', 'Set it up there — sign in and scan the code from your PC.']];
    var h = '<div class="card"><div><h1>First, add SitCraft to your Home Screen</h1><div class="sub">SitCraft then opens like an app: full screen with no browser bars, it works without internet, and your work is kept safe on this iPad. (A Home Screen app keeps its own storage, so set it up there rather than here in ' + name + '.)</div></div>';
    if (mem.unpaired) h += '<div class="sub" style="color:#f2b33d">' + (mem.unpaired.removed ? 'This iPad was removed on your PC, so it forgot your shows.' : 'This iPad was disconnected' + (mem.unpaired.by ? ' because “' + esc(mem.unpaired.by) + '” was paired instead' : '') + '.') + '</div>';
    steps.forEach(function (x, i) { h += stepBox(i + 1, x[0], '<div class="s">' + x[1] + '</div>', i === 0 ? 'cur' : 'todo'); });
    h += '<div class="row" style="justify-content:flex-end"><button data-a="here" style="font-size:14px;min-height:44px;color:#9a9ca3;border-color:#2a2e36">Set up here in ' + name + ' instead</button></div></div>';
    return h;
  }
  function set(p) { Object.assign(S, p); render(); }
  function act(a) {
    if (a === 'signin') {
      set({ err: '', busy: 'Waiting for Google…' });
      W.signIn(false).then(function (r) {
        if (!r.ok) return set({ busy: '', other: true, err: 'Google sign-in didn’t finish: ' + r.error + '. If no window opened, try “Sign in another way”.' });
        set({ email: r.email, step: 2, busy: 'Looking for your SitCraft data…' }); findData();
      });
    } else if (a === 'signin2') { set({ err: '', busy: 'Opening Google…' }); W.signInRedirect(false); }
    else if (a === 'scan') set({ scanning: true, err: '' });
    else if (a === 'stopscan') { stopCamera(); set({ scanning: false }); }
    else if (a === 'usecode') checkCode(S.code);
    else if (a === 'use') finish();
  }
  function readControl() {
    return W.findRoot().then(function () { return W.drive.find('SitCraft Control.json'); }).then(function (id) {
      if (!id) return null; return W.drive.download(id).then(function (b) { return JSON.parse(K.text(b)); });
    });
  }
  function findData() {
    readControl().then(function (c) {
      if (!c) return set({ busy: '', err: 'Your SitCraft folder is there, but Drive sync isn’t switched on yet. On your PC: App settings → iPad → turn on Drive sync, then tap Sign in again.', step: 1 });
      set({ ctl: c, step: 3, busy: '' });
    }, function (e) { set({ busy: '', step: 1, err: e.code === 'no_data' ? e.message : 'Couldn’t read Google Drive: ' + e.message }); });
  }
  function checkCode(raw) {
    var code = normCode(raw);
    if (code.length < 6) return set({ err: 'Type the code exactly as it appears on your PC.' });
    set({ busy: 'Checking the code…', err: '' });
    readControl().then(function (c) {
      var p = c && c.pairing;
      if (!p) return set({ busy: '', err: 'Your PC isn’t showing a pairing code right now. On your PC: App settings → iPad → Pair an iPad.' });
      if (Date.parse(p.expires) < Date.now()) return set({ busy: '', err: 'That code has expired. On your PC, choose Pair an iPad again for a fresh one.' });
      if (K.sha('sitcraft-pair:' + code) !== p.hash) return set({ busy: '', err: 'That code doesn’t match the one on your PC. Check it, or choose Pair an iPad again for a fresh one.' });
      stopCamera();
      set({ ctl: c, code: code, scanning: false, step: 4, busy: '' });
    }, function (e) { set({ busy: '', err: 'Couldn’t read Google Drive: ' + e.message }); });
  }
  function startCamera() {
    if (stream) { var v0 = document.getElementById('sc-cam'); if (v0 && !v0.srcObject) { v0.srcObject = stream; v0.play(); } return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return set({ scanning: false, err: 'This browser can’t use the camera here — type the code instead.' });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      stream = s; var v = document.getElementById('sc-cam'); if (!v) return; v.srcObject = s; v.play();
      var cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
      scanTimer = setInterval(function () {
        var vid = document.getElementById('sc-cam'); if (!vid || !vid.videoWidth) return;
        var w = Math.min(640, vid.videoWidth), hh = Math.round(vid.videoHeight * w / vid.videoWidth); cv.width = w; cv.height = hh;
        cx.drawImage(vid, 0, 0, w, hh);
        var img = cx.getImageData(0, 0, w, hh), r = window.jsQR && window.jsQR(img.data, w, hh, { inversionAttempts: 'dontInvert' });
        if (r && /^SITCRAFT-PAIR:/i.test(r.data)) { clearInterval(scanTimer); scanTimer = null; S.code = normCode(r.data); checkCode(r.data); }
      }, 250);
    }, function () { set({ scanning: false, err: 'The camera wasn’t allowed — type the code instead (or allow the camera for this site and try again).' }); });
  }
  function stopCamera() { if (scanTimer) clearInterval(scanTimer); scanTimer = null; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  function finish() {
    var name = String(S.name || '').trim() || 'iPad';
    var dev = { id: W.newId(), name: name, kind: 'ipad' };
    set({ busy: 'Connecting this iPad and downloading your shows…', err: '' });
    W.persist('device', dev); W.persist('unpaired', undefined);
    var sy = W.startSync(), code = S.code;
    sy.updateControl(function (c) {
      var p = c.pairing;
      if (!p || Date.parse(p.expires) < Date.now() || sy.sha('sitcraft-pair:' + code) !== p.hash) { c.__bad = true; return false; }
      c.paired = { id: dev.id, name: dev.name, kind: 'ipad', at: new Date().toISOString() }; c.pairing = null;
      c.history = (c.history || []).concat([{ at: new Date().toISOString(), type: 'paired', to: { id: dev.id, name: dev.name, kind: 'ipad' } }]);
    }).then(function (c) {
      if (!c || c.__bad) { W.persist('device', undefined); return set({ busy: '', step: 3, err: 'The code expired or changed while setting up. On your PC, choose Pair an iPad again.' }); }
      return sy.enable().then(function () { return W.flushed(); }).then(function () { location.reload(); });
    }, function (e) { W.persist('device', undefined); set({ busy: '', err: 'Couldn’t reach Google Drive: ' + e.message }); });
  }

  // ---------- normal start ----------
  // Sign-in expired: a bar to sign in again. With no internet there's nothing to sign in to, so it just says your work is
  // safe on this iPad, and turns back into the sign-in bar when the internet returns.
  var failedOnce = false;
  // a bar that's working: greyed, a spinner, and further taps ignored until it's done
  function barBusy(b, text) { css(); b.disabled = true; b.style.opacity = '.75'; b.innerHTML = '<span class="sc-spin"></span>' + esc(text); }
  function barReady(b, text) { b.disabled = false; b.style.opacity = ''; b.textContent = text; }
  function reconnectBar() {
    var b = document.getElementById('sc-reconnect');
    if (!b) {
      b = $('<button id="sc-reconnect" style="position:fixed;left:50%;transform:translateX(-50%);bottom:52px;z-index:60;font:600 15px Geist,system-ui,sans-serif;border-radius:999px;padding:12px 18px;min-height:46px;border:1px solid #6b4a2a;background:#2a2112;color:#f2d8a8;box-shadow:0 10px 30px rgba(0,0,0,.5)"></button>');
      b.onclick = function () {
        if (!navigator.onLine) return;
        if (b.disabled) return;
        if (failedOnce) { barBusy(b, 'Opening Google…'); W.signInRedirect(true); return; }
        barBusy(b, 'Waiting for Google…');
        W.signIn(true).then(function (r) { if (r.ok) { b.remove(); var s = W.sync(); if (s) s.tick(); } else { failedOnce = true; barReady(b, 'Didn’t work — tap to sign in another way'); } });
      };
      document.body.appendChild(b);
      if (navigator.onLine && W.logSign) W.logSign('bar', {});
    }
    if (!navigator.onLine) b.textContent = 'No internet — your work is saved on this iPad and will sync when you’re back online';
    else if (/^No internet/.test(b.textContent) || !b.textContent) b.textContent = 'Google sign-in needed to sync — tap to reconnect';
  }
  function checkBar() { if (!W.tokenOk()) reconnectBar(); else { var b = document.getElementById('sc-reconnect'); if (b) b.remove(); } }
  window.addEventListener('online', function () { if (document.getElementById('sc-reconnect')) checkBar(); });
  window.addEventListener('sc-signin-lost', function () { if (mounted) reconnectBar(); });
  window.addEventListener('offline', function () { if (document.getElementById('sc-reconnect')) reconnectBar(); });

  // ---------- offline copy of the app + updates ----------
  // The app files are kept on the iPad by web/sw.js. A new version downloads in the background; before anything is open it's
  // switched to straight away, otherwise a bar offers it (your work is saved first).
  var mounted = false, reloading = false;
  function updateBar(reg) {
    if (!reg || !reg.waiting) return;
    if (!mounted && !root) return applyUpdate(reg); // still starting up: nothing open, switch now
    if (document.getElementById('sc-update')) return;
    var b = $('<button id="sc-update" style="position:fixed;left:50%;transform:translateX(-50%);bottom:max(10px, env(safe-area-inset-bottom));z-index:60;font:600 14px Geist,system-ui,sans-serif;border-radius:999px;padding:10px 16px;min-height:44px;border:1px solid #3c3360;background:#1c1830;color:#cfc3fb;box-shadow:0 10px 30px rgba(0,0,0,.5)">New version of SitCraft ready — tap to update</button>');
    b.onclick = function () { if (b.disabled) return; barBusy(b, 'Updating…'); applyUpdate(reg); };
    document.body.appendChild(b);
    // Or quietly, the next time you switch away from SitCraft (it restarts on the new version while it's out of sight)
    var away = function () { if (document.visibilityState !== 'hidden') return; document.removeEventListener('visibilitychange', away); applyUpdate(reg); };
    document.addEventListener('visibilitychange', away);
  }
  function applyUpdate(reg) {
    if (!reg.waiting) return;
    var s = W.sync(), first = s && mounted ? s.flush().catch(function () {}) : Promise.resolve();
    first.then(function () { return W.flushed(); }).then(function () { reg.waiting.postMessage('update-now'); });
  }
  function offlineSetup() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (reloading || !W.sw.had) return; reloading = true; W.flushed().then(function () { location.reload(); }); });
    W.sw.had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      W.sw.reg = reg;
      updateBar(reg);
      reg.addEventListener('updatefound', function () {
        var n = reg.installing; if (!n) return;
        n.addEventListener('statechange', function () { if (n.state === 'installed' && navigator.serviceWorker.controller) updateBar(reg); });
      });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(function () {}); });
    }, function () {});
  }
  // When the on-screen keyboard opens, the iPad slides what you see down the page. Bars marked .sc-pinned (the "… is
  // primary" bar) follow, so they stay at the top of the screen instead of sliding off it.
  (function () {
    var vv = window.visualViewport; if (!vv) return;
    var q = 0, put = function () { q = 0; document.documentElement.style.setProperty('--sc-vv-top', Math.max(0, Math.round(vv.offsetTop)) + 'px'); };
    var soon = function () { if (!q) q = requestAnimationFrame(put); };
    vv.addEventListener('scroll', soon); vv.addEventListener('resize', soon); window.addEventListener('scroll', soon, true);
  })();
  W.sw = { had: false, reg: null };
  offlineSetup();
  function mountApp() { window.DC.mount('App', document.getElementById('app'), {}); W.booted(); mounted = true; }
  W.ready.then(function () { return W.redirected; }).then(function (back) {
    if (!mem.device || !mem[W.DATA_KEY]) {
      // setting up: carry on after coming back from Google's sign-in page
      if (back && back.ok) { set({ email: back.email, step: 2, busy: 'Looking for your SitCraft data…' }); return findData(); }
      if (back) S.err = 'Google sign-in didn’t finish: ' + back.error + '.';
      if (back) S.other = true;
      return render();
    }
    var sy = W.startSync();
    var go = function () { if (mounted) return; mountApp(); checkBar(); setInterval(function () { if (!W.tokenOk()) reconnectBar(); }, 30000); };
    if (!W.tokenOk() || !navigator.onLine) return go();
    Promise.race([sy.tick(), new Promise(function (r) { setTimeout(r, 8000); })]).then(go, go);
  });
})();
