// One scene list for the Outline, the Timeline (and later the Script).
// The timeline (data.timelines[key]) is the list. The structure draft marked "in use" (data.built[key]) mirrors it, so an
// edit in either place shows in the other straight away. Other drafts stay as they are (alternatives).
// Plots: 'A' 'B' 'C', 'X' = all plots, 'U' = no plot yet (unassigned).
(function (root) {
  'use strict';
  var PLOTS = ['A', 'B', 'C', 'X', 'U'];
  var cleanPlot = function (p) { p = String(p || '').toUpperCase(); if (p === 'ALL') p = 'X'; return PLOTS.indexOf(p) >= 0 ? p : 'U'; };
  var splitChars = function (s) { return Array.isArray(s) ? s.map(String) : String(s || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; }); };

  function structs(d, k) { return ((d.structures || {})[k]) || []; }
  function inUse(d, k) {
    var id = (d.built || {})[k]; if (!id) return null;
    return structs(d, k).filter(function (x) { return x.id === id; })[0] || null;
  }
  function timeline(d, k) { return ((d.timelines || {})[k]) || null; }

  // structure scene → timeline scene
  function fromStruct(sv, x, i) {
    return { id: x.tid || ('sv' + sv.id + '_' + i), plot: cleanPlot(x.plot || 'X'), act: Math.max(0, Math.min(4, parseInt(x.act, 10) || 0)),
      dur: Math.max(0.2, Math.round((parseFloat(x.minutes) || 1) * 20) / 20), title: x.title || 'Scene', summary: x.summary || '', beat: x.beat || '',
      chars: splitChars(x.characters).join(', '), location: x.location || '', purpose: (x.purpose || []).slice() };
  }
  // timeline scene → structure scene (keeps anything else the draft had for that scene)
  function toStruct(t, old) {
    return Object.assign({}, old || {}, { tid: t.id, act: t.act, plot: t.plot, title: t.title || 'Scene', summary: t.summary || '', beat: t.beat || '',
      purpose: (t.purpose || (old && old.purpose) || []).slice(), characters: splitChars(t.chars), location: t.location || '', minutes: t.dur });
  }

  // Copy the timeline into the in-use draft (call after any timeline change)
  function mirror(d, k) {
    var sv = inUse(d, k), tl = timeline(d, k); if (!sv || !tl) return false;
    sv.data = sv.data || {};
    var old = sv.data.scenes || [], byTid = {}, byTitle = {};
    old.forEach(function (x, i) { if (x.tid) byTid[x.tid] = x; byTitle[String(x.title || '').toLowerCase()] = x; });
    sv.data.scenes = tl.map(function (t, i) { return toStruct(t, byTid[t.id] || (!old[i] || old[i].tid ? byTitle[String(t.title || '').toLowerCase()] : old[i])); });
    var names = ((d.timelineMeta || {})[k] || {}).plots || {};
    (sv.data.plots || []).forEach(function (p) { if (names[p.key] && !p.name) p.name = names[p.key]; });
    return true;
  }
  function bump(d, k) { d.timelineRev = d.timelineRev || {}; d.timelineRev[k] = (d.timelineRev[k] || 0) + 1; }

  // Change one scene (patch in timeline shape) — by: 'outline' | 'timeline' | 'script' (shown as "changed on the …")
  function patch(d, k, id, p, by) {
    var tl = timeline(d, k); if (!tl) return false; ensure(d, k);
    var hit = false;
    d.timelines[k] = tl.map(function (t) {
      if (t.id !== id) return t; hit = true;
      var n = Object.assign({}, t, p); if ('plot' in p) n.plot = cleanPlot(p.plot);
      if (by) n.chg = { by: by, at: Date.now() };
      return n;
    });
    if (!hit) return false;
    mirror(d, k); toScript(d, k); bump(d, k); return true;
  }
  // Many plots at once (Assign plots): map of id → plot
  function setPlots(d, k, map, by) {
    var tl = timeline(d, k); if (!tl) return 0; var n = 0; ensure(d, k);
    d.timelines[k] = tl.map(function (t) { if (!(t.id in map)) return t; n++; return Object.assign({}, t, { plot: cleanPlot(map[t.id]), chg: { by: by || 'assign', at: Date.now() } }); });
    mirror(d, k); toScript(d, k); bump(d, k); return n;
  }

  // Make a draft the timeline's scene list. The draft that was in use keeps the scenes as they are now (nothing is lost).
  function use(d, k, svId) {
    var list = structs(d, k), sv = list.filter(function (x) { return x.id === svId; })[0]; if (!sv) return false;
    mirror(d, k);
    var tl = ((sv.data || {}).scenes || []).map(function (x, i) { return fromStruct(sv, x, i); });
    var plots = {}; ((sv.data || {}).plots || []).forEach(function (p) { if (p.key && p.name) plots[p.key] = p.name; });
    d.timelines = d.timelines || {}; d.timelines[k] = tl;
    d.timelineMeta = d.timelineMeta || {}; d.timelineMeta[k] = { plots: plots, from: sv.id };
    d.built = d.built || {}; d.built[k] = sv.id;
    mirror(d, k); bump(d, k);
    return true;
  }
  // A timeline that isn't linked to any draft (made by hand or from a script) → save it as a new draft and link it
  function adopt(d, k, title) {
    var tl = timeline(d, k); if (!tl || inUse(d, k)) return null;
    d.structures = d.structures || {}; var list = d.structures[k] = d.structures[k] || [];
    var names = ((d.timelineMeta || {})[k] || {}).plots || {};
    var sv = { id: 'st' + Date.now(), n: list.length + 1, at: new Date().toLocaleString(), model: 'Saved from the timeline', prompt: '',
      data: { title: title || 'Untitled', logline: '', point: '', theme: '', ending: '', plots: ['A', 'B', 'C'].filter(function (p) { return names[p]; }).map(function (p) { return { key: p, name: names[p], characters: [], want: '', goal: '', obstacle: '', result: '' }; }), scenes: [] } };
    list.push(sv);
    d.built = d.built || {}; d.built[k] = sv.id;
    mirror(d, k);
    return sv;
  }

  // ---------- Assign plots ----------
  // "Leslie Knope" / "LESLIE" → "leslie"; "The Douche" → "the douche"
  var nameKey = function (s) { var w = String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9' ]/g, ' ').trim().split(/\s+/); return (/^(the|dr|mr|mrs|ms|miss|officer|crazy)$/.test(w[0]) && w[1] ? w[0] + ' ' + w[1] : w[0]) || ''; };
  var nice = function (n) { return n.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); };
  // Free: by who's in each scene. Each plot's people = its listed characters + who's in the scenes already on it.
  function suggestByCast(d, k, scope) {
    var tl = timeline(d, k) || [], sv = inUse(d, k);
    var who = { A: {}, B: {}, C: {} };
    ((sv && sv.data && sv.data.plots) || []).forEach(function (p) { if (who[p.key]) (p.characters || []).forEach(function (c) { var n = nameKey(c); if (n) who[p.key][n] = (who[p.key][n] || 0) + 3; }); });
    tl.forEach(function (t) { if (!who[t.plot]) return; splitChars(t.chars).forEach(function (c) { var n = nameKey(c); if (n) who[t.plot][n] = (who[t.plot][n] || 0) + 1; }); });
    var tot = {}; ['A', 'B', 'C'].forEach(function (p) { tot[p] = Object.keys(who[p]).reduce(function (a, n) { return a + who[p][n]; }, 0) || 1; });
    return tl.filter(function (t) { return scope === 'all' ? true : t.plot === 'U'; }).map(function (t) {
      var names = splitChars(t.chars).map(nameKey).filter(function (n) { return n; });
      var best = null, bestS = 0, hits = [];
      ['A', 'B', 'C'].forEach(function (p) {
        var s = names.reduce(function (a, n) { return a + (who[p][n] ? who[p][n] / tot[p] : 0); }, 0);
        if (s > bestS) { bestS = s; best = p; }
      });
      if (best) names.forEach(function (n) { if (who[best][n] && hits.indexOf(nice(n)) < 0) hits.push(nice(n)); });
      return { id: t.id, title: t.title, now: t.plot, plot: best || t.plot, why: best ? (hits.join(', ') + ' → ' + best) : (names.length ? 'No plot has these people yet' : 'Nobody listed in this scene') };
    });
  }
  function claudePrompt(d, k, scope, ep) {
    var tl = timeline(d, k) || [], sv = inUse(d, k), names = ((d.timelineMeta || {})[k] || {}).plots || {};
    var plots = ((sv && sv.data && sv.data.plots) || []);
    var L = ['You sort the scenes of a sitcom episode into its storylines. Read each scene and say which plot it belongs to.', ''];
    L.push('Episode: ' + ((ep && ep.code) || '') + ' “' + ((ep && ep.title) || '') + '”');
    L.push('Plots:');
    ['A', 'B', 'C'].forEach(function (p) {
      var x = plots.filter(function (q) { return q.key === p; })[0] || {};
      L.push(p + ' — ' + (x.name || names[p] || (p === 'A' ? 'main story' : p === 'B' ? 'second story' : 'runner')) + (x.characters && x.characters.length ? ' (people: ' + x.characters.join(', ') + ')' : '') + (x.want ? '; wants ' + x.want : ''));
    });
    L.push('X — the whole cast / every plot (cold opens, tags, group scenes that serve all plots)');
    L.push('', 'Scenes:');
    tl.forEach(function (t, i) { if (scope === 'all' || t.plot === 'U') L.push('#' + (i + 1) + ' ' + (t.title || '') + ' — ' + (t.summary || '') + (t.chars ? ' [in it: ' + t.chars + ']' : '') + (t.plot !== 'U' ? ' (now ' + t.plot + ')' : '')); });
    L.push('', 'Reply with ONLY one JSON object: {"scenes": [{"n": scene number, "plot": "A"|"B"|"C"|"X", "why": a few words}]}');
    return L.join('\n');
  }
  function readClaude(d, k, data) {
    var tl = timeline(d, k) || [], out = {};
    ((data && data.scenes) || []).forEach(function (x) { var t = tl[(parseInt(x.n, 10) || 0) - 1]; var p = cleanPlot(x.plot); if (t && p !== 'U') out[t.id] = { plot: p, why: String(x.why || '').slice(0, 80) }; });
    return out;
  }

  // ================= The script =================
  // Shared both ways for each written scene: which scenes exist and their order, act, plot, location (the heading), who
  // speaks (added to the scene's cast) and length (from the page count). Script lines and the outline's summary/purpose
  // are not copied. Each heading carries tid (its timeline scene) and lk (what both sides looked like at the last sync, so
  // we know which side changed). The script is linked while scripts[key].from is the structure in use.
  var ACTN = { 'COLD OPEN': 0, 'TEASER': 0, 'ACT ONE': 1, 'ACT 1': 1, 'ACT I': 1, 'ACT TWO': 2, 'ACT 2': 2, 'ACT II': 2, 'ACT THREE': 3, 'ACT 3': 3, 'ACT III': 3, 'TAG': 4 };
  var ACTNAME = ['COLD OPEN', 'ACT ONE', 'ACT TWO', 'ACT THREE', 'TAG'];
  var CPL = { heading: 60, action: 60, character: 38, paren: 20, dialogue: 35, transition: 60, act: 60 };
  function wrapRows(txt, cpl) {
    var total = 0;
    String(txt || '').split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(function (w) { return w; }), line = 0, n = 1;
      words.forEach(function (w) { while (w.length > cpl) { if (line) { n++; line = 0; } w = w.slice(cpl); n++; } if (!line) line = w.length; else if (line + 1 + w.length <= cpl) line += 1 + w.length; else { n++; line = w.length; } });
      total += n;
    });
    return Math.max(1, total);
  }
  var PRE = /^(INT\.\/EXT\.|INT\/EXT\.?|I\/E\.?|INT\.|EXT\.)\s*/i;
  function parseHeading(t) {
    t = String(t || '').trim(); var m = t.match(PRE), pre = m ? m[1].toUpperCase() : '', rest = m ? t.slice(m[0].length) : t;
    var parts = rest.split(/\s+[-–—]\s+/); return { pre: pre, loc: (parts.shift() || '').trim(), time: parts.join(' - ') };
  }
  var titleCase = function (s) { return String(s || '').toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); };
  var same = function (a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); };
  function cueName(t) { return String(t || '').trim().toUpperCase().replace(/\s*\(.*\)\s*$/, '').replace(/\s+CONT['’]D$/, '').trim(); }

  function script(d, k) { return ((d.scripts || {})[k]) || null; }
  function scriptLinked(d, k) { var sc = script(d, k), sv = inUse(d, k); return !!(sc && sv && sc.from === sv.id && timeline(d, k)); }
  // The script as acts and scene blocks
  function parse(els) {
    var out = { head: [], acts: {}, blocks: [], order: [] }, act = 0, cur = null, seenAct = false;
    els.forEach(function (e, i) {
      if (e.type === 'act') {
        var key = String(e.text || '').trim().toUpperCase();
        if (ACTN[key] !== undefined) { act = ACTN[key]; seenAct = true; out.acts[act] = out.acts[act] || { open: null, lead: [], close: null }; out.acts[act].open = e; cur = null; out.order.push({ act: act }); return; }
        if (/^END OF/.test(key)) { var a2 = out.acts[act] = out.acts[act] || { open: null, lead: [], close: null }; a2.close = e; cur = null; return; }
      }
      if (e.type === 'heading') { cur = { h: e, els: [e], act: seenAct ? act : (parseInt(e.act, 10) || 0), i: out.blocks.length }; out.blocks.push(cur); return; }
      if (cur) cur.els.push(e);
      else if (seenAct) { out.acts[act] = out.acts[act] || { open: null, lead: [], close: null }; out.acts[act].lead.push(e); }
      else out.head.push(e);
    });
    return out;
  }
  // How fast a page plays: multi-camera ≈ 2 pages a minute; single-camera ≈ 1 a minute, faster for rapid-fire shows
  function pace(ep) { ep = ep || {}; var multi = ep.format === 'multi', p = ep.pacing || ((ep.jpm || 6) >= 6.5 ? 'rapid' : ((ep.jpm || 6) < 5 ? 'slow' : 'classic'));
    return { multi: multi, ppm: multi ? 2 : (p === 'rapid' ? 1.5 : (p === 'slow' ? 1 : 1.2)) }; }
  function asPace(x) { return (x && typeof x === 'object') ? x : { multi: !!x, ppm: x ? 2 : 1 }; }
  function blockInfo(b, pc) {
    pc = asPace(pc); var multi = pc.multi;
    var lines = 0, who = [], prev = null;
    b.els.forEach(function (e, i) {
      var lh = (multi && (e.type === 'dialogue' || e.type === 'paren')) ? 2 : 1, mt = (e.type === 'dialogue' || e.type === 'paren') ? 0 : 1;
      lines += wrapRows(e.text, CPL[e.type] || 60) * lh + (i ? mt : 2);
      if (e.type === 'character') { var n = cueName(e.text); if (n && who.indexOf(n) < 0) who.push(n); }
    });
    var pages = Math.round(lines / 55 * 10) / 10;
    return { pages: pages, minutes: Math.max(0.1, Math.round(pages / pc.ppm * 20) / 20), who: who };
  }
  // speaking cue "LESLIE" → "Leslie Knope" when the scene (or the cast) already has that person
  function addSpeakers(chars, who, known) {
    var list = splitChars(chars), keys = list.map(function (c) { return c.toLowerCase().split(/\s+/)[0]; });
    who.forEach(function (n) { var f = n.toLowerCase().split(/\s+/)[0]; if (keys.indexOf(f) < 0 && list.map(function (c) { return c.toLowerCase(); }).indexOf(n.toLowerCase()) < 0) { list.push((known && known[n.toLowerCase()]) || (n.indexOf(' ') < 0 && known && known[f]) || titleCase(n)); keys.push(f); } });
    return list.join(', ');
  }
  // First link: pair headings with timeline scenes (same id, else same place/title in order)
  function pair(d, k) {
    var sc = script(d, k), tl = timeline(d, k) || [], P = parse(sc.els), byId = {}, used = {};
    tl.forEach(function (t) { byId[t.id] = t; });
    P.blocks.forEach(function (b) { if (b.h.tid && byId[b.h.tid] && !used[b.h.tid]) used[b.h.tid] = 1; else delete b.h.tid; });
    var j = 0;
    if (P.blocks.length === tl.length && P.blocks.every(function (b) { return !b.h.tid; })) P.blocks.forEach(function (b, i) { b.h.tid = tl[i].id; used[tl[i].id] = 1; });
    else P.blocks.forEach(function (b) {
      if (b.h.tid) { j = Math.max(j, tl.indexOf(byId[b.h.tid]) + 1); return; }
      var hp = parseHeading(b.h.text);
      for (var q = j; q < Math.min(tl.length, j + 4); q++) { var t = tl[q]; if (used[t.id]) continue; if (same(t.location, hp.loc) || same(t.title, hp.loc) || same(t.title, b.h.text)) { b.h.tid = t.id; used[t.id] = 1; j = q + 1; return; } }
    });
    P.blocks.forEach(function (b) { var t = b.h.tid && byId[b.h.tid]; if (t) b.h.lk = { loc: parseHeading(b.h.text).loc, tloc: t.location || '', plot: cleanPlot(b.h.plot || t.plot), tplot: t.plot, sum: t.summary || '' }; });
    sc.linked = true;
  }

  // Pair the script with the timeline once, before anything changes (so we know what both looked like)
  function ensure(d, k) { var sc = script(d, k); if (sc && !sc.linked && scriptLinked(d, k)) pair(d, k); }
  // Script → timeline (after editing the script). Returns true when the timeline changed.
  function fromScript(d, k, multi) {
    if (!scriptLinked(d, k)) return false;
    var sc = script(d, k); if (!sc.linked) pair(d, k);
    var tl = timeline(d, k).slice(), byId = {}, P = parse(sc.els), changed = false, now = Date.now();
    tl.forEach(function (t, i) { byId[t.id] = { t: t, i: i }; });
    var inScript = {}, newOnes = [], known = {};
    tl.forEach(function (t) { splitChars(t.chars).forEach(function (c) { var lc = c.toLowerCase(); known[lc] = c; var f = lc.split(/\s+/)[0]; if (!known[f] || known[f].length < c.length) known[f] = c; }); });
    P.blocks.forEach(function (b, bi) {
      var h = b.h, info = blockInfo(b, multi), hp = parseHeading(h.text), hpl = cleanPlot(h.plot || 'U');
      var rec = h.tid && byId[h.tid];
      if (!rec) {   // a scene added in the script
        var id = h.tid || ('s' + String(h.id || now + bi).replace(/\W/g, ''));
        var first = b.els.filter(function (e) { return e.type === 'action'; })[0];
        var t0 = { id: id, plot: (b.act === 0 || b.act === 4) ? 'X' : 'U', act: b.act, dur: info.minutes, title: titleCase(hp.loc || 'New scene').slice(0, 40), summary: first ? String(first.text || '').slice(0, 200) : '', beat: '', chars: addSpeakers('', info.who, known), location: titleCase(hp.loc), purpose: [], w: true, pages: info.pages, chg: { by: 'script', at: now } };
        h.tid = id; h.lk = { loc: hp.loc, tloc: t0.location, plot: hpl, tplot: t0.plot, sum: t0.summary };
        if (hpl !== t0.plot) { h.plot = t0.plot; h.lk.plot = t0.plot; }
        newOnes.push({ t: t0, after: bi ? P.blocks[bi - 1].h.tid : null }); inScript[id] = 1; changed = true; return;
      }
      inScript[h.tid] = 1;
      var t = rec.t, n = Object.assign({}, t), lk = h.lk || (h.lk = { loc: hp.loc, tloc: t.location || '', plot: hpl, tplot: t.plot, sum: t.summary || '' }), mark = false;
      if (hp.loc !== lk.loc) { n.location = titleCase(hp.loc); lk.loc = hp.loc; lk.tloc = n.location; mark = true; }
      if (hpl !== lk.plot && hpl !== t.plot) { n.plot = hpl; lk.plot = hpl; lk.tplot = hpl; mark = true; }
      if (b.act !== t.act) { n.act = b.act; mark = true; }
      var ch = addSpeakers(t.chars, info.who, known); if (ch !== (t.chars || '')) n.chars = ch;
      if (!t.durSet && Math.abs((t.dur || 0) - info.minutes) > 0.001) n.dur = info.minutes;   // a time the person set wins
      n.w = true; n.pages = info.pages;
      if (mark) n.chg = { by: 'script', at: now };
      if (JSON.stringify(n) !== JSON.stringify(t)) { tl[rec.i] = n; changed = true; }
    });
    // scenes whose heading was removed from the script stay on the timeline as "not written yet"
    tl = tl.map(function (t) { if (t.w && !inScript[t.id]) { changed = true; var n = Object.assign({}, t); delete n.w; delete n.pages; return n; } return t; });
    // order: written scenes follow the script; unwritten ones keep their places
    var want = P.blocks.map(function (b) { return b.h.tid; }).filter(function (id) { return byId[id]; }), wi = 0;
    var cur = tl.filter(function (t) { return inScript[t.id] && byId[t.id]; }).map(function (t) { return t.id; });
    if (want.join('|') !== cur.join('|')) {
      var byId2 = {}; tl.forEach(function (t) { byId2[t.id] = t; });
      tl = tl.map(function (t) { return (inScript[t.id] && byId[t.id]) ? byId2[want[wi++]] : t; }); changed = true;
    }
    newOnes.forEach(function (o) {
      var at = o.after ? tl.findIndex(function (t) { return t.id === o.after; }) + 1 : tl.findIndex(function (t) { return t.act >= o.t.act; });
      if (at < 0) at = tl.length; tl.splice(at, 0, o.t);
    });
    if (!changed) return false;
    d.timelines[k] = tl; mirror(d, k); bump(d, k);
    return true;
  }

  // Timeline → script (after editing the timeline or outline): plot, heading location, act and order.
  function toScript(d, k, why) {
    if (!scriptLinked(d, k)) return false;
    var sc = script(d, k); if (!sc.linked) pair(d, k);
    var tl = timeline(d, k), byId = {}, P = parse(sc.els), changed = false, moved = false;
    tl.forEach(function (t, i) { byId[t.id] = { t: t, i: i }; });
    P.blocks.forEach(function (b) {
      var h = b.h, rec = h.tid && byId[h.tid]; if (!rec) return;
      var t = rec.t, lk = h.lk || (h.lk = { loc: parseHeading(h.text).loc, tloc: t.location || '', plot: cleanPlot(h.plot || t.plot), tplot: t.plot, sum: t.summary || '' });
      if (t.plot !== lk.tplot) {
        if (cleanPlot(h.plot || 'U') !== t.plot) { b.els = b.els.map(function (e) { return Object.assign({}, e, { plot: t.plot }); }); b.h = h = b.els[0]; changed = true; }
        h.lk = lk = Object.assign({}, lk, { plot: t.plot, tplot: t.plot });
      }
      if ((t.location || '') !== lk.tloc && t.location) {
        var hp = parseHeading(h.text), txt = (hp.pre ? hp.pre + ' ' : '') + String(t.location).toUpperCase() + (hp.time ? ' - ' + hp.time : '');
        if (txt !== h.text) { b.els[0] = h = Object.assign({}, b.els[0], { text: txt }); b.h = h; changed = true; }
        h.lk = lk = Object.assign({}, lk, { loc: parseHeading(txt).loc, tloc: t.location });
      }
      if (b.act !== t.act) moved = true;
    });
    var want = tl.filter(function (t) { return P.blocks.some(function (b) { return b.h.tid === t.id; }); }).map(function (t) { return t.id; });
    var have = P.blocks.filter(function (b) { return byId[b.h.tid]; }).map(function (b) { return b.h.tid; });
    if (want.join('|') !== have.join('|')) moved = true;
    var els;
    if (moved) {
      keepVersion(sc, why || 'Before the timeline moved scenes');
      var blocksBy = {}; P.blocks.forEach(function (b) { if (b.h.tid && byId[b.h.tid]) blocksBy[b.h.tid] = b; });
      var loose = {}; P.blocks.forEach(function (b) { if (!(b.h.tid && byId[b.h.tid])) (loose[b.act] = loose[b.act] || []).push(b); });
      els = P.head.slice();
      for (var a = 0; a < 5; a++) {
        var list = tl.filter(function (t) { return t.act === a && blocksBy[t.id]; }).map(function (t) { return blocksBy[t.id]; }).concat(loose[a] || []);
        var A = P.acts[a];
        if (!list.length && !A) continue;
        els.push(A && A.open ? A.open : { id: 'a' + Date.now().toString(36) + a, type: 'act', text: ACTNAME[a], act: a, plot: 'X' });
        if (A) els = els.concat(A.lead);
        list.forEach(function (b) { els = els.concat(b.els.map(function (e) { return e.act === a ? e : Object.assign({}, e, { act: a }); })); });
        if (A && A.close) els.push(A.close);
      }
      changed = true;
    } else if (changed) {
      els = [];
      // same order, with the changed blocks swapped in (ids don't change)
      var map = {}; P.blocks.forEach(function (b) { map[b.els[0].id] = b; });
      var skip = 0;
      sc.els.forEach(function (e) {
        if (skip) { skip--; return; }
        if (e.type === 'heading' && map[e.id]) { var b = map[e.id]; els = els.concat(b.els); skip = b.els.length - 1; return; }
        els.push(e);
      });
    }
    if (!changed) return false;
    sc.els = els; sc.lrev = (sc.lrev || 0) + 1;
    return true;
  }
  function keepVersion(sc, name) {
    var v0 = (sc.versions || [])[0];
    if (v0 && v0.auto && Date.now() - (v0.t || 0) < 5 * 60000) return;   // one automatic copy per 5 minutes is enough
    sc.versions = [{ id: 'v' + Date.now(), name: name, at: new Date().toLocaleString(), t: Date.now(), auto: true, pages: Math.max(1, Math.round((sc.els || []).length / 14)), els: (sc.els || []).map(function (e) { return Object.assign({}, e); }) }].concat(sc.versions || []);
  }
  // Delete a written scene from the script (after the person said yes). A copy of the script is kept in Versions.
  function removeFromScript(d, k, id, title) {
    var sc = script(d, k); if (!sc) return false;
    var P = parse(sc.els), b = P.blocks.filter(function (x) { return x.h.tid === id; })[0]; if (!b) return false;
    sc.versions = [{ id: 'v' + Date.now(), name: 'Before deleting the scene “' + (title || parseHeading(b.h.text).loc) + '”', at: new Date().toLocaleString(), t: Date.now(), pages: Math.max(1, Math.round(sc.els.length / 14)), els: sc.els.map(function (e) { return Object.assign({}, e); }) }].concat(sc.versions || []);
    var drop = {}; b.els.forEach(function (e) { drop[e.id] = 1; });
    sc.els = sc.els.filter(function (e) { return !drop[e.id]; }); sc.lrev = (sc.lrev || 0) + 1;
    return true;
  }
  // What each timeline scene has in the script: { id: { pages, minutes, who, heading, changed (outline summary changed since written) } }
  var infoCache = { els: null, k: '', multi: null, v: null, tl: null };
  function scriptInfo(d, k, multi) {
    multi = asPace(multi); var mk = multi.multi + ':' + multi.ppm;
    var sc = script(d, k), tl = timeline(d, k); if (!sc || !tl || !scriptLinked(d, k)) return {};
    if (infoCache.els === sc.els && infoCache.k === k && infoCache.multi === mk && infoCache.tl === tl) return infoCache.v;
    var byId = {}; tl.forEach(function (t) { byId[t.id] = t; });
    var out = {};
    parse(sc.els).blocks.forEach(function (b) {
      var id = b.h.tid; if (!id || !byId[id]) return; var inf = blockInfo(b, multi), t = byId[id], lk = b.h.lk || {};
      out[id] = { pages: inf.pages, minutes: inf.minutes, who: inf.who, heading: b.h.text, hid: b.h.id, changed: lk.sum !== undefined && String(t.summary || '').trim() !== String(lk.sum || '').trim() && !!String(t.summary || '').trim() };
    });
    infoCache = { els: sc.els, k: k, multi: mk, v: out, tl: tl };
    return out;
  }
  // "Keep the script as it is": the outline's new summary becomes the baseline
  function keepScene(d, k, id) {
    var sc = script(d, k), t = (timeline(d, k) || []).filter(function (x) { return x.id === id; })[0]; if (!sc || !t) return;
    sc.els = sc.els.map(function (e) { return e.type === 'heading' && e.tid === id ? Object.assign({}, e, { lk: Object.assign({}, e.lk || {}, { sum: t.summary || '' }) }) : e; }); sc.lrev = (sc.lrev || 0) + 1;
  }
  // Replace one scene's lines (Rewrite with Claude). The old script is kept in Versions.
  function replaceScene(d, k, id, body) {
    var sc = script(d, k), t = (timeline(d, k) || []).filter(function (x) { return x.id === id; })[0]; if (!sc || !t || !body.length) return false;
    var P = parse(sc.els), b = P.blocks.filter(function (x) { return x.h.tid === id; })[0]; if (!b) return false;
    sc.versions = [{ id: 'v' + Date.now(), name: 'Before rewriting “' + (t.title || 'a scene') + '” with Claude', at: new Date().toLocaleString(), t: Date.now(), pages: Math.max(1, Math.round(sc.els.length / 14)), els: sc.els.map(function (e) { return Object.assign({}, e); }) }].concat(sc.versions || []);
    var h = body[0].type === 'heading' ? body[0] : null;
    var nh = Object.assign({}, b.h, h ? { text: h.text } : {}, { tid: id, lk: Object.assign({}, b.h.lk || {}, { sum: t.summary || '', loc: parseHeading(h ? h.text : b.h.text).loc }) });
    var rest = (h ? body.slice(1) : body).map(function (e) { return Object.assign({}, e, { act: b.act, plot: t.plot }); });
    var at = sc.els.indexOf(b.h), out = sc.els.slice(0, at).concat([nh]).concat(rest).concat(sc.els.slice(at + b.els.length));
    sc.els = out; sc.lrev = (sc.lrev || 0) + 1;
    return true;
  }
  // Link a script that isn't linked (written from another draft) to the structure in use
  function linkScript(d, k) { var sc = script(d, k), sv = inUse(d, k); if (!sc || !sv) return false; sc.from = sv.id; sc.fromN = sv.n; sc.linked = false; pair(d, k); return true; }

  // ---------- The "Assign plots" dialog (same in the Outline and the Timeline) ----------
  var COL = { A: '#5b8def', B: '#3dbb85', C: '#f0675a', X: '#9b80f2', U: '#4a4f58' };
  var LAB = { A: 'A', B: 'B', C: 'C', X: 'All', U: '?' };
  function assignOpen(self, store, k) {
    var d = store.data, tl = timeline(d, k) || [], nU = tl.filter(function (t) { return t.plot === 'U'; }).length, scope = nU ? 'u' : 'all';
    self.setState({ asg: { how: 'cast', scope: scope, rows: suggestByCast(d, k, scope === 'all' ? 'all' : 'u'), menu: null, busy: false, err: '', cf: false } });
  }
  function assignVals(self, store, k, ep, after) {
    var a = self.state.asg, d = (store && store.data) || {}, tl = timeline(d, k) || [];
    var nU = tl.filter(function (t) { return t.plot === 'U'; }).length;
    var set = function (p) { self.setState({ asg: Object.assign({}, self.state.asg, p) }); };
    var vals = { asgCount: nU, asgHas: !!tl.length, asgNeed: nU > 0, asgNeedText: nU + (nU === 1 ? ' scene needs a plot' : ' scenes need a plot'),
      asgBtnLabel: nU ? 'Assign plots · ' + nU + ' unassigned' : 'Assign plots',
      asgOpenIt: function () { if (store) assignOpen(self, store, k); } };
    if (!a) return Object.assign(vals, { asgOpen: false, asgRows: [] });
    var refresh = function (how, scope) { set({ how: how, scope: scope, rows: how === 'cast' ? suggestByCast(d, k, scope === 'all' ? 'all' : 'u') : a.rows.filter(function () { return false; }), menu: null, err: '', cf: false }); };
    var changes = a.rows.filter(function (r) { return r.plot !== r.now; });
    var runClaude = function () {
      var ctl = new AbortController(); self._asgCtl = ctl;
      set({ busy: true, err: '', cf: false, how: 'claude', rows: [] });
      var useP = (root.claude && root.claude.use) ? root.claude.use('sample') : Promise.resolve(null);
      useP.then(function (sample) {
        if (!sample) throw { code: 'unavailable' };
        return sample.json(claudePrompt(d, k, a.scope === 'all' ? 'all' : 'u', ep), { modelTier: 'complex', signal: ctl.signal, cache: false });
      }).then(function (data) {
        var got = readClaude(d, k, data), cur = self.state.asg; if (!cur) return;
        var rows = tl.filter(function (t) { return a.scope === 'all' || t.plot === 'U'; }).map(function (t) { var g = got[t.id]; return { id: t.id, title: t.title, now: t.plot, plot: g ? g.plot : t.plot, why: g ? (g.why || 'Claude’s pick') : 'Claude didn’t say' }; });
        self.setState({ asg: Object.assign({}, cur, { busy: false, rows: rows }) });
      }).catch(function (e) {
        var cur = self.state.asg; if (!cur) return;
        var code = (e && e.code) || '';
        var msg = ctl.signal.aborted ? 'Stopped. Nothing was changed.' : (code === 'unavailable' || code === 'no_key' ? 'Claude isn’t connected. Add your Anthropic API key in App settings, or use “By who’s in each scene”.' : (code === 'rate_limited' ? 'Claude is busy or your usage limit was reached. Try again in a moment.' : 'Claude’s answer couldn’t be read. Try again, or use “By who’s in each scene”.'));
        self.setState({ asg: Object.assign({}, cur, { busy: false, err: msg }) });
      });
    };
    return Object.assign(vals, {
      asgOpen: true,
      asgClose: function () { if (self._asgCtl) self._asgCtl.abort(); self.setState({ asg: null }); },
      asgCastBg: a.how === 'cast' ? '#ecebe8' : 'transparent', asgCastFg: a.how === 'cast' ? '#101114' : '#ecebe8',
      asgAiBg: a.how === 'claude' ? '#ecebe8' : 'rgba(242,179,61,0.08)', asgAiFg: a.how === 'claude' ? '#101114' : '#f2d48a',
      asgPickCast: function () { if (!a.busy) refresh('cast', a.scope); },
      asgPickClaude: function () { if (!a.busy) set({ cf: true, err: '' }); },
      asgCf: !!a.cf, asgCfGo: runClaude, asgCfNo: function () { set({ cf: false }); },
      asgUBg: a.scope === 'u' ? '#2a2e36' : 'transparent', asgAllBg: a.scope === 'all' ? '#2a2e36' : 'transparent',
      asgULabel: 'Only unassigned (' + nU + ')', asgAllLabel: 'All scenes (' + tl.length + ')',
      asgPickU: function () { if (!a.busy) refresh(a.how === 'claude' ? 'cast' : a.how, 'u'); },
      asgPickAll: function () { if (!a.busy) refresh(a.how === 'claude' ? 'cast' : a.how, 'all'); },
      asgBusy: !!a.busy, asgStop: function () { if (self._asgCtl) self._asgCtl.abort(); },
      asgHasErr: !!a.err, asgErr: a.err,
      asgEmpty: !a.busy && !a.rows.length && !a.err, asgEmptyText: a.scope === 'u' ? 'Every scene already has a plot. Choose “All scenes” for a fresh sort.' : 'This episode has no scenes yet.',
      asgRows: a.rows.map(function (r) {
        var open = a.menu === r.id, ch = r.plot !== r.now;
        return { title: r.title || 'Scene', why: r.why, label: LAB[r.plot] + ' ▾', c: COL[r.plot], fg: r.plot === 'U' || r.plot === 'X' ? '#ecebe8' : '#101114',
          was: ch ? 'was ' + (r.now === 'U' ? 'no plot' : (r.now === 'X' ? 'All' : r.now)) : '', menuOpen: open,
          toggle: function () { set({ menu: open ? null : r.id }); },
          opts: ['A', 'B', 'C', 'X', 'U'].map(function (p) { return { label: p === 'X' ? 'All plots' : (p === 'U' ? 'No plot yet' : p + ' plot'), c: COL[p], pick: function () { set({ menu: null, rows: self.state.asg.rows.map(function (q) { return q.id === r.id ? Object.assign({}, q, { plot: p, why: 'Your pick' }) : q; }) }); } }; }) };
      }),
      asgApplyLabel: changes.length ? 'Apply to ' + changes.length + (changes.length === 1 ? ' scene' : ' scenes') : 'Nothing to change',
      asgApplyOp: changes.length ? 1 : 0.5,
      asgApply: function () {
        if (!changes.length || a.busy) return;
        var map = {}; changes.forEach(function (r) { map[r.id] = r.plot; });
        store.update(function (dd) { setPlots(dd, k, map, 'assign'); });
        self.setState({ asg: null });
        if (after) after(changes.length);
      }
    });
  }

  root.SCLink = { PLOTS: PLOTS, cleanPlot: cleanPlot, splitChars: splitChars, inUse: inUse, timeline: timeline, mirror: mirror, bump: bump, patch: patch, setPlots: setPlots,
    use: use, adopt: adopt, fromStruct: fromStruct, toStruct: toStruct, suggestByCast: suggestByCast, claudePrompt: claudePrompt, readClaude: readClaude,
    COL: COL, LAB: LAB, assignOpen: assignOpen, assignVals: assignVals,
    parseHeading: parseHeading, parse: parse, ensure: ensure, pace: pace, scriptLinked: scriptLinked, pair: pair, fromScript: fromScript, toScript: toScript,
    removeFromScript: removeFromScript, scriptInfo: scriptInfo, keepScene: keepScene, replaceScene: replaceScene, linkScript: linkScript };
})(typeof window !== 'undefined' ? window : globalThis);
