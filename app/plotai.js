// Plot parts with AI (Part 2): "✦ Fill in" (idea bank pop-up) and "✦ Sharpen" (Outline plot bar).
// Builds the request for Claude or ChatGPT, reads the reply into a tick list (empty parts ticked NEW, filled parts unticked
// with yours shown crossed out), and applies only the ticked parts.
// Never sends an actor's name or the "Attitude / Humor is like" fields (user rule) — those fields are left out, and any of
// those names typed elsewhere are replaced with "someone".
(function (root) {
  'use strict';
  var LK = function () { return root.SCLink; };
  var str = function (v) { return String(v == null ? '' : v).trim(); };
  var FAIL = function (code, who) {
    var co = who === 'ChatGPT' ? 'OpenAI' : 'Anthropic';
    var M = {
      no_key: who + ' isn’t set up on this device yet. Add it in App settings → AI.', not_granted: who + ' isn’t set up on this device yet. Add it in App settings → AI.',
      bad_model: 'No ChatGPT model is picked yet. Open App settings → AI → ChatGPT.', oa_proto: 'ChatGPT works in the SitCraft app (not in this preview).',
      needs_verify: 'OpenAI asks you to verify your organization first (OpenAI Platform → Settings → Organization).',
      no_credit: who + '’s account is out of credit. Add credits in the ' + (who === 'ChatGPT' ? 'OpenAI Platform (Settings → Billing)' : 'Claude Console (Billing)') + ', then try again.',
      rate_limited: who + ' is busy or your usage limit was reached. Wait a moment, then try again.',
      too_long: who + '’s reply was cut off. Try again.', refused: who + ' declined this request.',
      api_error: co + ' returned an error. Try again in a moment.', invalid_json: who + '’s reply couldn’t be read. Try again.',
      empty: who + ' didn’t suggest anything new. Try again, or type a few more parts first.',
      view_only: 'Viewing only — make this device primary to use AI here.', aborted: 'Stopped. Nothing was changed.'
    };
    return M[code] || 'Something went wrong. Nothing was changed.';
  };

  // ---------- which AI ----------
  function provider(d) { return (d && d.plotAI === 'openai') ? 'openai' : 'claude'; }
  function providers(d) {
    d = d || {}; var preview = !root.sitcomDesktop;
    return [
      { k: 'claude', label: 'Claude', ready: preview || d.claudeReady !== false, status: preview || d.claudeReady !== false ? '✓ connected' : 'not set up' },
      { k: 'openai', label: 'ChatGPT', ready: !preview && !!d.punchModel, status: preview ? 'in the app only' : (d.punchModel ? '✓ key set' : 'no key yet') }
    ];
  }
  function whoName(pv) { return pv === 'openai' ? 'ChatGPT' : 'Claude'; }

  // ---------- the show bible as plain lines (no actor names, no "is like") ----------
  function banned(bible) {
    var out = [];
    (bible || []).forEach(function (b) { ['actorName', 'attWho', 'attFrom', 'humorWho', 'humorFrom'].forEach(function (k) { var v = str(b[k]); if (v.length > 2) out.push(v); }); });
    return out.sort(function (a, b) { return b.length - a.length; });
  }
  function scrubber(bible) {
    var list = banned(bible).map(function (v) { return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    if (!list.length) return function (t) { return t; };
    var re = new RegExp('\\b(' + list.join('|') + ')\\b', 'gi');
    return function (t) { return String(t || '').replace(re, 'someone'); };
  }
  function bibleLines(bible, notes) {
    var L = [], B = bible || [];
    var premise = B.filter(function (b) { return b.kind === 'premise'; })[0];
    if (premise && str(premise.text)) L.push('Premise: ' + str(premise.text));
    notes = notes || {};
    if (str(notes.point)) L.push('The point of the series: ' + str(notes.point));
    if (str(notes.tone)) L.push('Tone & comedy voice: ' + str(notes.tone));
    var chars = B.filter(function (b) { return b.kind === 'char' && str(b.name); });
    if (chars.length) {
      L.push('Characters:');
      chars.forEach(function (c) {
        var bits = [c.tier, c.role].map(str).filter(function (v) { return v; }).join(' · ');
        L.push('* ' + str(c.name) + (str(c.aka) ? ' (also called ' + str(c.aka) + ')' : '') + (bits ? ' — ' + bits : ''));
        if (str(c.text)) L.push('  Who: ' + str(c.text));
        var tfw = [str(c.trait) && 'trait: ' + str(c.trait), str(c.flaw) && 'flaw: ' + str(c.flaw), str(c.want) && 'wants: ' + str(c.want)].filter(function (v) { return v; });
        if (tfw.length) L.push('  ' + tfw.join(' · '));
        if (str(c.speech)) L.push('  How they talk: ' + str(c.speech));
      });
    }
    var places = B.filter(function (b) { return b.kind === 'place' && str(b.name); });
    if (places.length) L.push('Locations: ' + places.map(function (p) { return str(p.name) + (str(p.text) ? ' (' + str(p.text).slice(0, 120) + ')' : ''); }).join('; '));
    var gags = B.filter(function (b) { return b.kind === 'gag' && str(b.name); });
    if (gags.length) L.push('Running gags: ' + gags.map(function (g) { return str(g.name); }).join('; '));
    return L;
  }

  // ---------- the request ----------
  // o = { mode: 'fill'|'sharpen', key, name (idea / plot), parts, bible, notes, showName, format, ep: { code, title, logline, others: [{key, name, parts}], scenes: [{n, act, title, summary, notes, jokes:[]}] } }
  function prompt(o) {
    var L0 = LK(), P = L0.PARTS, scrub = scrubber(o.bible), L = [];
    var sharpen = o.mode === 'sharpen';
    L.push('You are a veteran sitcom staff writer helping plan one plot of an episode.');
    L.push(sharpen ? 'SHARPEN this plot\'s parts so they fit THIS episode: make each part specific, funny and true to the characters; tighten vague parts; keep what already works.'
      : 'FILL IN the missing parts of this plot idea. Keep every part the writer already typed (you may suggest a sharper version of one if it clearly helps).');
    L.push('');
    L.push('=== THE SHOW ===');
    L.push('Title: ' + scrub(o.showName || 'Untitled show') + (o.format ? ' · ' + o.format : ''));
    bibleLines(o.bible, o.notes).forEach(function (x) { L.push(scrub(x)); });
    if (o.ep) {
      L.push('');
      L.push('=== THE EPISODE ===');
      L.push((o.ep.code || '') + ' “' + scrub(o.ep.title || '') + '”');
      if (str(o.ep.logline)) L.push('Logline: ' + scrub(o.ep.logline));
      (o.ep.others || []).forEach(function (x) {
        L.push('Other plot ' + x.key + ': ' + scrub(x.name || ''));
        L0.partsForPrompt(x.parts || x, '    ').forEach(function (l) { L.push(scrub(l)); });
      });
      if ((o.ep.scenes || []).length) {
        L.push('Scenes this plot is in (in running order):');
        o.ep.scenes.forEach(function (s) {
          L.push('  #' + s.n + ' [' + (s.act || '') + '] ' + scrub(s.title || '') + (str(s.summary) ? ' — ' + scrub(s.summary) : ''));
          if (str(s.notes)) L.push('     Writer\'s notes: ' + scrub(s.notes));
          (s.jokes || []).forEach(function (j) { if (str(j)) L.push('     Joke to use: ' + scrub(j)); });
        });
      }
    }
    L.push('');
    L.push('=== THIS PLOT (' + (o.key || '?') + ' plot) ===');
    L.push('Idea: ' + scrub(o.name || ''));
    var have = P.filter(function (x) { return !!L0.partText(o.parts, x.k); });
    if (have.length) { L.push('Parts the writer already has:'); L0.partsForPrompt(o.parts, '  ').forEach(function (l) { L.push(scrub(l)); }); }
    var miss = P.filter(function (x) { return !L0.partText(o.parts, x.k); }).map(function (x) { return x.label; });
    if (miss.length) L.push('Missing parts: ' + miss.join(', ') + '.');
    L.push('');
    L.push('The parts, in story order: Who (who the story is about) · Want (what they want deep down) · Goal (what they try to get THIS episode) · Obstacle (Act I: what stands in the way) · Plan (Act I: how they plan to get past it) · Complications (Act II: how the plan goes wrong, getting bigger each time) · Final obstacle (Act III: the biggest wall, at the worst moment) · Last resort (Act III: the desperate last move) · Result (win / lose / lose the goal but win the want) · Aftermath (the tag: what it leaves behind — optional).');
    L.push('Sitcom rules: small, everyday stakes; the character acts from their trait and flaw; things go wrong in character; nobody learns a big lesson; the world is back to normal by the end. Use the show\'s real character names. Keep each part to one or two short sentences.');
    L.push('');
    L.push('Reply with ONLY one JSON object, no other text:');
    L.push('{"parts": {"who": string, "want": string, "goal": string, "obstacle": string, "plan": string, "complications": string, "finalObstacle": string, "lastResort": string, "resultKind": "win" | "mixed" | "lose", "result": a short note on how it ends, "aftermath": string or ""}, "why": one short sentence on the idea behind your version}');
    L.push(sharpen ? 'Give every part (a sharper version, or the same text when it already works).' : 'Give every part: for parts the writer already has, repeat their text unless you have a clearly better version.');
    return L.join('\n');
  }

  // ---------- the reply → the tick list ----------
  function cleanReply(json) {
    var L0 = LK(), p = (json && typeof json === 'object' && json.parts && typeof json.parts === 'object') ? json.parts : (json || {}), o = {};
    L0.PARTS.forEach(function (x) { var v = str(p[x.k]); if (v) o[x.k] = v; });
    var rk = str(p.resultKind).toLowerCase();
    if (/^lose the goal|mixed/.test(rk)) rk = 'mixed'; else if (/^win/.test(rk)) rk = 'win'; else if (/^lose/.test(rk)) rk = 'lose'; else rk = '';
    if (rk) o.resultKind = rk;
    return o;
  }
  function rows(cur, sug) {
    var L0 = LK(); cur = cur || {};
    return L0.PARTS.map(function (x) {
      var mine = L0.partText(cur, x.k), theirs = L0.partText(sug, x.k);
      if (!theirs) return null;
      if (mine && mine.replace(/\s+/g, ' ').toLowerCase() === theirs.replace(/\s+/g, ' ').toLowerCase()) return null;
      return { k: x.k, label: x.label, act: x.act, mine: mine, sug: theirs, isNew: !mine, tick: !mine };
    }).filter(function (r) { return r; });
  }
  // the parts after "Use the ticked parts" — only ticked rows change
  function apply(cur, sug, ticked) {
    var out = Object.assign({}, cur || {});
    (ticked || []).forEach(function (k) {
      if (k === 'result') { if (sug.resultKind) out.resultKind = sug.resultKind; else delete out.resultKind; out.result = sug.result || ''; }
      else if (sug[k]) out[k] = sug[k];
    });
    return out;
  }

  // ---------- the call ----------
  function ask(pv, text, onProgress, signal) {
    var who = whoName(pv), say = function (m) { if (onProgress) try { onProgress(m); } catch (e) {} };
    say('Getting ' + who + ' ready…');
    var use = pv === 'openai' ? (root.sitcomDesktop ? root.claude.use('openai') : Promise.reject({ code: 'oa_proto' })) : ((root.claude && root.claude.use) ? root.claude.use('sample') : Promise.resolve(null));
    return use.then(function (ai) {
      if (!ai) throw { code: 'unavailable' };
      return ai.json(text, { modelTier: 'complex', signal: signal, cache: false, maxTokens: 4000,
        onPhase: function () { say(who + ' is thinking…'); },
        onText: function (u) { say(who + ' is writing…' + (u && u.text ? ' (' + Math.round(u.text.length / 10) * 10 + ' characters)' : '')); } });
    }).then(function (r) { if (!r || typeof r !== 'object') throw { code: 'invalid_json' }; return r; })
      .catch(function (e) { var code = (e && e.code) || ''; if (signal && signal.aborted) code = 'aborted'; throw { code: code, msg: FAIL(code, who) }; });
  }

  root.SCPlotAI = { provider: provider, providers: providers, whoName: whoName, bibleLines: bibleLines, scrubber: scrubber, prompt: prompt, cleanReply: cleanReply, rows: rows, apply: apply, ask: ask, fail: FAIL };
})(typeof window !== 'undefined' ? window : globalThis);
