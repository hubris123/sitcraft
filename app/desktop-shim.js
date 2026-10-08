// Gives the screens the same window.claude API they used in the prototype, backed by the desktop app.
(function () {
  var D = window.sitcomDesktop; if (!D) return;
  var seq = 0, listeners = {};
  D.claude.onDelta(function (id, text) { var f = listeners[id]; if (f) f(text); });
  // While Claude is thinking (before any text), show that instead of a frozen "Getting ready"
  var phases = {};
  if (D.claude.onPhase) D.claude.onPhase(function (id, ph) { var f = phases[id]; if (f) f(ph); });
  window.claude = {
    use: function (name) {
      if (name === 'sample') return Promise.resolve({
        json: function (prompt, opts) {
          opts = opts || {};
          var id = 'c' + (++seq) + '_' + Date.now();
          if (typeof opts.onText === 'function') listeners[id] = function (text) { try { opts.onText({ text: text }); } catch (e) {} };
          if (typeof opts.onPhase === 'function') phases[id] = function (ph) { try { opts.onPhase(ph); } catch (e) {} };
          if (opts.signal) { if (opts.signal.aborted) D.claude.abort(id); else opts.signal.addEventListener('abort', function () { D.claude.abort(id); }, { once: true }); }
          return D.claude.json(id, prompt, { maxTokens: opts.maxTokens }).then(function (r) {
            delete listeners[id]; delete phases[id];
            if (r && r.ok) return r.json;
            var err = new Error((r && r.error && r.error.message) || 'Claude request failed');
            err.code = (r && r.error && r.error.code) || 'unavailable'; err.status = r && r.error && r.error.status;
            throw err;
          }, function (e) { delete listeners[id]; var err = new Error(String(e)); err.code = 'unavailable'; throw err; });
        }
      });
      // ChatGPT (only for joke punch-ups): same shape as Claude's json(); the abort/progress events are shared
      if (name === 'openai') return Promise.resolve({
        json: function (prompt, opts) {
          opts = opts || {};
          var id = 'o' + (++seq) + '_' + Date.now();
          if (typeof opts.onText === 'function') listeners[id] = function (text) { try { opts.onText({ text: text }); } catch (e) {} };
          if (typeof opts.onPhase === 'function') phases[id] = function (ph) { try { opts.onPhase(ph); } catch (e) {} };
          if (opts.signal) { if (opts.signal.aborted) D.claude.abort(id); else opts.signal.addEventListener('abort', function () { D.claude.abort(id); }, { once: true }); }
          return D.openai.json(id, prompt).then(function (r) {
            delete listeners[id]; delete phases[id];
            if (r && r.ok) { if (r.json && typeof r.json === 'object') r.json._model = r.model; return r.json; }
            var err = new Error((r && r.error && r.error.message) || 'ChatGPT request failed');
            err.code = (r && r.error && r.error.code) || 'unavailable'; err.status = r && r.error && r.error.status;
            throw err;
          }, function (e) { delete listeners[id]; var err = new Error(String(e)); err.code = 'unavailable'; throw err; });
        }
      });
      if (name === 'downloads') return Promise.resolve({
        save: function (o) { return D.saveFile(o.filename, o.data).then(function (r) { if (!r.ok) throw new Error(r.canceled ? 'Cancelled' : 'Could not save'); return r; }); }
      });
      return Promise.resolve(null);
    }
  };
})();
