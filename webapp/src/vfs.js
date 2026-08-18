// Browser shims + in-memory virtual filesystem (VFS) so the Story Builder data
// engine (lib/*.js, written for Node) runs unchanged in the browser / Capacitor.
//
// The VFS is a flat map of absolute path -> content. Text files store strings;
// binary files (images) store Uint8Array. Directories are implicit.
//
// exposes: window.SB.vfs, window.SB.nodeShim (fs + path), window.SB.requireLib

(function () {
  'use strict';

  // ── Virtual filesystem ─────────────────────────────────────────────────────
  const files = new Map();   // path -> string | Uint8Array

  function norm(p) {
    // Collapse "//" and resolve simple "." segments; keep leading slash.
    const parts = String(p).split('/');
    const out = [];
    for (const seg of parts) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return '/' + out.join('/');
  }

  const vfs = {
    clear() { files.clear(); },
    set(p, content) { files.set(norm(p), content); },
    get(p) { return files.get(norm(p)); },
    has(p) { return files.has(norm(p)); },
    delete(p) { files.delete(norm(p)); },
    // All file paths (not directories)
    keys() { return Array.from(files.keys()); },
    // List immediate children names of a directory
    readdir(dir) {
      const d = norm(dir).replace(/\/?$/, '/');
      const names = new Set();
      for (const key of files.keys()) {
        if (key.startsWith(d)) {
          const rest = key.slice(d.length);
          const name = rest.split('/')[0];
          if (name) names.add(name);
        }
      }
      return Array.from(names);
    },
    entries() { return files; },
  };

  // ── path shim ───────────────────────────────────────────────────────────────
  const pathShim = {
    join(...parts) {
      return norm(parts.filter((x) => x != null && x !== '').join('/'));
    },
    dirname(p) {
      const n = norm(p);
      const i = n.lastIndexOf('/');
      return i <= 0 ? '/' : n.slice(0, i);
    },
    basename(p, ext) {
      let b = norm(p).split('/').pop() || '';
      if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length);
      return b;
    },
    extname(p) {
      const b = norm(p).split('/').pop() || '';
      const i = b.lastIndexOf('.');
      return i > 0 ? b.slice(i) : '';
    },
    resolve(...parts) { return norm(parts.join('/')); },
    sep: '/',
  };

  // ── fs shim (sync subset used by the engine) ────────────────────────────────
  const fsShim = {
    existsSync(p) {
      const n = norm(p);
      if (files.has(n)) return true;
      // treat as directory if any file lives under it
      const d = n.replace(/\/?$/, '/');
      for (const key of files.keys()) if (key.startsWith(d)) return true;
      return false;
    },
    mkdirSync() { /* directories are implicit in the VFS */ },
    writeFileSync(p, content) { files.set(norm(p), content); },
    readFileSync(p, enc) {
      const v = files.get(norm(p));
      if (v === undefined) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
      if (enc === 'utf8' || enc === 'utf-8') {
        return (typeof v === 'string') ? v : new TextDecoder().decode(v);
      }
      return v;
    },
    readdirSync(dir) { return vfs.readdir(dir); },
    copyFileSync(src, dst) {
      const v = files.get(norm(src));
      if (v !== undefined) files.set(norm(dst), v);
    },
    rmSync() { /* no-op for VFS */ },
    statSync(p) {
      const n = norm(p);
      const isFile = files.has(n);
      return { isFile: () => isFile, isDirectory: () => !isFile };
    },
  };

  // ── tiny CommonJS-style module system for the shared lib files ──────────────
  // Each lib module is registered as a factory(require, module, exports).
  const registry = new Map();   // id -> factory
  const cache = new Map();      // id -> exports

  function define(id, factory) { registry.set(id, factory); }

  function makeRequire(baseId) {
    return function req(spec) {
      if (spec === 'fs') return fsShim;
      if (spec === 'path') return pathShim;
      if (spec === 'archiver') throw new Error('archiver not available in browser');
      // Resolve relative lib path like './config' from baseId
      let id = spec;
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const baseDir = baseId.slice(0, baseId.lastIndexOf('/') + 1);
        id = norm(baseDir + spec).replace(/\.js$/, '');
      }
      id = id.replace(/\.js$/, '');
      if (cache.has(id)) return cache.get(id);
      const factory = registry.get(id) || registry.get('/lib/' + id.split('/').pop());
      if (!factory) throw new Error('Module not found: ' + spec + ' (id ' + id + ')');
      const module = { exports: {} };
      cache.set(id, module.exports);
      factory(makeRequire(id), module, module.exports);
      cache.set(id, module.exports);
      return module.exports;
    };
  }

  function requireLib(id) { return makeRequire('/lib/_root')(id); }

  window.SB = window.SB || {};
  window.SB.vfs = vfs;
  window.SB.path = pathShim;
  window.SB.fs = fsShim;
  window.SB.define = define;
  window.SB.requireLib = requireLib;
  window.SB._norm = norm;
})();
