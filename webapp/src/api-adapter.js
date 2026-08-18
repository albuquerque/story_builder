// Offline API adapter. When running without the Node server (Android / offline),
// this intercepts the app's fetch('/api/...') calls and serves them from the
// in-browser SBEngine + VFS. Also provides a global image-URL resolver.
//
// Load AFTER engine.js and BEFORE app.js.

(function () {
  'use strict';
  if (!window.SBEngine) throw new Error('engine.js must load first');

  const E = window.SBEngine;

  // Global image URL resolver used by app.js (falls back to server route if not
  // in offline mode). In offline mode we return object URLs from the VFS.
  window.__SB_IMG_URL = function (kind, name) {
    const url = E.imageUrlFor(kind, name);
    return url || '';
  };

  const origFetch = window.fetch.bind(window);

  function json(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  window.fetch = async function (input, init) {
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    const method = ((init && init.method) || 'GET').toUpperCase();
    const u = url.split('?')[0];
    const q = (url.split('?')[1] || '');

    try {
      if (u === '/api/options' && method === 'GET') {
        return json(Object.assign({ dataPath: '(on-device)', offline: true }, E.options()));
      }
      if (u === '/api/project' && method === 'GET') {
        return json(store.get());
      }
      if (u === '/api/project' && method === 'PUT') {
        const body = await readBody(init);
        store.set(body);
        return json({ ok: true });
      }
      if (u === '/api/reseed' && method === 'POST') {
        // Re-read from the VFS data files (whatever was imported/seeded).
        const m = E.readProject();
        store.set(m);
        return json(m);
      }
      if (u === '/api/validate' && method === 'GET') {
        return json(E.validate(store.get()));
      }
      if (u === '/api/save' && method === 'POST') {
        const m = store.get();
        const v = E.validate(m);
        if (!v.ok) return json(Object.assign({ error: 'validation failed' }, v), 400);
        const summary = E.generate(m);
        scheduleVfsSave();
        // On device there's no Godot import; the content pack handles it.
        return json(Object.assign({ ok: true, imported: false, offline: true, warnings: v.warnings }, summary));
      }
      if (u === '/api/upload' && method === 'POST') {
        const kind = /kind=shard/.test(q) ? 'shard' : 'story';
        const file = getUploadFile(init);
        if (!file) return json({ error: 'no file' }, 400);
        const name = await E.saveImage(kind, file);
        scheduleVfsSave();
        return json({ name, url: window.__SB_IMG_URL(kind, name) });
      }
      if (u === '/api/reimport' && method === 'POST') {
        return json({ ok: false, imported: false, offline: true });
      }
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }

    // Not an API route we handle — fall through (e.g. static assets).
    return origFetch(input, init);
  };

  // ── in-memory model store (mirrors the server's store.js) ──
  const STORAGE_KEY = 'sb_project_v2';
  const store = {
    _model: null,
    get() {
      if (this._model) return this._model;
      // Try localStorage snapshot, else read from VFS data.
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) { this._model = JSON.parse(raw); return this._model; }
      } catch (e) { /* ignore */ }
      this._model = E.readProject();
      this.save();
      return this._model;
    },
    set(m) { this._model = m; this.save(); return m; },
    save() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._model)); } catch (e) { /* quota */ }
    },
    clear() { this._model = null; try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} },
  };
  window.__SB_STORE = store;

  // Debounced VFS persistence (images + generated data) to IndexedDB.
  let vfsSaveTimer = null;
  function scheduleVfsSave() {
    if (typeof window.__SB_saveVfs !== 'function') return;
    clearTimeout(vfsSaveTimer);
    vfsSaveTimer = setTimeout(() => window.__SB_saveVfs(), 1500);
  }

  async function readBody(init) {
    if (!init || init.body == null) return null;
    if (typeof init.body === 'string') return JSON.parse(init.body);
    return null;
  }
  function getUploadFile(init) {
    if (init && init.body instanceof FormData) return init.body.get('file');
    return null;
  }
})();
