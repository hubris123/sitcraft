// Script formatting helpers (formatting project): recognise what a typed or pasted line is.
// Our own rules (written after studying how Beat, Trelby and the Fountain format do it — no code copied):
//   INT. / EXT. / I/E …          → scene heading (capitals)
//   COLD OPEN, ACT ONE … TAG     → act break
//   … TO:  /  FADE IN: / FADE OUT. → transition
//   a cast name, or a short ALL-CAPS line (+ (V.O.) etc.) → character
//   ( … ) after a character / dialogue → parenthetical
//   anything else stays as it is.
// Used by the Script editor: on Enter (format as you type), on paste (split into lines), and by Reformat.
(function (root) {
  'use strict';
  var HEAD = /^(int\.?\s*\/\s*ext|ext\.?\s*\/\s*int|i\s*\/\s*e|e\s*\/\s*i|int|ext|est)(\.|\s)\s*\S/i;
  var NUMW = '(one|two|three|four|five|six|1|2|3|4|5|6|i|ii|iii|iv|v|vi)';
  var ACT = new RegExp('^(cold open|teaser|tag|act ' + NUMW + '|end of act ' + NUMW + '|end of (the )?cold open|end of teaser|end of show|the end)\\.?$', 'i');
  var TRANS = /^([a-z][a-z' ]{1,30} to:|fade in:|fade out\.?|fade to black\.?|cut to black\.?)$/i;
  var EXT = /\s*\((v\.?\s*o\.?|o\.?\s*s\.?|o\.?\s*c\.?|cont['’]?d|continuing|on phone|on tv|filtered|pre-?lap|into phone|sotto)\)\s*$/i;

  function up(t) { return String(t || '').toUpperCase(); }
  function clean(t) { return String(t || '').replace(/\s+$/, ''); }
  // the cast: [{full, first, aka}] → a lookup of names in capitals
  function castSet(names) {
    var set = {}, firsts = {};
    (names || []).forEach(function (n) {
      n = String(n || '').trim(); if (!n || set[up(n)]) return;
      set[up(n)] = 1;
      var f = up(n.split(/\s+/)[0]); if (f.length > 1) firsts[f] = (firsts[f] || 0) + 1;
    });
    Object.keys(firsts).forEach(function (f) { if (firsts[f] === 1) set[f] = 1; });
    return set;
  }
  function isCaps(t) { return /[A-Z]/.test(t) && t === up(t); }
  // a name line: the cast (any capitals), or short ALL CAPS without sentence punctuation
  function nameKind(t, cast) {
    var base = t.replace(EXT, '').trim();
    if (!base || base.length > 32) return '';
    if (cast && cast[up(base)]) return 'cast';
    if (!isCaps(t)) return '';
    if (!/^[A-Z0-9][A-Z0-9 .'’&\-#]*$/.test(base)) return '';
    if (base.split(/\s+/).length > 4) return '';
    if (/[.!?,:;]$/.test(base) && !/\b(MR|MRS|MS|DR|ST|JR|SR)\.$/.test(base)) return '';
    return 'caps';
  }
  // capitalize the first letter of each sentence ("he walks in. she sits." → "He walks in. She sits.")
  function capFirst(t) {
    return String(t || '').replace(/(^\s*|[.!?]\s+)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  // What should this line be? cur = the element it is now, prev = the element before it.
  // Returns { type, text, sure } or null when nothing changes.
  function detect(text, cur, prev, cast, opts) {
    opts = opts || {};
    var t = clean(text), tt = t.trim(); if (!tt) return null;
    var out = null;
    if (cur === 'action' || cur === 'general' || opts.any) {
      if (HEAD.test(tt) || /^\.[^.]/.test(tt)) out = { type: 'heading', text: up(tt.replace(/^\./, '')), sure: true };
      else if (ACT.test(tt)) out = { type: 'act', text: up(tt.replace(/\.$/, '')), sure: true };
      else if (TRANS.test(tt) && (isCaps(tt) || /^(fade|smash|match|cut|dissolve|jump|time)/i.test(tt))) out = { type: 'transition', text: up(tt), sure: true };
      else if (prev !== 'character') {
        var k = nameKind(tt, cast);
        if (k) out = { type: 'character', text: up(tt), sure: k === 'cast' };
      }
    }
    if (!out && /^\(.*\)$/.test(tt) && (cur === 'dialogue' || ((cur === 'action' || opts.any) && (prev === 'character' || prev === 'dialogue' || prev === 'paren')))) out = { type: 'paren', text: tt, sure: true };
    if (!out && (cur === 'heading' || cur === 'character' || cur === 'transition' || cur === 'act') && tt !== up(tt)) out = { type: cur, text: up(tt), sure: true };
    if (!out && opts.capFirst && (cur === 'action' || cur === 'dialogue')) { var c2 = capFirst(t); if (c2 !== t) out = { type: cur, text: c2, sure: true }; }
    if (out && out.type === cur && out.text === t) return null;
    return out;
  }

  // Pasted text → lines with elements. Understands plain text, Fountain marks and "NAME: line" transcripts.
  function splitPaste(text, prev, cast) {
    var raw = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    var out = [], last = prev || 'action', inSpeech = prev === 'character' || prev === 'dialogue' || prev === 'paren';
    raw.forEach(function (line) {
      var ind = (line.match(/^ */) || [''])[0].length, t = line.trim();
      if (!t) { inSpeech = false; last = ''; if (out.length) out[out.length - 1].closed = true; return; }
      if (/^(title|credit|author|draft date|contact):/i.test(t) && !out.length) return;   // Fountain title page
      if (/^={3,}$/.test(t) || /^#+\s/.test(t) || /^\[\[.*\]\]$/.test(t)) return;          // page breaks, sections, notes
      var el;
      if (/^!/.test(t)) el = { type: 'action', text: t.slice(1) };
      else if (/^@/.test(t)) el = { type: 'character', text: up(t.slice(1)) };
      else if (/^>.*<$/.test(t)) el = { type: 'action', text: t.replace(/^>\s*|\s*<$/g, '') };
      else if (/^>/.test(t)) el = { type: 'transition', text: up(t.slice(1).trim()) };
      else if (HEAD.test(t) || ACT.test(t) || (TRANS.test(t) && isCaps(t))) el = detect(t, 'action', last, cast, { any: true });
      else if (inSpeech && /^\(.*\)$/.test(t)) el = { type: 'paren', text: t };
      else if (inSpeech && ind < 30) el = { type: 'dialogue', text: t };
      else {
        var m = t.match(/^([A-Za-z][A-Za-z .'’\-]{0,30}?)(\s*\([^)]*\))?\s*:\s+(.+)$/);
        var d = detect(t, 'action', last, cast, { any: true });
        var who = m && !HEAD.test(t) && !TRANS.test(t) && (nameKind(m[1] + (m[2] || ''), cast) === 'cast' || (isCaps(m[1]) && m[1].split(/\s+/).length <= 3));
        if (who) {
          out.push({ type: 'character', text: up(m[1] + (m[2] || '')) });
          el = { type: 'dialogue', text: m[3].trim(), oneLine: true };
        } else if (d) el = { type: d.type, text: d.text };
        else el = { type: 'action', text: t };
      }
      inSpeech = !el.oneLine && (el.type === 'character' || el.type === 'paren' || el.type === 'dialogue');
      delete el.oneLine;
      var pv = out[out.length - 1];
      // a wrapped paragraph (no blank line between) stays one line: dialogue after dialogue, action after action
      if (pv && pv.type === el.type && (el.type === 'dialogue' || el.type === 'action') && last === el.type && !pv.closed) { pv.text += ' ' + el.text; return; }
      out.push(el);
      last = el.type;
    });
    return out.map(function (e) { return { type: e.type, text: e.text }; });
  }

  // ---------- Pages for Print / PDF ----------
  // Courier 12 pt = 10 characters an inch and 6 lines an inch, so pages can be laid out exactly:
  // action/heading 6" = 60 characters, dialogue 3.5" = 35, parenthetical 2" = 20; US Letter 54 lines of text, A4 57.
  var COLS = { heading: 60, action: 60, transition: 60, act: 60, character: 38, paren: 20, dialogue: 35, more: 38, contd: 60 };
  function wrap(text, cols) {
    var out = [];
    String(text == null ? '' : text).split('\n').forEach(function (para) {
      var words = para.split(/(\s+)/), line = '';
      words.forEach(function (w) {
        if (!w) return;
        if (/^\s+$/.test(w)) { if (line) line += ' '; return; }
        while (w.length > cols) { if (line) { out.push(line.replace(/\s+$/, '')); line = ''; } out.push(w.slice(0, cols)); w = w.slice(cols); }
        if ((line + w).length > cols && line.trim()) { out.push(line.replace(/\s+$/, '')); line = w; } else line += w;
      });
      out.push(line.replace(/\s+$/, ''));
    });
    return out.length ? out : [''];
  }
  // els → pages: [[{k, lines:[…], gap, num?, lh}]]; o = {multi, nums, lines, split, more, cont, autoCont, sceneCont}
  function paginate(els, o) {
    o = o || {};
    var L = o.lines || 54, multi = !!o.multi, letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', cont = o.cont || '(CONT’D)', more = o.more || '(MORE)';
    var lastAct = -1; (els || []).forEach(function (e, i) { if (e.type === 'act') lastAct = i; });
    // 1) blocks
    var blocks = [], sceneNo = 0, sceneSpk = '', sawAction = false, sp = null;
    var cueName = function (t) { return up(String(t || '').trim().replace(/\s*\(.*\)\s*$/, '')); };
    var isCont = function (t) { return /\(\s*cont['’]?d\s*\)|\(\s*continuing\s*\)/i.test(t || ''); };
    var closeSp = function () { if (sp) { blocks.push(sp); sp = null; } };
    (els || []).forEach(function (e, i) {
      var t = String(e.text || '').replace(/\s+$/, '');
      if (e.type === 'character') {
        closeSp(); var nm = cueName(t), cue = up(t.trim());
        if (o.autoCont && nm && nm === sceneSpk && sawAction && !isCont(cue)) cue = cue + ' ' + up(cont);
        sp = { k: 'speech', name: nm, cue: cue, items: [] }; sceneSpk = nm; sawAction = false; return;
      }
      if ((e.type === 'paren' || e.type === 'dialogue') && sp) { if (t.trim()) sp.items.push({ k: e.type, lines: wrap(t.trim(), COLS[e.type]), lh: e.type === 'dialogue' && multi ? 2 : (e.type === 'paren' && multi ? 2 : 1) }); return; }
      closeSp();
      if (!t.trim() && e.type !== 'act') return;
      if (e.type === 'heading') { sceneNo++; sceneSpk = ''; sawAction = false; blocks.push({ k: 'heading', lines: wrap(up(t.trim()), COLS.heading), gap: 2, num: o.nums ? (multi ? letters[(sceneNo - 1) % 26] + (sceneNo > 26 ? Math.floor((sceneNo - 1) / 26) : '') : String(sceneNo)) : '', scene: sceneNo }); return; }
      if (e.type === 'act') { sceneSpk = ''; blocks.push({ k: 'act', lines: [up(t.trim())], gap: 2, brk: /^END OF/i.test(t.trim()) && i !== lastAct }); return; }
      if (e.type === 'transition') { blocks.push({ k: 'transition', lines: [up(t.trim())], gap: 1 }); return; }
      if (e.type === 'paren' || e.type === 'dialogue') { blocks.push({ k: 'action', lines: wrap(t.trim(), COLS.action), gap: 1 }); return; }
      sawAction = true;
      blocks.push({ k: 'action', lines: wrap(multi ? up(t) : t, COLS.action), gap: 1 });
    });
    closeSp();
    // 2) pages
    var pages = [], page = [], used = 0, reserve = o.sceneCont ? 2 : 0, scene = 0, contN = {};
    var room = function () { return L - used - reserve; };
    var put = function (it) { page.push(it); used += (page.length > 1 ? it.gap : 0) + it.lines.length * (it.lh || 1); };
    var newPage = function (midScene) {
      if (midScene && o.sceneCont && page.length) page.push({ k: 'contbot', lines: ['(CONTINUED)'], gap: 1 });
      pages.push(page); page = []; used = 0;
      if (midScene && o.sceneCont && scene) { contN[scene] = (contN[scene] || 1) + 1; put({ k: 'conttop', lines: ['CONTINUED: (' + contN[scene] + ')'], gap: 0 }); }
    };
    var gapOf = function (b) { return page.length ? b.gap : 0; };
    blocks.forEach(function (b, bi) {
      var next = blocks[bi + 1];
      if (b.k === 'heading') {
        scene = b.scene;
        var nextMin = next ? (next.k === 'speech' ? 3 : Math.min(2, (next.lines || []).length)) + (next.gap || 1) : 0;
        if (gapOf(b) + b.lines.length + nextMin > room() && page.length) newPage(false);
        put({ k: 'heading', lines: b.lines, gap: b.gap, num: b.num });
        return;
      }
      if (b.k === 'act' || b.k === 'transition') {
        if (gapOf(b) + b.lines.length > room() && page.length) newPage(false);
        put({ k: b.k, lines: b.lines, gap: b.gap });
        if (b.brk) newPage(false);
        return;
      }
      if (b.k === 'action') {
        var lines = b.lines.slice(), g = b.gap;
        while (lines.length) {
          var av = room() - (page.length ? g : 0);
          if (lines.length <= av) { put({ k: 'action', lines: lines, gap: g }); break; }
          if (av >= 2 && lines.length - av >= 2) { put({ k: 'action', lines: lines.slice(0, av), gap: g }); lines = lines.slice(av); newPage(true); g = 0; continue; }
          if (!page.length) { put({ k: 'action', lines: lines.slice(0, Math.max(1, av)), gap: 0 }); lines = lines.slice(Math.max(1, av)); if (lines.length) newPage(true); continue; }
          newPage(true);
        }
        return;
      }
      // a speech: cue + parentheticals + dialogue
      var units = []; b.items.forEach(function (it) { it.lines.forEach(function (ln, li) { units.push({ k: it.k, text: ln, lh: it.lh, first: li === 0, item: it }); }); });
      var total = 1 + units.reduce(function (a, u) { return a + u.lh; }, 0);
      var gp = gapOf({ gap: 1 });
      if (gp + total <= room()) { put({ k: 'character', lines: [b.cue], gap: 1 }); emitUnits(units); return; }
      if (o.split !== false && page.length) {
        var av2 = room() - gp - 1 - 1, take = 0, h = 0;   // the cue and the (MORE) line
        while (take < units.length && h + units[take].lh <= av2) { h += units[take].lh; take++; }
        for (var bk = take; bk > Math.max(0, take - 4); bk--) { if (/[.!?…]["”’)]?$/.test(units[bk - 1].text) && units.slice(0, bk).filter(function (u) { return u.k === 'dialogue'; }).length >= 2) { take = bk; break; } }   // split at the end of a sentence when one is close
        while (take > 0 && units[take - 1].k === 'paren') { take--; h -= units[take].lh; }   // never end a page on a parenthetical
        var dlgTaken = units.slice(0, take).filter(function (u) { return u.k === 'dialogue'; }).length;
        if (dlgTaken >= 2 && units.length - take >= 1) {
          put({ k: 'character', lines: [b.cue], gap: 1 }); emitUnits(units.slice(0, take));
          put({ k: 'more', lines: [up(more)], gap: 0 });
          newPage(true);
          put({ k: 'character', lines: [isCont(b.cue) ? b.cue : b.name + ' ' + up(cont)], gap: 0 }); emitUnits(units.slice(take));
          return;
        }
      }
      if (page.length) newPage(true);
      put({ k: 'character', lines: [b.cue], gap: 0 }); emitUnits(units);
    });
    function emitUnits(us) {
      var cur = null;
      us.forEach(function (u) {
        if (!cur || cur.k !== u.k || (u.first && cur.src !== u.item)) { cur = { k: u.k, lines: [], gap: 0, lh: u.lh, src: u.item }; page.push(cur); }
        cur.lines.push(u.text); used += u.lh;
      });
    }
    if (page.length) pages.push(page);
    return pages.map(function (pg) { return pg.map(function (it) { return { k: it.k, lines: it.lines, gap: it.gap, num: it.num || '', lh: it.lh || 1 }; }); });
  }

  // ---------- Script files: Final Draft (.fdx), Fountain (.fountain), plain text ----------
  var FDX_OUT = { heading: 'Scene Heading', action: 'Action', character: 'Character', paren: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition' };
  var FDX_IN = { 'scene heading': 'heading', 'action': 'action', 'general': 'action', 'shot': 'action', 'character': 'character', 'parenthetical': 'paren', 'dialogue': 'dialogue', 'transition': 'transition',
    'new act': 'act', 'end of act': 'act', 'act break': 'act', 'cold opening': 'act', 'teaser': 'act', 'lyrics': 'dialogue', 'cast list': 'action' };
  function xesc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toFdx(els, meta) {
    meta = meta || {}; var L = ['<?xml version="1.0" encoding="UTF-8" standalone="no" ?>', '<FinalDraft DocumentType="Script" Template="No" Version="5">', '  <Content>'];
    var n = 0;
    (els || []).forEach(function (e) {
      var t = String(e.text || ''); if (!t.trim() && e.type !== 'act') return;
      var type = e.type === 'act' ? (/^END OF/i.test(t.trim()) ? 'End of Act' : 'New Act') : (FDX_OUT[e.type] || 'Action');
      var num = e.type === 'heading' && meta.nums !== false ? ' Number="' + (++n) + '"' : '';
      L.push('    <Paragraph Type="' + type + '"' + num + '>', '      <Text>' + xesc(t) + '</Text>', '    </Paragraph>');
    });
    L.push('  </Content>');
    if (meta.title || meta.show || meta.by) {
      L.push('  <TitlePage>', '    <Content>');
      [meta.show && meta.show.toUpperCase(), meta.title && '"' + meta.title + '"', meta.by && 'Written by', meta.by].filter(function (x) { return x; }).forEach(function (x) { L.push('      <Paragraph Alignment="Center" Type="Action">', '        <Text>' + xesc(x) + '</Text>', '      </Paragraph>'); });
      L.push('    </Content>', '  </TitlePage>');
    }
    L.push('</FinalDraft>');
    return L.join('\n');
  }
  // .fdx text → { els, title } (needs a DOMParser: the window, or a test's own)
  function fromFdx(xml, Parser) {
    var P = Parser || (typeof DOMParser !== 'undefined' ? DOMParser : null); if (!P) throw new Error('no xml');
    var doc = new P().parseFromString(String(xml || ''), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || !doc.getElementsByTagName('FinalDraft').length) throw new Error('not_fdx');
    var content = null, cs = doc.getElementsByTagName('Content');
    for (var i = 0; i < cs.length; i++) { var par = cs[i].parentNode; if (par && par.nodeName === 'FinalDraft') { content = cs[i]; break; } }
    if (!content) throw new Error('not_fdx');
    var out = [], ps = content.childNodes;
    for (var j = 0; j < ps.length; j++) {
      var pnode = ps[j]; if (pnode.nodeName !== 'Paragraph') continue;
      var type = String(pnode.getAttribute('Type') || 'Action').toLowerCase(), k = FDX_IN[type] || 'action';
      var texts = pnode.getElementsByTagName('Text'), t = '';
      for (var q = 0; q < texts.length; q++) t += texts[q].textContent;
      // dual dialogue: nested paragraphs inside <DualDialogue>
      var dd = pnode.getElementsByTagName('DualDialogue');
      if (dd.length) { var inner = dd[0].getElementsByTagName('Paragraph'); for (var r = 0; r < inner.length; r++) { var it = String(inner[r].getAttribute('Type') || '').toLowerCase(), tt = ''; var tx = inner[r].getElementsByTagName('Text'); for (var w = 0; w < tx.length; w++) tt += tx[w].textContent; if (tt.trim()) out.push({ type: FDX_IN[it] || 'action', text: tt.trim() }); } continue; }
      t = t.replace(/\s+$/, ''); if (!t.trim()) continue;
      if (k === 'heading' || k === 'character' || k === 'transition' || k === 'act') t = up(t.trim());
      out.push({ type: k, text: t });
    }
    var title = '', tp = doc.getElementsByTagName('TitlePage');
    if (tp.length) { var tt2 = tp[0].getElementsByTagName('Text'); for (var z = 0; z < tt2.length; z++) { var v = tt2[z].textContent.trim(); if (/^["“].*["”]$/.test(v)) { title = v.replace(/^["“]|["”]$/g, ''); break; } } }
    return { els: out, title: title };
  }
  // Fountain (and plain text) → { els, title }
  function fromFountain(text, cast) {
    var t = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
    var title = '';
    // the title page: "Key: value" lines at the very top, up to the first blank line
    var m = t.match(/^((?:[A-Za-z][A-Za-z ]*:[^\n]*\n(?:[ \t]+[^\n]*\n)*)+)\n/);
    if (m && /^(title|credit|author|authors|source|draft date|date|contact|copyright|notes|revision)\s*:/im.test(m[1])) { var tm = m[1].match(/^title\s*:\s*(.*)$/im); if (tm) title = tm[1].replace(/[*_]/g, '').trim(); t = t.slice(m[0].length); }
    t = t.replace(/\/\*[\s\S]*?\*\//g, '')          // boneyard
      .replace(/\[\[[\s\S]*?\]\]/g, '')                // notes
      .replace(/^\s*#.*$/gm, '').replace(/^\s*=(?!=).*$/gm, '')   // sections, synopses
      .replace(/^(\s*@?[^\n]*?)\s*\^\s*$/gm, '$1')     // dual dialogue mark
      .replace(/(\*{1,3}|_)(\S(?:[^\n]*?\S)?)\1/g, '$2');  // *italic* **bold** _underline_
    return { els: splitPaste(t, 'action', cast), title: title };
  }
  // ---------- PDF scripts: text placed on pages → script lines ----------
  // pages = [{ w, h, items: [{ x, y, str, w }] }] in points (y from the bottom, as pdf.js gives them).
  // Industry layout (from the left text margin): action/heading 0", dialogue 1.0", parenthetical 1.6", character 2.2", transitions far right.
  function fromPdfLines(pages, cast) {
    var NUM = /^[A-Z]?\d{1,4}[A-Z]?\.?$/;
    var raw = [];
    (pages || []).forEach(function (pg, pi) {
      var items = (pg.items || []).filter(function (it) { return it.str && it.str.trim(); }).slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; });
      var lines = [];
      items.forEach(function (it) { var L0 = null; for (var i = 0; i < lines.length; i++) if (Math.abs(lines[i].y - it.y) < 2.5) { L0 = lines[i]; break; } if (!L0) { L0 = { y: it.y, parts: [] }; lines.push(L0); } L0.parts.push(it); });
      lines.sort(function (a, b) { return b.y - a.y; });
      lines.forEach(function (L0) { L0.parts.sort(function (a, b) { return a.x - b.x; }); raw.push({ page: pi, y: L0.y, parts: L0.parts, pw: pg.w || 612, ph: pg.h || 792 }); });
    });
    if (!raw.length) return [];
    // the action margin = the most common left edge among long lines
    var votes = {};
    raw.forEach(function (l) { var t = l.parts.map(function (p) { return p.str; }).join(''); if (t.length > 25) { var k = Math.round(l.parts[0].x / 3) * 3; votes[k] = (votes[k] || 0) + t.length; } });
    var LM = +(Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; })[0] || Math.min.apply(null, raw.map(function (l) { return l.parts[0].x; })));
    var lineTxt = function (parts) {
      var text = '', end = null;
      parts.forEach(function (p) { var cw = p.str.length ? (p.w || p.str.length * 7.2) / p.str.length : 7.2; if (end != null && p.x - end > cw * 0.6) text += ' '.repeat(Math.max(1, Math.round((p.x - end) / cw))); text += p.str; end = p.x + (p.w || p.str.length * 7.2); });
      return text.replace(/\s+$/, '');
    };
    // lines with their position; scene numbers in the margins and page furniture dropped
    var lines = [];
    raw.forEach(function (l) {
      var parts = l.parts.filter(function (p) { var t = p.str.trim(); return !(NUM.test(t) && (p.x < LM - 8 || p.x > LM + 6.3 * 72)); });
      if (!parts.length) return;
      var text = lineTxt(parts).trim(), top = l.y > l.ph - 80, bottom = l.y < 60;
      if ((top || bottom) && /^(page\s*)?\d+\.?$/i.test(text)) return;                     // page numbers
      if (/^\(?\s*more\s*\)?$/i.test(text)) { lines.push({ more: true, page: l.page }); return; }
      if (/^\(?continued\)?$/i.test(text) || /^continued:?(\s*\(\d+\))?$/i.test(text)) return;   // scene continueds
      if (/^(revised|draft|blue|pink|yellow|green|goldenrod|buff|salmon|cherry)\b.*\d{1,2}\/\d{1,2}\/\d{2,4}$/i.test(text) && top) return;  // revision headers
      lines.push({ page: l.page, y: l.y, x: parts[0].x, rel: (parts[0].x - LM) / 72, xr: parts[parts.length - 1].x + (parts[parts.length - 1].w || 0), text: text, pw: l.pw });
    });
    // a title page: the first page with nothing at the action margin
    var p0 = lines.filter(function (l) { return !l.more && l.page === 0; });
    if (p0.length && p0.length < 25 && !p0.some(function (l) { return Math.abs(l.rel) < 0.3 && l.text.length > 25 || HEAD.test(l.text); }) && lines.some(function (l) { return l.page > 0; })) lines = lines.filter(function (l) { return l.page !== 0; });
    // line spacing
    var gaps = []; for (var g = 1; g < lines.length; g++) { var a = lines[g - 1], b = lines[g]; if (!a.more && !b.more && a.page === b.page) { var d = a.y - b.y; if (d > 4) gaps.push(d); } }
    gaps.sort(function (x, y) { return x - y; }); var LH = gaps.length ? gaps[Math.floor(gaps.length * 0.25)] : 12;
    // classify and join
    var out = [], prev = null, more = false, prevType = '';
    lines.forEach(function (l) {
      if (l.more) { more = true; return; }
      var r = l.rel, t = l.text, type;
      if (r < 0.5) type = 'A';
      else if (r < 1.3) type = /^\(/.test(t) ? 'paren' : 'dialogue';
      else if (r < 1.9) type = 'paren';
      else if (r < 3.3) type = ACT.test(t.trim()) ? 'act' : (isCaps(t) ? 'character' : 'dialogue');
      else type = (TRANS.test(t.trim()) || isCaps(t)) ? 'transition' : 'action';
      if (type === 'paren' && !/^\(/.test(t) && !(prev && prev.type === 'paren' && !/\)$/.test(prev.text))) type = 'dialogue';
      if (type === 'A') { var d0 = detect(t, 'action', prevType, cast, {}); type = d0 && (d0.type === 'heading' || d0.type === 'transition' || d0.type === 'act') ? d0.type : 'action'; if (type !== 'action') t = d0.text; }
      // a speech going on after (MORE): drop the repeated "NAME (CONT'D)"
      if (more && type === 'character' && prev && (prev.type === 'dialogue' || prev.type === 'paren')) {
        var nm = up(t).replace(/\s*\(.*\)\s*$/, ''), last = null;
        for (var q = out.length - 1; q >= 0; q--) if (out[q].type === 'character') { last = out[q].text.replace(/\s*\(.*\)\s*$/, ''); break; }
        if (nm === last) { more = false; prev.joinNext = true; prev.y = l.y; prev.page = l.page; return; }
      }
      more = false;
      var gap = prev && prev.page === l.page ? prev.y - l.y : (prev && prev.joinNext ? 0 : 999);
      var same = prev && prev.type === type && (type === 'dialogue' ? gap < LH * 2.4 : gap < LH * 1.5) && (type === 'action' || type === 'dialogue' || (type === 'paren' && !/\)$/.test(prev.text)) || (type === 'heading' && gap < LH * 1.2));
      if (prev && prev.joinNext && (type === 'dialogue' || type === 'paren') && (prev.type === 'dialogue' || prev.type === 'paren')) { if (type === prev.type) same = true; prev.joinNext = false; }
      if (same) { prev.text += ' ' + t.trim(); prev.y = l.y; prev.page = l.page; return; }
      var el = { type: type, text: (type === 'character' || type === 'heading' || type === 'transition' || type === 'act') ? up(t.trim()) : t.trim(), y: l.y, page: l.page };
      out.push(el); prev = el; prevType = type;
    });
    return out.map(function (e) { return { type: e.type, text: e.text.replace(/\s{2,}/g, ' ') }; });
  }
  // what kind of file is it?
  function fileKind(name, text) {
    var n = String(name || '').toLowerCase();
    if (/\.fdx$/.test(n) || /^\s*<\?xml[\s\S]{0,400}<FinalDraft/.test(text || '')) return 'fdx';
    if (/\.pdf$/.test(n)) return 'pdf';
    if (/\.(fountain|spmd)$/.test(n)) return 'fountain';
    return 'text';
  }

  var NAMES = { heading: 'Scene heading', action: 'Action', character: 'Character', paren: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition', act: 'Act break' };
  root.SCFormat = { fromPdfLines: fromPdfLines, toFdx: toFdx, fromFdx: fromFdx, fromFountain: fromFountain, fileKind: fileKind, paginate: paginate, wrap: wrap, COLS: COLS, detect: detect, splitPaste: splitPaste, castSet: castSet, capFirst: capFirst, nameKind: nameKind, NAMES: NAMES };
  if (typeof module !== 'undefined') module.exports = root.SCFormat;
})(typeof window !== 'undefined' ? window : globalThis);
