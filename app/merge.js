// "Unsaved changes": what a rescued copy (edits a device couldn't send before the other device took control) has that the
// live copy doesn't, and Merge / Overwrite.
// The data is cut into "items": one per idea, bible entry, timeline scene, outline draft, episode script, show … (anything in
// an array of things with an id is one item per thing; anything else is one item per key). Each device remembers a
// fingerprint of every item as it was at its last sync (sync.js keeps it, and puts it in a rescued copy). Comparing three
// fingerprints — that base, the rescued copy and the live copy — says who changed what:
//   only the rescued device changed it → Merge takes it;  both changed it → the writer picks;  only the live copy → kept.
// Used by sync.js (PC + iPad) for the fingerprint, and by the Dashboard for the list and the merge.
(function (root) {
  'use strict';
  var SEP = '\u0001';
  // Never merged: this device's own settings, versions (safe in Drive), the delete PIN, the timeline revision counter (bumped automatically)
  var SKIP = { tlLock: 1, plotAI: 1, openSettings: 1, currentEp: 1, bibleShow: 1, scriptZoom: 1, backupReq: 1, claudeReady: 1, claudeModel: 1, punchAI: 1, punchModel: 1,
    suggestChips: 1, wgaAuto: 1, sbDetail: 1, sbAutoFix: 1, backups: 1, deletePin: 1, timelineRev: 1, deviceUi: 1 };

  function hash(s) {   // FNV-1a, 2 × 32 bit — only to notice a change, not for security
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }
  var isIdList = function (v) { return Array.isArray(v) && v.length > 0 && v.every(function (x) { return x && typeof x === 'object' && !Array.isArray(x) && x.id != null; }); };
  var parse = function (o) { return typeof o === 'string' ? JSON.parse(o) : o; };

  // file → { key: { v: value, path: [...] } } ; arrays of things with an id also get an "@order" item (the id list)
  function items(file) {
    var o = parse(file) || {}, d = o.data || {}, out = {};
    var add = function (path, v) { out[path.join(SEP)] = { v: v, path: path }; };
    var list = function (path, arr) {
      arr.forEach(function (x) { add(path.concat(['#' + x.id]), x); });
      add(path.concat(['@order']), arr.map(function (x) { return String(x.id); }));
    };
    Object.keys(d).forEach(function (k) {
      if (SKIP[k]) return;
      var v = d[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.keys(v).forEach(function (s) { if (isIdList(v[s])) list(['data', k, s], v[s]); else if (v[s] !== undefined) add(['data', k, s], v[s]); });
      } else if (isIdList(v)) list(['data', k], v);
      else if (v !== undefined) add(['data', k], v);
    });
    var shows = o.ui && o.ui.dash && o.ui.dash.shows;
    if (isIdList(shows)) list(['shows'], shows);
    return out;
  }
  // The fingerprint a device remembers at each sync: item → hash (the order items keep their id list)
  function fingerprint(file) {
    var it = items(file), fp = {};
    Object.keys(it).forEach(function (k) { var x = it[k]; fp[k] = x.path[x.path.length - 1] === '@order' ? x.v.join(',') : hash(JSON.stringify(x.v)); });
    return fp;
  }
  var fpOf = function (x) { return !x ? undefined : (x.path[x.path.length - 1] === '@order' ? x.v.join(',') : hash(JSON.stringify(x.v))); };
  // Did the order of the things both lists share change?
  var sameOrder = function (a, b) {
    if (a == null || b == null) return a == b;
    var A = a ? String(a).split(',') : [], B = b ? String(b).split(',') : [], inB = {}, inA = {};
    B.forEach(function (x) { inB[x] = 1; }); A.forEach(function (x) { inA[x] = 1; });
    return A.filter(function (x) { return inB[x]; }).join(',') === B.filter(function (x) { return inA[x]; }).join(',');
  };

  // ---------- words ----------
  var COLS = { J: 'Joke', A: 'A plot idea', B: 'B plot idea', C: 'C plot idea', jokes: 'Joke' };
  var KINDS = { char: 'Character', place: 'Location', gag: 'Running gag', premise: 'Premise', rule: 'Rule' };
  var FIELDS = { text: 'Description', backstory: 'Backstory', look: 'Look', lookChanges: 'Look changes', sheets: 'Character sheet', pics: 'Pictures', name: 'Name',
    dur: 'Length', durSet: 'Length', plot: 'Plot', act: 'Act', chars: 'Characters', location: 'Location', summary: 'Summary', purpose: 'Purpose', notes: 'Notes',
    jokes: 'Jokes', title: 'Title', beat: 'Beat', els: 'Lines', tp: 'Title page', versions: 'Script versions', seasons: 'Seasons and episodes', cfg: 'Show settings',
    rel: 'Relationships', speech: 'Voice', want: 'Want', flaw: 'Flaw', trait: 'Trait', role: 'Role', aka: 'Other names', data: 'Outline' };
  var pretty = function (f) { return FIELDS[f] || String(f).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, function (c) { return c.toUpperCase(); }); };
  var cut = function (s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  var q = function (s) { return '“' + cut(s, 90) + '”'; };
  function fieldsChanged(a, b) {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [];
    var keys = {}, out = [];
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) { if (k === 'id' || k === 'at' || k === 'savedAt') return; if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { var p = pretty(k); if (out.indexOf(p) < 0) out.push(p); } });
    return out;
  }
  function epName(shows, key) {   // "parks:p3e5" or "p3e5" → S3E5 “Media Blitz”
    var parts = String(key).split(':'), epId = parts[parts.length - 1], sid = parts.length > 1 ? parts[0] : null;
    for (var i = 0; i < shows.length; i++) {
      var sh = shows[i]; if (sid && sh.id !== sid) continue;
      for (var j = 0; j < (sh.seasons || []).length; j++) for (var m = 0; m < (sh.seasons[j].eps || []).length; m++) {
        var e = sh.seasons[j].eps[m];
        if (e.id === epId) return 'S' + sh.seasons[j].n + 'E' + (e.num != null ? e.num : m + 1) + (e.title ? ' ' + q(e.title) : '');
      }
    }
    return 'Episode ' + epId;
  }
  function showName(shows, sid) { var s = shows.filter(function (x) { return x.id === sid; })[0]; return s ? s.name : sid; }
  function scriptDetail(a, b) {   // a = the rescued script, b = the live one
    var ea = (a && a.els) || [], eb = (b && b.els) || [], mb = {}, ma = {}, ed = 0, nw = 0, rm = 0;
    eb.forEach(function (x) { mb[x.id] = x; }); ea.forEach(function (x) { ma[x.id] = 1; });
    ea.forEach(function (x) { if (!mb[x.id]) nw++; else if (JSON.stringify(mb[x.id]) !== JSON.stringify(x)) ed++; });
    eb.forEach(function (x) { if (!ma[x.id]) rm++; });
    var p = []; if (ed) p.push(ed + ' line' + (ed === 1 ? '' : 's') + ' edited'); if (nw) p.push(nw + ' new line' + (nw === 1 ? '' : 's')); if (rm) p.push(rm + ' line' + (rm === 1 ? '' : 's') + ' removed');
    return p.join(', ') || 'Title page or script settings changed';
  }
  function words(path, rv, cv, shows, multi) {
    var k = path[1], s = path[2], last = path[path.length - 1], el = last.charAt(0) === '#', ord = last === '@order', v = rv !== undefined ? rv : cv;
    var pre = function (sid) { return multi && sid ? showName(shows, sid) + ' · ' : ''; };
    if (path[0] === 'shows') return ord ? { area: 'Shows', what: 'The order of your shows' } : { area: 'Shows', what: 'Show · ' + (v && v.name || 'a show'), detail: '' };
    if (k === 'ideasBy') return ord ? { area: 'Idea bank', what: pre(s) + 'Idea bank · order of the ideas' } : { area: 'Idea bank', what: pre(s) + 'Idea bank · ' + (COLS[v && v.col] || 'Idea'), detail: q(v && v.text) };
    if (k === 'bibleBy') return ord ? { area: 'Show bible', what: pre(s) + 'Show bible · order' } : { area: 'Show bible', what: pre(s) + 'Show bible · ' + (v && (v.name || v.title) || KINDS[v && v.kind] || 'entry'), detail: KINDS[v && v.kind] || '' };
    if (k === 'timelines') return ord ? { area: 'Timeline', what: epName(shows, s) + ' · Timeline · scene order', detail: 'Scenes moved' } : { area: 'Timeline', what: epName(shows, s) + ' · Timeline · scene ' + q(v && (v.title || v.location) || 'Scene') };
    if (k === 'structures') return ord ? { area: 'Outline', what: epName(shows, s) + ' · Outline · order of the drafts' } : { area: 'Outline', what: epName(shows, s) + ' · Outline · draft ' + q(v && v.data && v.data.title || ('#' + (v && v.n || ''))) };
    if (k === 'assigned') return ord ? { area: 'Ideas for this episode', what: epName(shows, s) + ' · Ideas for this episode · order' } : { area: 'Ideas for this episode', what: epName(shows, s) + ' · Ideas for this episode', detail: q(v && v.text) };
    if (k === 'scripts') return { area: 'Script', what: epName(shows, s) + ' · Script' };
    if (k === 'timelineMeta') return { area: 'Timeline', what: epName(shows, s) + ' · Timeline settings' };
    if (k === 'built') return { area: 'Outline', what: epName(shows, s) + ' · Which outline draft is the timeline' };
    if (k === 'continuity') return { area: 'Show bible', what: pre(s) + 'Continuity' };
    if (k === 'showNotes') return { area: 'Show bible', what: pre(s) + 'Show notes' };
    if (k === 'worldLog') return { area: 'Show bible', what: 'World as of ' + epName(shows, s) };
    if (k === 'library') return { area: 'Asset library', what: 'Asset library' + (s ? ' · ' + pretty(s) : '') };
    return { area: 'Other', what: pretty(k) + (s ? ' · ' + pretty(String(s).replace(/^#/, '')) : '') + (el && path.length > 3 ? ' · ' + cut(v && (v.name || v.title || v.text) || last.slice(1), 50) : '') };
  }

  // For "Compare the two": the fields that differ, as short text — [{ field, here, there }]
  var asText = function (v) { if (v == null || v === '') return '(empty)'; if (typeof v === 'string') return cut(v, 400); if (Array.isArray(v) && v.every(function (x) { return x && x.text != null; })) return cut(v.map(function (x) { return x.text; }).join(' / '), 400); return cut(JSON.stringify(v), 400); };
  function compare(rv, cv) {
    if (rv && cv && typeof rv === 'object' && typeof cv === 'object' && !Array.isArray(rv) && !Array.isArray(cv)) {
      var keys = {}, out = [];
      Object.keys(rv).concat(Object.keys(cv)).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) { if (k === 'id' || k === 'at' || k === 'savedAt') return; if (JSON.stringify(rv[k]) !== JSON.stringify(cv[k]) && out.length < 4) out.push({ field: pretty(k), there: asText(rv[k]), here: asText(cv[k]) }); });
      return out;
    }
    return [{ field: '', there: rv === undefined ? '(not there)' : asText(rv), here: cv === undefined ? '(not there)' : asText(cv) }];
  }

  // rescued copy vs live copy (+ the rescued device's fingerprint at its last sync, when it has one)
  // → [{ key, tag: NEW | CHANGED | REMOVED | BOTH, both, def: 'theirs' | 'mine', area, what, detail, order }]
  function diff(rescued, live, base) {
    var R = items(rescued), C = items(live), keys = {}, out = [];
    var ro = parse(rescued) || {}, lo = parse(live) || {};
    var shows = (((lo.ui || {}).dash || {}).shows || []).concat((((ro.ui || {}).dash || {}).shows || []));
    var multi = (((lo.ui || {}).dash || {}).shows || []).length > 1;
    Object.keys(R).concat(Object.keys(C)).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var r = R[k], c = C[k], path = (r || c).path, ord = path[path.length - 1] === '@order';
      var rf = fpOf(r), cf = fpOf(c);
      if (ord ? sameOrder(rf, cf) : rf === cf) return;
      var b = base ? base[k] : undefined, hasBase = !!base;
      var rSame = hasBase && (ord ? sameOrder(rf, b) : rf === b), cSame = hasBase && (ord ? sameOrder(cf, b) : cf === b);
      if (ord && (!r || !c)) return;   // a list that's gone on one side: its items say it
      if (rSame) return;                // the rescued device didn't change it: the live copy's edit stays
      var tag, both = false;
      if (cSame) tag = !c ? 'NEW' : (!r ? 'REMOVED' : 'CHANGED');
      else { tag = 'BOTH'; both = true; }
      if (ord) { if (tag === 'NEW' || tag === 'REMOVED') return; }
      var w = words(path, r && r.v, c && c.v, shows, multi), detail = w.detail || '';
      var rv = r && r.v, cv = c && c.v;
      if (path[1] === 'scripts') detail = scriptDetail(rv, cv);
      else if (!ord && rv && cv && typeof rv === 'object' && !Array.isArray(rv)) {
        var f = fieldsChanged(rv, cv); if (f.length) detail = (detail ? detail + ' — ' : '') + 'Changed: ' + f.slice(0, 5).join(', ') + (f.length > 5 ? '…' : '');
      } else if (path[1] === 'timelines' && !ord && rv && !cv) detail = [rv.location, rv.plot && rv.plot !== 'U' ? rv.plot + ' plot' : ''].filter(Boolean).join(' · ');
      if (both && !hasBase) detail = (detail ? detail + ' — ' : '') + (!c ? 'only in the rescued copy' : !r ? 'not in the rescued copy' : 'different in the two copies');
      out.push({ key: k, path: path, tag: tag, both: both, cmp: both ? compare(rv, cv) : null, def: both ? (!hasBase && r && !c && !ord ? 'theirs' : 'mine') : 'theirs', area: w.area, what: w.what, detail: detail, order: ord, hasR: !!r, hasC: !!c });
    });
    var rank = { Shows: 0, 'Idea bank': 1, 'Show bible': 2, Outline: 3, Timeline: 4, 'Ideas for this episode': 5, Script: 6 };
    out.sort(function (a, b) { return (a.both - b.both) || ((rank[a.area] != null ? rank[a.area] : 9) - (rank[b.area] != null ? rank[b.area] : 9)) || (a.what < b.what ? -1 : a.what > b.what ? 1 : 0); });
    return out;
  }

  // Apply: every change whose choice is 'theirs' takes the rescued copy's version (added, replaced or removed). Returns a new file object.
  function apply(live, rescued, changes, choices) {
    var L = JSON.parse(typeof live === 'string' ? live : JSON.stringify(live)), R = items(rescued);
    var pick = function (ch) { return (choices && choices[ch.key]) || ch.def; };
    var holder = function (path, make) {   // the object + name holding the list this '#id' / '@order' item belongs to
      var segs = path[0] === 'shows' ? ['ui', 'dash', 'shows'] : ['data'].concat(path.slice(1, -1)), o = L;
      for (var i = 0; i < segs.length - 1; i++) { if (o[segs[i]] == null) { if (!make) return null; o[segs[i]] = {}; } o = o[segs[i]]; }
      return { parent: o, name: segs[segs.length - 1] };
    };
    var touched = {}, revs = {};
    var orders = [];
    changes.forEach(function (ch) {
      if (pick(ch) !== 'theirs') return;
      var path = ch.path, last = path[path.length - 1], r = R[ch.key];
      if (path[0] === 'data' && path[1] === 'timelines') revs[path[2]] = 1;
      if (last === '@order') { orders.push(ch); return; }
      if (last.charAt(0) === '#') {
        var h = holder(path, !!r); if (!h) return;
        var arr = h.parent[h.name]; if (!Array.isArray(arr)) arr = h.parent[h.name] = [];
        var id = last.slice(1), i = arr.findIndex(function (x) { return String(x.id) === id; });
        if (!r) { if (i >= 0) arr.splice(i, 1); }
        else if (i >= 0) arr[i] = JSON.parse(JSON.stringify(r.v));
        else {   // new: put it after the thing it follows in the rescued copy
          var rOrd = (R[path.slice(0, -1).concat(['@order']).join(SEP)] || { v: [] }).v, at = rOrd.indexOf(id), pos = arr.length;
          for (var j = at - 1; j >= 0; j--) { var pi = arr.findIndex(function (x) { return String(x.id) === rOrd[j]; }); if (pi >= 0) { pos = pi + 1; break; } }
          if (at === 0) pos = 0;
          arr.splice(pos, 0, JSON.parse(JSON.stringify(r.v)));
        }
      } else {
        var segs = path.slice(1), o = L.data = L.data || {};
        for (var m = 0; m < segs.length - 1 && o; m++) { if (o[segs[m]] == null) { if (!r) { o = null; break; } o[segs[m]] = {}; } o = o[segs[m]]; }
        if (o) { if (r) o[last] = JSON.parse(JSON.stringify(r.v)); else delete o[last]; }
      }
      touched[ch.key] = 1;
    });
    // order last: the rescued order for the things both have; anything only here stays after its neighbour
    orders.forEach(function (ch) {
      var h = holder(ch.path, false); if (!h || !Array.isArray(h.parent[h.name])) return;
      var arr = h.parent[h.name], want = R[ch.key] ? R[ch.key].v : [], byId = {};
      arr.forEach(function (x) { byId[String(x.id)] = x; });
      var out = [], used = {};
      want.forEach(function (id) { if (byId[id]) { out.push(byId[id]); used[id] = 1; } });
      arr.forEach(function (x, i) { if (used[String(x.id)]) return; var prev = i > 0 ? String(arr[i - 1].id) : null, pi = prev ? out.findIndex(function (y) { return String(y.id) === prev; }) : -1; out.splice(pi + 1, 0, x); used[String(x.id)] = 1; });
      h.parent[h.name] = out;
    });
    L.data = L.data || {};
    Object.keys(revs).forEach(function (k) { L.data.timelineRev = L.data.timelineRev || {}; L.data.timelineRev[k] = (L.data.timelineRev[k] || 0) + 1; });
    return L;
  }
  // Which shows a change belongs to (for the "saved a version first" step)
  function showsOf(changes, live) {
    var lo = parse(live) || {}, shows = (((lo.ui || {}).dash || {}).shows || []), out = {};
    var epShow = {}; shows.forEach(function (sh) { (sh.seasons || []).forEach(function (se) { (se.eps || []).forEach(function (e) { epShow[e.id] = sh.id; }); }); });
    changes.forEach(function (ch) {
      var p = ch.path; if (p[0] === 'shows') { var id = String(p[1] || '').replace(/^#/, ''); if (id && id !== '@order') out[id] = 1; return; }
      var s = String(p[2] || ''); if (s.indexOf(':') > 0) out[s.split(':')[0]] = 1; else if (epShow[s]) out[epShow[s]] = 1; else if (shows.some(function (x) { return x.id === s; })) out[s] = 1;
    });
    return Object.keys(out);
  }

  var API = { compare: compare, SEP: SEP, hash: hash, items: items, fingerprint: fingerprint, diff: diff, apply: apply, showsOf: showsOf, sameOrder: sameOrder };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.SCMerge = API;
})(typeof window !== 'undefined' ? window : this);
