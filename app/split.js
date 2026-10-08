// Drag handles for the side columns (Script, Show bible, Timeline, Outline, Storyboard — not the Dashboard sidebar).
// A screen marks its column like this (the handle sits inside the column, on the edge next to the main area):
//   <aside style="flex: 0 0 clamp(220px, var(--split-script, 340px), calc(100% - 420px)); position: relative; …">
//     <div class="sc-split" data-split="script" data-def="340" data-def-ipad="300" data-min="220" data-max="640"
//          data-keep="420" data-side="left" style="right: -24px"><i></i></div> …
// data-side: "left" = the column is on the left, the handle on its right edge (drag right = wider); "right" = the opposite.
// Dragging sets the CSS variable --split-<name> on the page, so the screens never have to re-render. The width is saved per
// device (PC and iPad separately, like the script zoom). Double-click / double-tap resets it; arrow keys nudge it.
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.SitSplit) return;
  var root = document.documentElement, ready = {};
  function store() { var D = window.sitcomDesktop; if (D && D.store) return D.store; try { return window.localStorage; } catch (e) { return null; } }
  function isPad() { return !!(window.sitcomDesktop && window.sitcomDesktop.isIPad); }
  function num(h, k, d) { var v = parseFloat(h.getAttribute('data-' + k)); return isNaN(v) ? d : v; }
  function def(h) { return isPad() && h.hasAttribute('data-def-ipad') ? num(h, 'def-ipad', 300) : num(h, 'def', 300); }
  function key(name) { return 'sitcraft.split.' + name; }
  function setVar(name, w) { root.style.setProperty('--split-' + name, Math.round(w) + 'px'); }
  function limits(h) {
    var col = h.parentElement, box = col && col.parentElement, mn = num(h, 'min', 200), mx = num(h, 'max', 600);
    if (box) { var cs = getComputedStyle(box), inner = box.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0); mx = Math.min(mx, inner - num(h, 'keep', 420)); }
    return [mn, Math.max(mn, mx)];
  }
  function clamp(h, w) { var l = limits(h); return Math.min(l[1], Math.max(l[0], w)); }
  function save(name, w) { var s = store(); try { if (s) { if (w == null) s.removeItem(key(name)); else s.setItem(key(name), String(Math.round(w))); } } catch (e) {} }
  function init(h) {
    var name = h.getAttribute('data-split'); if (!name) return;
    if (!h.__split) {
      h.__split = true;
      h.setAttribute('role', 'separator'); h.setAttribute('aria-orientation', 'vertical'); h.tabIndex = 0;
      if (!h.getAttribute('aria-label')) h.setAttribute('aria-label', 'Drag to resize the side column (double-click to reset)');
      if (!h.querySelector('i')) h.appendChild(document.createElement('i'));
    }
    if (ready[name]) return;
    ready[name] = true;
    var saved = null, s = store(); try { saved = s ? parseFloat(s.getItem(key(name))) : null; } catch (e) {}
    setVar(name, saved > 0 ? saved : def(h));
  }
  function scan(n) {
    if (!n || n.nodeType !== 1) return;
    if (n.classList && n.classList.contains('sc-split')) init(n);
    if (n.querySelectorAll) { var l = n.querySelectorAll('.sc-split'); for (var i = 0; i < l.length; i++) init(l[i]); }
  }
  // dragging (mouse, finger or pen)
  var drag = null, lastTap = { t: 0, h: null };
  document.addEventListener('pointerdown', function (e) {
    var h = e.target && e.target.closest ? e.target.closest('.sc-split') : null; if (!h) return;
    init(h); e.preventDefault();
    var col = h.parentElement;
    drag = { h: h, name: h.getAttribute('data-split'), x0: e.clientX, w0: col.getBoundingClientRect().width, dir: h.getAttribute('data-side') === 'right' ? -1 : 1, moved: false, id: e.pointerId };
    try { h.setPointerCapture(e.pointerId); } catch (err) {}
    h.classList.add('sc-split-on'); document.body.classList.add('sc-splitting');
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0; if (Math.abs(dx) > 3) drag.moved = true;
    if (drag.moved) { setVar(drag.name, clamp(drag.h, drag.w0 + dx * drag.dir)); e.preventDefault(); }
  }, true);
  function end(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag; drag = null;
    d.h.classList.remove('sc-split-on'); document.body.classList.remove('sc-splitting');
    if (d.moved) { save(d.name, d.h.parentElement.getBoundingClientRect().width); return; }
    var now = Date.now();                                  // a double tap (iPad) or double click (PC) puts it back
    if (lastTap.h === d.h && now - lastTap.t < 400) { reset(d.h); lastTap = { t: 0, h: null }; } else lastTap = { t: now, h: d.h };
  }
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
  function reset(h) { var name = h.getAttribute('data-split'); setVar(name, def(h)); save(name, null); }
  document.addEventListener('keydown', function (e) {
    var h = document.activeElement; if (!h || !h.classList || !h.classList.contains('sc-split')) return;
    var dir = h.getAttribute('data-side') === 'right' ? -1 : 1, step = e.shiftKey ? 48 : 16, name = h.getAttribute('data-split');
    var w = h.parentElement.getBoundingClientRect().width;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { w = clamp(h, w + (e.key === 'ArrowRight' ? step : -step) * dir); setVar(name, w); save(name, w); e.preventDefault(); }
    else if (e.key === 'Home' || e.key === 'Enter') { reset(h); e.preventDefault(); }
  }, true);
  function css() {
    if (document.getElementById('sc-split-css')) return;
    var s = document.createElement('style'); s.id = 'sc-split-css';
    s.textContent =
      '.sc-split{position:absolute;top:0;bottom:0;width:20px;min-height:120px;cursor:col-resize;touch-action:none;z-index:6;outline:none}' +
      '.sc-split::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:1px;background:#2a2e36;transition:background .15s}' +
      '.sc-split i{position:absolute;left:50%;top:50%;margin:-19px 0 0 -2.5px;display:block;width:5px;height:38px;border-radius:9px;background:#4a4f59;transition:background .15s,box-shadow .15s}' +
      '.sc-split:hover i,.sc-split:focus-visible i{background:#6f737b}' +
      '.sc-split.sc-split-on::before{background:#2ec4b0}.sc-split.sc-split-on i{background:#2ec4b0;box-shadow:0 0 0 4px rgba(46,196,176,.18),0 0 12px rgba(46,196,176,.35)}' +
      '@media (pointer: coarse){.sc-split{width:32px}}' +
      'body.sc-splitting,body.sc-splitting *{cursor:col-resize!important;user-select:none!important;-webkit-user-select:none!important}';
    (document.head || root).appendChild(s);
  }
  // keep the grip in the middle of the part of the column you can see (tall columns run past the bottom of the screen)
  var placeQ = 0;
  function place() {
    placeQ = 0;
    var l = document.querySelectorAll('.sc-split'), vh = window.innerHeight;
    for (var i = 0; i < l.length; i++) {
      var h = l[i], g = h.querySelector('i'); if (!g) continue;
      var r = h.getBoundingClientRect(); if (!r.height) continue;
      var top = Math.max(r.top, 0), bot = Math.min(r.bottom, vh), y = bot > top ? (top + bot) / 2 - r.top : r.height / 2;
      y = Math.max(24, Math.min(r.height - 24, y));
      g.style.top = Math.round(y) + 'px';
    }
  }
  function placeSoon() { if (!placeQ) placeQ = requestAnimationFrame(place); }
  window.addEventListener('scroll', placeSoon, true); window.addEventListener('resize', placeSoon);
  function start() {
    css(); scan(document.body); placeSoon();
    new MutationObserver(function (ms) { ms.forEach(function (m) { for (var i = 0; i < m.addedNodes.length; i++) scan(m.addedNodes[i]); }); })
      .observe(root, { childList: true, subtree: true });
    new MutationObserver(placeSoon).observe(root, { childList: true, subtree: true });
  }
  window.SitSplit = { reset: reset };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
