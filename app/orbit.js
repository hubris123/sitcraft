// SitCraft's "working on it" spinner: three dots orbiting a tilted ring in 3D (bigger and brighter in front, smaller and
// dimmer behind). It slowly blends through six looks (glow → comet tails → ease in and out → brand gradient → faint ring →
// leader and followers, 2 s each, a 12 s cycle) while the whole ring sways a little on both axes. Each spinner starts at a
// random point in the cycle, so short waits don't always look the same.
// It replaces every old spinning circle automatically: any element with class "spin" (the screens) or "sc-spin" (the
// iPad's setup screen, bars and renderer/busy.js) gets the orbit drawn in it. The dot colour comes from the element's own
// border-top-color, so warning spinners stay amber; plain grey/white ones become SitCraft green.
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.SitOrbit) return;
  var TEAL = [46, 196, 176], PURPLE = [155, 128, 242];
  var CYCLE = 12, HOLD = 2, REV = 1.5;
  var hosts = [], raf = 0, seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  function rot(x, y, z, ax, ay, az) {
    var c = Math.cos(ax), s = Math.sin(ax), t;
    t = y * c - z * s; z = y * s + z * c; y = t;
    c = Math.cos(ay); s = Math.sin(ay); t = x * c + z * s; z = -x * s + z * c; x = t;
    c = Math.cos(az); s = Math.sin(az); t = x * c - y * s; y = x * s + y * c; x = t;
    return [x, y, z];
  }
  function proj(v) { var d = 1 / (1 - v[2] * 0.35); return { x: v[0] * d, y: v[1] * d, s: (0.62 + 0.38 * (v[2] + 1) / 2) * d, o: 0.3 + 0.7 * (v[2] + 1) / 2, z: v[2] }; }
  function lerp(a, b, f) { return a + (b - a) * f; }
  function wrapPi(a) { return ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; }
  function weights(sec) {
    var w = [0, 0, 0, 0, 0, 0], ph = (sec % CYCLE) / HOLD, i = Math.floor(ph), f = ph - i;
    var b = f < 0.7 ? 0 : (f - 0.7) / 0.3, sm = b * b * (3 - 2 * b);
    w[i % 6] += 1 - sm; w[(i + 1) % 6] += sm; return w;
  }
  function colourOf(el) {
    var raw = (el.style && el.style.borderTopColor) || '';
    if (!raw) return TEAL;
    var cv = colourOf.cv || (colourOf.cv = document.createElement('canvas').getContext('2d'));
    cv.fillStyle = '#000'; cv.fillStyle = raw; var c = cv.fillStyle, rgb;
    if (c[0] === '#') rgb = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    else { var m = c.match(/[\d.]+/g); rgb = m ? [+m[0], +m[1], +m[2]] : TEAL; }
    var mx = Math.max.apply(null, rgb), mn = Math.min.apply(null, rgb);
    return mx - mn < 40 ? TEAL : rgb;           // grey/white → SitCraft green; real colours (amber warnings, teal) kept
  }
  function draw(h, now) {
    var el = h.el, cv = h.cv, x = h.ctx;
    if (!h.S || now - (h.measured || 0) > 500) { var box = el.getBoundingClientRect(); h.S = Math.max(8, Math.min(box.width || 16, box.height || 16)); h.measured = now; }
    var S = h.S;
    var dpr = window.devicePixelRatio || 1, W = Math.round(S * 1.8);
    if (h.W !== W || h.dpr !== dpr) {
      h.W = W; h.dpr = dpr; cv.width = W * dpr; cv.height = W * dpr;
      cv.style.width = W + 'px'; cv.style.height = W + 'px'; cv.style.left = (S - W) / 2 + 'px'; cv.style.top = (S - W) / 2 + 'px';
    }
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, W);
    var sec = (now - h.t0) / 1000 + h.off, w = weights(sec), t = (sec / REV) % 1;
    var tiltX = 1.15 + 0.13 * Math.sin(sec / CYCLE * Math.PI * 2), tiltY = 0.22 * Math.cos(sec / CYCLE * Math.PI * 2);
    var ring = function (a) { return proj(rot(Math.cos(a) * 0.85, 0, Math.sin(a) * 0.85, tiltX, tiltY, 0.35)); };
    var cx = W / 2, cy = W / 2, unit = S * 0.45, r = S * 0.16, C = h.col, k;
    if (w[4] > 0.01) {
      x.strokeStyle = 'rgba(' + C + ',' + (0.22 * w[4]) + ')'; x.lineWidth = Math.max(0.75, r * 0.2); x.beginPath();
      for (k = 0; k <= 48; k++) { var q = ring(k / 48 * Math.PI * 2); if (k) x.lineTo(cx + q.x * unit, cy + q.y * unit); else x.moveTo(cx + q.x * unit, cy + q.y * unit); }
      x.stroke();
    }
    var pts = [];
    for (var i = 0; i < 3; i++) {
      var even = t * Math.PI * 2 + i * Math.PI * 2 / 3;
      var u = (t + i / 3) % 1, eased = (u - Math.sin(u * Math.PI * 2) / (Math.PI * 2) * 0.55) * Math.PI * 2;
      var lead = t * Math.PI * 2 - i * 0.55;
      var a = even + wrapPi(eased - even) * w[2] + wrapPi(lead - even) * w[5];
      var p = ring(a);
      p.s *= lerp(1, [1.15, 0.8, 0.55][i], w[5]); p.o *= lerp(1, [1, 0.75, 0.5][i], w[5]);
      var g = (Math.sin(a) + 1) / 2;
      p.c = [0, 1, 2].map(function (j) { return Math.round(lerp(C[j], lerp(PURPLE[j], C[j], g), w[3])); }).join(',');
      p.a = a; pts.push(p);
    }
    pts.sort(function (m, n) { return m.z - n.z; });
    pts.forEach(function (p) {
      if (w[1] > 0.01) for (var j = 6; j >= 1; j--) {
        var q = ring(p.a - j * 0.09);
        x.globalAlpha = Math.max(0, q.o * (1 - j / 7) * 0.6 * w[1]); x.fillStyle = 'rgb(' + p.c + ')';
        x.beginPath(); x.arc(cx + q.x * unit, cy + q.y * unit, r * q.s * (1 - j / 10), 0, 7); x.fill();
      }
      x.globalAlpha = Math.max(0, Math.min(1, p.o)); x.fillStyle = 'rgb(' + p.c + ')';
      if (w[0] > 0.01) {                      // glow: a soft halo behind the dot (cheap to draw, smooth on the iPad)
        var o = x.globalAlpha; x.globalAlpha = o * 0.28 * w[0]; x.beginPath(); x.arc(cx + p.x * unit, cy + p.y * unit, r * p.s * 2.1, 0, 7); x.fill();
        x.globalAlpha = o * 0.45 * w[0]; x.beginPath(); x.arc(cx + p.x * unit, cy + p.y * unit, r * p.s * 1.5, 0, 7); x.fill(); x.globalAlpha = o;
      }
      x.beginPath(); x.arc(cx + p.x * unit, cy + p.y * unit, r * p.s, 0, 7); x.fill();
    });
    x.globalAlpha = 1;
  }
  function loop(now) {
    raf = 0;
    for (var i = hosts.length - 1; i >= 0; i--) {
      var h = hosts[i];
      var still = h.el.classList && (h.el.classList.contains('spin') || h.el.classList.contains('sc-spin'));
      if (!h.el.isConnected || !still) {      // gone, or the screen reused this element for something else (e.g. a ✓)
        hosts.splice(i, 1); if (seen) seen.delete(h.el); if (h.cv.parentNode) h.cv.parentNode.removeChild(h.cv); continue;
      }
      if (!h.cv.isConnected || h.cv.parentNode !== h.el) h.el.appendChild(h.cv);   // a screen redraw dropped it: put it back
      if (!h.el.offsetWidth && !h.el.offsetHeight) continue;   // hidden: skip drawing
      draw(h, now);
    }
    if (hosts.length) raf = requestAnimationFrame(loop);
  }
  function attach(el) {
    if (seen ? seen.has(el) : el.__orbit) return;
    if (seen) seen.add(el); else el.__orbit = true;
    var cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true'); cv.className = 'sc-orbit';
    el.appendChild(cv);
    hosts.push({ el: el, cv: cv, ctx: cv.getContext('2d'), col: colourOf(el), t0: performance.now(), off: Math.random() * CYCLE, W: 0, dpr: 0 });
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.classList && (node.classList.contains('spin') || node.classList.contains('sc-spin'))) attach(node);
    if (node.querySelectorAll) { var l = node.querySelectorAll('.spin, .sc-spin'); for (var i = 0; i < l.length; i++) attach(l[i]); }
  }
  function css() {
    if (document.getElementById('sc-orbit-css')) return;
    var s = document.createElement('style'); s.id = 'sc-orbit-css';
    s.textContent = '.spin,.sc-spin{position:relative;animation:none!important;border-color:transparent!important;background:transparent!important;overflow:visible!important}' +
      '.sc-orbit{position:absolute;pointer-events:none;display:block}';
    (document.head || document.documentElement).appendChild(s);
  }
  function start() {
    css(); scan(document.body);
    new MutationObserver(function (ms) { ms.forEach(function (m) { if (m.type === 'attributes') scan(m.target); else for (var i = 0; i < m.addedNodes.length; i++) scan(m.addedNodes[i]); }); })
      .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  window.SitOrbit = { attach: attach, weights: weights, CYCLE: CYCLE };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
