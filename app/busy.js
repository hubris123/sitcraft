// "Working on it" for every slow button, everywhere in SitCraft (PC and iPad).
// Everything slow (Google Drive, AI, sync, backups, printing, the delete lock…) goes through window.sitcomDesktop. This wraps
// it: when a button press starts one of those calls and it's still running after a moment, that button is greyed out with
// a green spinning circle over it, and further presses on it are ignored until the call finishes.
// Used by preload.js (PC, before the bridge is handed to the page) and web/bridge.js (iPad).
(function (root) {
  'use strict';
  var SHOW_AFTER = 250;                         // quick calls never flash a spinner
  var SKIP = /^(on[A-Z]|abort$|status$|getItem$|setItem$|removeItem$|paths$)/;

  function install(api, win) {
    win = win || (typeof window !== 'undefined' ? window : null);
    if (!win || !win.document) return api;
    var doc = win.document;
    var clicked = null, clickedAt = 0;          // the button the person just pressed
    var busy = [];                              // { el, n, at, ov }
    var raf = 0;

    function pressable(t) {
      var el = t && t.closest ? t.closest('button, [role="button"], [role="switch"], [role="menuitem"], [role="tab"], a[href], label') : null;
      return el;
    }
    function find(el) { for (var i = 0; i < busy.length; i++) if (busy[i].el === el) return busy[i]; return null; }
    function isBusy(el) { for (var i = 0; i < busy.length; i++) if (busy[i].ov && busy[i].ov.style.display !== 'none' && (busy[i].el === el || busy[i].el.contains(el))) return true; return false; }

    // remember what was pressed; swallow presses on a button that's still working
    doc.addEventListener('click', function (e) {
      var el = pressable(e.target);
      if (el && isBusy(el)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); return; }
      clicked = el; clickedAt = Date.now();
      setTimeout(function () { if (Date.now() - clickedAt >= 40) clicked = null; }, 60);
    }, true);
    ['pointerdown', 'mousedown', 'touchstart', 'keydown'].forEach(function (ev) {
      doc.addEventListener(ev, function (e) {
        if (ev === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        var el = pressable(e.target); if (el && isBusy(el)) { e.preventDefault(); e.stopPropagation(); }
      }, true);
    });

    function style() {
      if (doc.getElementById('sc-busy-css')) return;
      var s = doc.createElement('style'); s.id = 'sc-busy-css';
      s.textContent = '@keyframes scBusySpin{to{transform:rotate(360deg)}}' +
        '.sc-busy-ov{position:fixed;z-index:2147483000;pointer-events:none;display:grid;place-items:center;background:rgba(15,16,19,.6);box-sizing:border-box}' +
        '.sc-busy-ov i{display:block;border-radius:50%;border:2px solid rgba(46,196,176,.28);border-top-color:#2ec4b0;animation:scBusySpin .8s linear infinite}';
      (doc.head || doc.documentElement).appendChild(s);
    }
    // keep each spinner sitting exactly on its button (things scroll and move); hide it if the button is covered or gone
    function frame() {
      raf = 0;
      var now = Date.now();
      for (var i = busy.length - 1; i >= 0; i--) {
        var b = busy[i];
        if (!b.el.isConnected) { if (b.ov) b.ov.remove(); busy.splice(i, 1); continue; }
        if (now - b.at < SHOW_AFTER) continue;
        if (!b.ov) {
          if (b.el.querySelector && b.el.querySelector('.spin')) continue;   // the screen already shows its own spinner there
          style(); b.ov = doc.createElement('div'); b.ov.className = 'sc-busy-ov'; b.ov.setAttribute('aria-hidden', 'true');
          b.ov.appendChild(doc.createElement('i')); doc.body.appendChild(b.ov);
          b.el.setAttribute('aria-busy', 'true');
        }
        var r = b.el.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var hit = r.width && r.height ? doc.elementFromPoint(Math.min(Math.max(cx, 0), win.innerWidth - 1), Math.min(Math.max(cy, 0), win.innerHeight - 1)) : null;
        var shown = !!(hit && (hit === b.el || b.el.contains(hit)));
        if (!shown) { b.ov.style.display = 'none'; continue; }
        var cs = win.getComputedStyle(b.el), sz = Math.max(12, Math.min(20, r.height - 10));
        b.ov.style.display = 'grid';
        b.ov.style.left = r.left + 'px'; b.ov.style.top = r.top + 'px'; b.ov.style.width = r.width + 'px'; b.ov.style.height = r.height + 'px';
        b.ov.style.borderRadius = cs.borderRadius;
        var sp = b.ov.firstChild; sp.style.width = sz + 'px'; sp.style.height = sz + 'px';
      }
      if (busy.length) raf = win.requestAnimationFrame(frame);
    }
    function start(el) {
      var b = find(el);
      if (b) { b.n++; return b; }
      b = { el: el, n: 1, at: Date.now(), ov: null }; busy.push(b);
      if (!raf) raf = win.requestAnimationFrame(frame);
      return b;
    }
    function end(b) {
      if (--b.n > 0) return;
      var i = busy.indexOf(b); if (i >= 0) busy.splice(i, 1);
      if (b.ov) b.ov.remove();
      if (b.el.removeAttribute) b.el.removeAttribute('aria-busy');
    }

    function wrapFn(f, owner) {
      return function () {
        var res = f.apply(owner, arguments);
        var el = clicked && Date.now() - clickedAt < 1500 ? clicked : null;
        if (el && res && typeof res.then === 'function') {
          var b = start(el);
          res.then(function () { end(b); }, function () { end(b); });
        }
        return res;
      };
    }
    function wrap(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 2) return obj;
      var out = {};
      Object.keys(obj).forEach(function (k) {
        var v = obj[k];
        if (typeof v === 'function') out[k] = SKIP.test(k) ? v : wrapFn(v, obj);
        else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = wrap(v, depth + 1);
        else out[k] = v;
      });
      return out;
    }
    return wrap(api, 0);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = install;
  else root.SitBusy = install;
})(typeof window !== 'undefined' ? window : this);
