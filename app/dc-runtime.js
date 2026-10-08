/* SitCraft — desktop runtime for the app's screen files (.dc.html).
 * Each screen is an HTML template with {{holes}}, <sc-for>, <sc-if>, <dc-import>, <helmet>
 * plus a `class Component extends DCLogic { renderVals() {...} }` script.
 * This renders them with Preact so the same screen files run in the desktop app.
 */
(function () {
  'use strict';
  var P = window.preact, h = P.h;

  // ---------- Logic base class ----------
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var v = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    if (v) Object.assign(this.state, v);
    if (this.__host) this.__host.schedule();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__host) this.__host.schedule(); };

  // ---------- Hole lookup ----------
  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;
  function lookup(scope, path) {
    if (path === 'true') return true; if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return parseFloat(path);
    var parts = path.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  // Returns a function scope → value. A value that is exactly one hole keeps its type (functions, objects, booleans).
  function compileValue(str) {
    var m = str.match(/^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/);
    if (m) { var p = m[1]; return function (s) { return lookup(s, p); }; }
    if (str.indexOf('{{') < 0) return function () { return str; };
    var parts = [], last = 0; str.replace(HOLE, function (all, p, idx) { parts.push(str.slice(last, idx)); parts.push({ p: p }); last = idx + all.length; return all; });
    parts.push(str.slice(last));
    return function (s) { var out = ''; for (var i = 0; i < parts.length; i++) { var x = parts[i]; if (typeof x === 'string') out += x; else { var v = lookup(s, x.p); out += v == null ? '' : v; } } return out; };
  }

  // ---------- Attribute mapping ----------
  var RENAME = { 'class': 'class', readonly: 'readOnly', tabindex: 'tabIndex', maxlength: 'maxLength', colspan: 'colSpan', rowspan: 'rowSpan', autocomplete: 'autocomplete', spellcheck: 'spellcheck', 'for': 'for' };
  var TEXTLIKE = { text: 1, search: 1, email: 1, url: 1, tel: 1, password: 1, number: 1, range: 1, '': 1 };

  function compileAttrs(el) {
    var tag = el.tagName.toLowerCase(), list = [];
    var inputType = tag === 'input' ? (el.getAttribute('type') || '') : null;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i], name = a.name;
      if (name.indexOf('hint-') === 0) continue;
      var key = RENAME[name] || name;
      if (key.indexOf('on') === 0 && key.length > 2) {
        // The screens treat onChange like "every keystroke" for text fields
        if (key === 'onchange' && (tag === 'textarea' || (tag === 'input' && (TEXTLIKE[String(inputType).toLowerCase()] || /\{\{/.test(inputType))))) key = 'oninput';
      }
      list.push({ k: key, f: compileValue(a.value) });
    }
    return function (scope) {
      var props = {};
      for (var j = 0; j < list.length; j++) {
        var it = list[j], v = it.f(scope);
        if (it.k.indexOf('on') === 0) { if (typeof v === 'function') props[it.k] = v; continue; }
        if (it.k === 'ref') { if (typeof v === 'function') props.ref = v; continue; }
        if (v === false || v == null) { if (it.k === 'readOnly' || it.k === 'disabled' || it.k === 'checked') props[it.k] = false; continue; }
        if (it.k === 'readOnly' || it.k === 'disabled') { props[it.k] = v === true || v === 'true' || v === it.k; continue; }
        props[it.k] = v;
      }
      return props;
    };
  }

  // ---------- Template compiler ----------
  function compileChildren(nodes, ctx) {
    var fns = [];
    for (var i = 0; i < nodes.length; i++) { var f = compileNode(nodes[i], ctx); if (f) fns.push(f); }
    return function (scope) {
      var out = [];
      for (var k = 0; k < fns.length; k++) { var r = fns[k](scope); if (r == null || r === false) continue; if (Array.isArray(r)) out.push.apply(out, r); else out.push(r); }
      return out;
    };
  }
  function compileNode(node, ctx) {
    if (node.nodeType === 3) {
      var t = node.nodeValue; if (!t) return null;
      if (t.indexOf('{{') < 0) return function () { return t; };
      // Text keeps its surrounding spaces (e.g. "{{label}} <span>…" must stay "S3E5 “Media Blitz”")
      var tf = /^\{\{[^}]*\}\}$/.test(t) ? compileValue(t) : compileValue('\u0000' + t + '\u0000');
      return function (s) { var v = tf(s); v = v == null ? '' : String(v); return v.replace(/\u0000/g, ''); };
    }
    if (node.nodeType !== 1) return null;
    var tag = node.tagName.toLowerCase();
    if (tag === 'helmet') { ctx.helmet.push(node.innerHTML); return null; }
    if (tag === 'script') return null;
    if (tag === 'sc-for') {
      var lf = compileValue(node.getAttribute('list') || ''), as = node.getAttribute('as') || 'item';
      var body = compileChildren(templateKids(node), ctx);
      return function (scope) {
        var arr = lf(scope); if (!arr || !arr.length) return null;
        var out = [];
        for (var i = 0; i < arr.length; i++) { var sc = Object.create(scope); sc[as] = arr[i]; var kids = body(sc); for (var j = 0; j < kids.length; j++) out.push(kids[j]); }
        return out;
      };
    }
    if (tag === 'sc-if') {
      var vf = compileValue(node.getAttribute('value') || '');
      var b2 = compileChildren(templateKids(node), ctx);
      return function (scope) { return vf(scope) ? b2(scope) : null; };
    }
    if (tag === 'dc-import') {
      var cname = node.getAttribute('name'), pf = [];
      for (var i = 0; i < node.attributes.length; i++) { var at = node.attributes[i]; if (at.name === 'name' || at.name.indexOf('hint-') === 0) continue; pf.push({ k: at.name, f: compileValue(at.value) }); }
      return function (scope) {
        var props = {}; for (var j = 0; j < pf.length; j++) props[pf[j].k] = pf[j].f(scope);
        return h(Host, { cname: cname, props: props, key: 'dc-' + cname });
      };
    }
    var af = compileAttrs(node), kids = compileChildren(templateKids(node), ctx);
    var isSvg = node.namespaceURI === 'http://www.w3.org/2000/svg';
    var realTag = isSvg ? node.tagName : tag;   // keep SVG case (e.g. linearGradient)
    return function (scope) { return h.apply(null, [realTag, af(scope)].concat(kids(scope))); };
  }
  function templateKids(node) { return node.content ? node.content.childNodes : node.childNodes; }

  // ---------- Registry ----------
  var REG = {};
  var injected = {};
  function inject(html) {
    if (!html || injected[html]) return; injected[html] = 1;
    var tpl = document.createElement('template'); tpl.innerHTML = html;
    Array.prototype.slice.call(tpl.content.childNodes).forEach(function (n) {
      if (n.nodeType !== 1) return;
      var t = n.tagName.toLowerCase();
      if (t === 'link' && /fonts\.(googleapis|gstatic)\.com/.test(n.getAttribute('href') || '')) return;   // fonts are bundled locally
      if (t === 'style' || t === 'link') document.head.appendChild(n.cloneNode(true));
    });
  }
  function register(name, src) {
    // src: { template: '<x-dc>…</x-dc> inner HTML', code: 'class Component extends DCLogic {…}' }
    var tpl = document.createElement('template'); tpl.innerHTML = src.template;
    var ctx = { helmet: [] };
    var render = compileChildren(tpl.content.childNodes, ctx);
    var Cls;
    try { Cls = new Function('DCLogic', src.code + '\n;return Component;')(DCLogic); }
    catch (e) { console.error('[dc] could not load ' + name, e); Cls = null; }
    REG[name] = { render: render, helmet: ctx.helmet.join('\n'), Cls: Cls };
  }

  // ---------- Host component ----------
  function Host(p) { P.Component.call(this, p); }
  Host.prototype = Object.create(P.Component.prototype); Host.prototype.constructor = Host;
  Host.prototype.ensure = function () {
    if (this.logic) return;
    var def = REG[this.props.cname];
    if (!def) { this.err = 'Missing screen: ' + this.props.cname; return; }
    inject(def.helmet);
    this.def = def;
    try { this.logic = new def.Cls(this.props.props || {}); } catch (e) { console.error('[dc] ' + this.props.cname + ' constructor', e); this.err = String(e && e.stack || e); return; }
    this.logic.props = this.props.props || {};
    this.logic.__host = this;
  };
  Host.prototype.schedule = function () {
    var self = this; if (this._q || this._dead) return; this._q = true;
    Promise.resolve().then(function () { self._q = false; if (!self._dead) self.forceUpdate(); });
  };
  Host.prototype.componentDidMount = function () { if (this.logic && this.logic.componentDidMount) { try { this.logic.componentDidMount(); } catch (e) { console.error('[dc] ' + this.props.cname + ' componentDidMount', e); } } };
  Host.prototype.componentWillUnmount = function () { this._dead = true; if (this.logic && this.logic.componentWillUnmount) { try { this.logic.componentWillUnmount(); } catch (e) { console.error(e); } } };
  Host.prototype.render = function () {
    this.ensure();
    if (this.err) return h('pre', { style: 'color:#f5a39b;padding:20px;white-space:pre-wrap;font:12px monospace' }, this.err);
    this.logic.props = this.props.props || {};
    var vals;
    try { vals = this.logic.renderVals(); } catch (e) { console.error('[dc] ' + this.props.cname + ' renderVals', e); return h('pre', { style: 'color:#f5a39b;padding:20px;white-space:pre-wrap;font:12px monospace' }, this.props.cname + ': ' + (e && e.stack || e)); }
    var kids = this.def.render(vals || {});
    return kids.length === 1 ? kids[0] : h(P.Fragment, null, kids);
  };

  window.DC = {
    register: register,
    mount: function (name, el, props) { P.render(h(Host, { cname: name, props: props || {} }), el); },
    DCLogic: DCLogic
  };
})();
