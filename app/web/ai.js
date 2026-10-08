// SitCraft iPad app — AI on the iPad (opt-in on the PC). Loaded after web/bridge.js; plugs into window.sitcomDesktop.
//
// Getting the keys: the PC locks ALL its keys with a one-time key and puts only that locked copy in Drive
// ("SitCraft AI handoff.json"); the one-time key is only inside the QR code on the PC's screen. Scanning it here unlocks the
// copy, checks its fingerprint, and stores the keys LOCKED on this iPad: AES-256-GCM with a fresh random IV every time,
// using a lock key the browser creates as non-extractable (it can be used here but never read out or copied).
// The control file then records that this iPad has the current keys ("got").
//
// Staying in step with the PC: control.ai.on = false → wipe; control.ai.fp ≠ ours → "keys changed on your PC" (still usable
// until updated); model choices come from control.ai.cfg (the iPad follows the PC).
// Calls: the same requests as the PC (main.js claude:json / openai:json), made straight from the browser.
(function () {
  'use strict';
  var W = window.SC_WEB, D = window.sitcomDesktop, K = window.SC_KIT;
  if (!W || !D) return;
  var mem = W.mem, subtle = window.crypto && window.crypto.subtle;
  var API = 'https://api.anthropic.com/v1', OA = 'https://api.openai.com/v1', HANDOFF = 'SitCraft AI handoff.json';
  var keys = null;                       // unlocked keys in memory only: { claude, openai, fp }
  var bad = mem.aiBad || {};             // per provider: 'rejected' | 'credit' (cleared after a good call)
  var listeners = [];
  function changed() { listeners.slice().forEach(function (f) { try { f(); } catch (e) {} }); var s = W.sync(); if (s) s.status(true); }

  // ---------- locked storage on this iPad ----------
  function lockKey() {
    if (mem.aiLock) return Promise.resolve(mem.aiLock);
    return subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (k) { W.persist('aiLock', k); return k; });
  }
  function save(obj) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return lockKey().then(function (k) { return subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, K.bytes(JSON.stringify(obj))); })
      .then(function (ct) { W.persist('aiKeys', { iv: iv, ct: new Uint8Array(ct), fp: obj.fp, at: new Date().toISOString() }); keys = obj; return W.flushed(); });
  }
  function load() {
    var s = mem.aiKeys; if (!s || !mem.aiLock) return Promise.resolve(null);
    return subtle.decrypt({ name: 'AES-GCM', iv: s.iv }, mem.aiLock, s.ct).then(function (b) { keys = JSON.parse(K.text(new Uint8Array(b))); return keys; }, function () { return null; });
  }
  function wipe() { keys = null; bad = {}; W.persist('aiKeys', undefined); W.persist('aiLock', undefined); W.persist('aiBad', undefined); changed(); }
  function setBad(p, v) { if ((bad[p] || '') === (v || '')) return; if (v) bad[p] = v; else delete bad[p]; W.persist('aiBad', Object.assign({}, bad)); changed(); }

  // ---------- what the PC says (from the sync status) ----------
  function ctl() { var s = W.sync(); var v = s ? s.status() : null; return (v && v.ai) || null; }
  function cfg() { var a = ctl(); return (a && a.cfg) || mem.aiCfg || {}; }
  function st(p) {
    var a = ctl(), have = !!(keys && keys[p]);
    if (a && a.on === false) return 'off';
    if (!a && !have) return 'off';
    if (!have) return (mem.aiKeys && !keys) ? 'locked' : 'none';
    if (bad[p]) return bad[p];
    if (a && a.fp && keys.fp !== a.fp) return 'stale';
    return 'ok';
  }
  var BILL = { claude: 'https://platform.claude.com/settings/billing', openai: 'https://platform.openai.com/settings/organization/billing/overview' };
  function state() {
    var a = ctl();
    return { on: !!(a && a.on), claude: st('claude'), openai: st('openai'), hints: (a && a.hints) || {}, bill: BILL, online: navigator.onLine,
      sentAt: mem.aiKeys ? mem.aiKeys.at : '' };
  }
  // react to the PC: switched off → wipe; remember the latest model choices
  var lastOn = null;
  function watch(v) {
    var a = v && v.ai;
    if (a && a.cfg) { var j = JSON.stringify(a.cfg); if (JSON.stringify(mem.aiCfg || null) !== j) W.persist('aiCfg', a.cfg); }
    var on = a ? !!a.on : null;
    if (on === false && (mem.aiKeys || keys)) wipe();
    if (on !== lastOn) { lastOn = on; changed(); }
  }

  // ---------- getting the keys: scan the PC's QR code ----------
  function b64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function take(code) {
    var kb = String(code).replace(/^SITCRAFT-AI:/i, '').trim(), sy = W.sync();
    if (!sy) return Promise.reject(new Error('This iPad isn’t connected to your PC yet.'));
    return sy.tick().then(function () {
      var a = ctl();
      if (!a || !a.on) throw new Error('On your PC, turn on “Let the iPad use my AI keys” first.');
      if (!a.handoff || Date.parse(a.handoff.expires) < Date.now()) throw new Error('That code has expired. On your PC, choose Send AI keys to the iPad again.');
      if (a.handoff.kh !== sy.sha('sitcraft-ai-k:' + kb)) throw new Error('That code doesn’t match the one on your PC. Choose Send AI keys to the iPad again.');
      return W.drive.find(HANDOFF).then(function (id) { if (!id) throw new Error('The locked keys weren’t found in Drive — choose Send AI keys to the iPad again.'); return W.drive.download(id); });
    }).then(function (buf) {
      var H = JSON.parse(K.text(buf));
      return subtle.importKey('raw', b64u(kb), { name: 'AES-GCM' }, false, ['decrypt'])
        .then(function (k) { return subtle.decrypt({ name: 'AES-GCM', iv: b64(H.iv) }, k, b64(H.ct)); })
        .then(function (plain) { return JSON.parse(K.text(new Uint8Array(plain))); }, function () { throw new Error('Those keys couldn’t be unlocked — choose Send AI keys to the iPad again.'); });
    }).then(function (o) {
      bad = {}; W.persist('aiBad', undefined);
      return save({ claude: o.claude || '', openai: o.openai || '', fp: o.fp }).then(function () { return o; });
    }).then(function (o) {
      var dev = mem.device || {};
      return sy.updateControl(function (c) { if (!c.ai) return false; c.ai.got = { id: dev.id, name: dev.name, fp: o.fp, at: new Date().toISOString() }; })
        .then(function () { changed(); return { ok: true, claude: !!o.claude, openai: !!o.openai }; });
    });
  }

  // the "Get your AI keys from your PC" sheet: steps + camera; also takes a pasted code (for testing)
  var sheet = null, stream = null, timer = null;
  function css() {
    if (document.getElementById('sc-ai-css')) return;
    var s = document.createElement('style'); s.id = 'sc-ai-css';
    s.textContent = '#sc-ai{position:fixed;inset:0;z-index:90;display:grid;place-items:center;background:rgba(8,9,11,.66);backdrop-filter:blur(6px);font-family:Geist,system-ui,sans-serif;color:#ecebe8}' +
      '#sc-ai .card{width:min(560px,calc(100% - 32px));border-radius:20px;background:#1a1c21;border:1px solid #2c3038;box-shadow:0 30px 90px rgba(0,0,0,.6);padding:22px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}' +
      '#sc-ai h2{margin:0;font-size:20px}#sc-ai ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:14px;color:#c9c7c2;line-height:1.5}#sc-ai b{color:#ecebe8}' +
      '#sc-ai video{width:100%;height:240px;border-radius:12px;background:#000;object-fit:cover}#sc-ai .s{font-size:12.5px;color:#9a9ca3;line-height:1.5}' +
      '#sc-ai .msg{font-size:14px;line-height:1.5}#sc-ai .row{display:flex;gap:10px;justify-content:flex-end}' +
      '#sc-ai button{font:inherit;font-size:15px;font-weight:600;border-radius:11px;padding:10px 18px;min-height:44px;border:1px solid #3a3e46;background:transparent;color:#ecebe8;cursor:pointer}' +
      '#sc-ai button.pri{background:#ecebe8;color:#101114;border-color:#ecebe8}';
    document.head.appendChild(s);
  }
  function msg(t, col, spin) { var m = sheet && sheet.querySelector('.msg'); if (m) { m.style.color = col || '#c9c7c2'; m.innerHTML = (spin ? '<span class="sc-spin" style="display:inline-block;width:16px;height:16px;vertical-align:-3px;margin-right:9px"></span>' : '') + t; } }
  function stopCam() { if (timer) clearInterval(timer); timer = null; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  function close() { stopCam(); if (sheet) sheet.remove(); sheet = null; }
  function got(code) {
    stopCam(); msg('Unlocking your keys…', '#c9c7c2', true);
    take(code).then(function (r) {
      msg('✓ ' + [r.claude ? 'Claude' : '', r.openai ? 'ChatGPT' : ''].filter(Boolean).join(' and ') + (r.claude && r.openai ? ' are' : ' is') + ' ready on this iPad.', '#7fe0d3');
      var b = sheet && sheet.querySelector('[data-a=close]'); if (b) { b.textContent = 'Done'; b.className = 'pri'; }
    }, function (e) { msg(e.message || String(e), '#f5a39b'); var v = sheet && sheet.querySelector('video'); if (v) v.style.display = 'none'; var a = sheet && sheet.querySelector('[data-a=again]'); if (a) a.style.display = ''; });
  }
  function camera() {
    var v = sheet.querySelector('video'); v.style.display = '';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg('This browser can’t use the camera here.', '#f5a39b'); return; }
    msg('Point the camera at the code on your PC.');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      if (!sheet) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; v.srcObject = s; v.play();
      var cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
      timer = setInterval(function () {
        if (!v.videoWidth) return;
        var w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth); cv.width = w; cv.height = h; cx.drawImage(v, 0, 0, w, h);
        var r = window.jsQR && window.jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (r && /^SITCRAFT-AI:/i.test(r.data)) got(r.data);
        else if (r && /^SITCRAFT-PAIR:/i.test(r.data)) msg('That’s the pairing code. On your PC choose <b>Send AI keys to the iPad</b> instead.', '#f2b33d');
      }, 250);
    }, function () { msg('The camera wasn’t allowed. Allow the camera for SitCraft and try again.', '#f5a39b'); });
  }
  function open() {
    css(); close();
    sheet = document.createElement('div'); sheet.id = 'sc-ai'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Get your AI keys from your PC');
    sheet.innerHTML = '<div class="card"><h2>Get your AI keys from your PC</h2>' +
      '<ol><li>On your PC open <b>App settings → iPad</b>.</li><li>Turn on <b>Let the iPad use my AI keys</b> and choose <b>Send AI keys to the iPad</b>.</li><li>Point this iPad at the code it shows.</li></ol>' +
      '<video playsinline muted></video><div class="msg"></div>' +
      '<div class="s">Only a QR code works (no typed code), so only someone who can see your PC screen can copy your keys. They’re stored locked on this iPad and wiped if the PC switches this off, or on Remove / Pair again.</div>' +
      '<div class="row"><button data-a="again" style="display:none">Scan again</button><button data-a="close">Cancel</button></div></div>';
    document.body.appendChild(sheet);
    sheet.querySelector('[data-a=close]').onclick = close;
    sheet.querySelector('[data-a=again]').onclick = function () { this.style.display = 'none'; camera(); };
    camera();
  }

  // ---------- the calls (same requests as the PC's main.js) ----------
  var running = {}, deltaFn = null, phaseFn = null, modelMax = {};
  var EFFORT = /^claude-(fable|opus|sonnet)-5/;
  function extractJSON(text) {
    var t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(t); } catch (e) {}
    var i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) {} }
    return undefined;
  }
  function refuse(p) {
    var s = W.sync(); if (s && s.blocksWrites()) return { code: 'view_only', message: 'Viewing only — make this iPad primary to use AI here.' };
    var x = st(p);
    if (x === 'off' || x === 'none' || x === 'locked') return { code: 'no_key', message: 'AI keys aren’t on this iPad yet — App settings → AI → Get keys from PC.' };
    if (!navigator.onLine) return { code: 'unavailable', message: 'No internet — AI needs a connection.' };
    return null;
  }
  function creditMsg(m) { return /credit|billing|quota|balance|insufficient/i.test(m || ''); }
  function sse(r, id, on) {
    var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
    function pump() {
      return reader.read().then(function (x) {
        if (x.done) return;
        buf += dec.decode(x.value, { stream: true });
        var nl, stop = false;
        while ((nl = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (line.indexOf('data:') !== 0) continue;
          var ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
          if (on(ev) === false) { stop = true; break; }
        }
        if (stop) { try { reader.cancel(); } catch (e) {} return; }
        return pump();
      });
    }
    return pump();
  }
  function maxTokensFor(key, model) {
    if (modelMax[model]) return Promise.resolve(modelMax[model]);
    return fetch(API + '/models/' + encodeURIComponent(model), { headers: ch(key) }).then(function (r) { return r.ok ? r.json() : {}; }, function () { return {}; })
      .then(function (j) { var n = j.max_tokens || j.max_output_tokens || 0; if (!n) n = /haiku/.test(model) ? 32000 : 64000; modelMax[model] = Math.min(n, 64000); return modelMax[model]; });
  }
  function ch(key) { return { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' }; }
  function claudeJson(id, prompt, opts) {
    var no = refuse('claude'); if (no) return Promise.resolve({ error: no });
    var key = keys.claude, c = cfg(), model = c.model || 'claude-sonnet-5-5', ctl = new AbortController(); running[id] = ctl;
    var text = '', lastSent = 0, stopR = '', err = null;
    return Promise.resolve((opts && opts.maxTokens) || maxTokensFor(key, model)).then(function (mt) {
      var body = { model: model, max_tokens: mt, stream: true, system: 'You write for a sitcom writing app. Reply with exactly one valid JSON object and nothing else — no markdown fences, no commentary.', messages: [{ role: 'user', content: String(prompt) }] };
      if (EFFORT.test(model)) body.output_config = { effort: c.effort || 'medium' };
      return fetch(API + '/messages', { method: 'POST', headers: ch(key), body: JSON.stringify(body), signal: ctl.signal });
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { return (j.error && j.error.message) || ''; }, function () { return ''; }).then(function (m) {
        var code = r.status === 401 || r.status === 403 ? 'not_granted' : (r.status === 429 || r.status === 529 ? 'rate_limited' : (r.status === 404 ? 'bad_model' : 'api_error'));
        if (code === 'not_granted') setBad('claude', 'rejected'); else if (creditMsg(m)) setBad('claude', 'credit');
        return { error: { code: code, status: r.status, message: m } };
      });
      return sse(r, id, function (ev) {
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') text += ev.delta.text;
        else if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'thinking' && phaseFn) phaseFn(id, 'thinking');
        else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) stopR = ev.delta.stop_reason;
        else if (ev.type === 'error') { err = { code: ev.error && ev.error.type === 'overloaded_error' ? 'rate_limited' : 'api_error', message: ev.error && ev.error.message }; return false; }
        var now = Date.now(); if (now - lastSent > 250 && deltaFn) { lastSent = now; deltaFn(id, text); }
      }).then(function () {
        if (err) return { error: err };
        setBad('claude', null);
        if (stopR === 'refusal') return { error: { code: 'refused' } };
        var json = extractJSON(text);
        if (json === undefined) return { error: { code: stopR === 'max_tokens' ? 'too_long' : 'invalid_json' } };
        return { ok: true, json: json };
      });
    }).catch(function (e) {
      if (ctl.signal.aborted) return { error: { code: 'aborted' } };
      return { error: { code: 'unavailable', message: navigator.onLine ? String(e && e.message || e) : 'No internet — AI needs a connection.' } };
    }).then(function (r) { delete running[id]; return r; });
  }
  function oaOnce(id, key, body, ctl) {
    var text = '', lastSent = 0, status = '', reason = '', err = null;
    return fetch(OA + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { return (j.error && j.error.message) || ''; }, function () { return ''; }).then(function (m) {
        var code = r.status === 401 || r.status === 403 ? 'not_granted' : (r.status === 429 ? (creditMsg(m) ? 'no_credit' : 'rate_limited') : (r.status === 404 ? 'bad_model' : (r.status === 400 ? 'bad_request' : 'api_error')));
        if (code === 'not_granted') setBad('openai', 'rejected'); else if (code === 'no_credit') setBad('openai', 'credit');
        return { error: { code: code, status: r.status, message: m } };
      });
      return sse(r, id, function (ev) {
        if (ev.type === 'response.output_text.delta') text += ev.delta || '';
        else if (ev.type === 'response.output_item.added' && ev.item && ev.item.type === 'reasoning' && phaseFn) phaseFn(id, 'thinking');
        else if (ev.type === 'response.completed') status = 'completed';
        else if (ev.type === 'response.incomplete') { status = 'incomplete'; reason = (ev.response && ev.response.incomplete_details && ev.response.incomplete_details.reason) || ''; }
        else if (ev.type === 'response.failed') { err = { code: 'api_error', message: (ev.response && ev.response.error && ev.response.error.message) || '' }; return false; }
        else if (ev.type === 'error') { err = { code: 'api_error', message: ev.message || (ev.error && ev.error.message) || '' }; return false; }
        var now = Date.now(); if (now - lastSent > 250 && deltaFn) { lastSent = now; deltaFn(id, text); }
      }).then(function () { return err ? { error: err } : { text: text, status: status, reason: reason }; });
    });
  }
  function openaiJson(id, prompt) {
    var no = refuse('openai'); if (no) return Promise.resolve({ error: no });
    var c = cfg(), key = keys.openai, model = c.openaiModel || ((c.openaiModels || [])[0] || {}).id;
    if (!model) return Promise.resolve({ error: { code: 'bad_model' } });
    var ctl = new AbortController(); running[id] = ctl;
    var body = { model: model, input: String(prompt), stream: true, store: false, instructions: 'You punch up jokes for a sitcom writing app. Reply with exactly one valid JSON object and nothing else.', text: { format: { type: 'json_object' } }, max_output_tokens: /^gpt-4/.test(model) ? 16000 : 32000 };
    if (/^gpt-([5-9]|\d{2})/.test(model)) body.reasoning = { effort: 'medium' };
    return oaOnce(id, key, body, ctl).then(function (res) {
      if (res.error && res.error.code === 'bad_request') {
        var m = res.error.message || '';
        if (/reasoning/i.test(m)) delete body.reasoning;
        if (/max_output_tokens|maximum/i.test(m)) body.max_output_tokens = 8000;
        if (/text\.format|json_object|response_format/i.test(m)) delete body.text;
        return oaOnce(id, key, body, ctl).then(function (r2) { if (r2.error && r2.error.code === 'bad_request') r2.error.code = 'api_error'; return r2; });
      }
      return res;
    }).then(function (res) {
      if (res.error) return res;
      setBad('openai', null);
      var json = extractJSON(res.text);
      if (json === undefined) return { error: { code: res.status === 'incomplete' && /max_output/.test(res.reason) ? 'too_long' : (res.reason === 'content_filter' ? 'refused' : 'invalid_json') } };
      return { ok: true, json: json, model: model };
    }).catch(function (e) {
      if (ctl.signal.aborted) return { error: { code: 'aborted' } };
      return { error: { code: 'unavailable', message: navigator.onLine ? String(e && e.message || e) : 'No internet — AI needs a connection.' } };
    }).then(function (r) { delete running[id]; return r; });
  }

  // ---------- plug into the bridge ----------
  var hint = function (p) { var h = (ctl() && ctl().hints) || {}; return h[p] ? '••••' + h[p] : ''; };
  D.claude.status = function () { var x = st('claude'); return { hasKey: x !== 'off' && x !== 'none' && x !== 'locked', keyHint: hint('claude'), model: cfg().model || 'claude-sonnet-5-5', secure: true, ipad: x }; };
  D.claude.json = function (id, prompt, opts) { return claudeJson(id, prompt, opts); };
  D.claude.abort = function (id) { var c = running[id]; if (c) c.abort(); };
  D.claude.onDelta = function (f) { deltaFn = f; };
  D.claude.onPhase = function (f) { phaseFn = f; };
  D.claude.setModel = function () { return Promise.resolve({ ok: false, error: 'On the iPad, the models follow your PC.' }); };
  D.openai.status = function () { var x = st('openai'), c = cfg(); return { hasKey: x !== 'off' && x !== 'none' && x !== 'locked', keyHint: hint('openai'), model: c.openaiModel || '', models: c.openaiModels || [], provider: c.punchProvider || 'claude', ipad: x }; };
  D.openai.json = function (id, prompt) { return openaiJson(id, prompt); };
  D.openai.setModel = function () { return Promise.resolve({ ok: false, error: 'On the iPad, the models follow your PC.' }); };
  D.aiPad = { state: state, update: open, take: take, onChange: function (f) { listeners.push(f); return function () { var i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }; } };
  window.addEventListener('online', changed); window.addEventListener('offline', changed);
  D.sync.onEvent(function (ev, p) { if (ev === 'status') watch(p); });
  W.ready.then(load).then(function () { var s = W.sync(); if (s) watch(s.status()); changed(); });
})();
