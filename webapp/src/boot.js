// Boot sequence for the offline / Android app.
// 1. Seed the VFS from base-data.zip (first run) or restore a saved project.
// 2. Inject the app UI markup (extracted from the desktop index.html body).
// 3. Load the shared UI scripts (preview.js, mapeditor.js, app.js).
//
// This runs after the offline engine + api-adapter are ready.

(function () {
  'use strict';

  const SEED_FLAG = 'sb_seeded_v2';

  async function seedIfNeeded() {
    // Prefer a persisted VFS snapshot (IndexedDB). Else seed from base-data.zip.
    const restored = await restoreVfsFromIDB();
    if (restored) return;
    try {
      const ok = await window.SBEngine.seedFromBaseZip('base-data.zip');
      if (ok) { localStorage.setItem(SEED_FLAG, '1'); await saveVfsToIDB(); }
    } catch (e) {
      console.warn('Seed failed:', e);
    }
  }

  // ── IndexedDB persistence for the whole VFS (handles large image data) ──────
  const IDB_NAME = 'sb_vfs', IDB_STORE = 'kv', IDB_KEY = 'project_zip';
  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function saveVfsToIDB() {
    try {
      const blob = await window.SBEngine.exportProjectZip();
      const db = await idb();
      await new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(blob, IDB_KEY);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch (e) { console.warn('saveVfsToIDB failed', e); }
  }
  async function restoreVfsFromIDB() {
    try {
      const db = await idb();
      const blob = await new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const g = tx.objectStore(IDB_STORE).get(IDB_KEY);
        g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error);
      });
      if (blob) { await window.SBEngine.importProjectZip(blob); return true; }
    } catch (e) { console.warn('restoreVfsFromIDB failed', e); }
    return false;
  }
  window.__SB_saveVfs = saveVfsToIDB;

  async function injectBody() {
    const res = await fetch('app-body.html');
    const html = await res.text();
    document.getElementById('appRoot').innerHTML = html;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  function wireOfflineBar() {
    const bar = document.getElementById('offlineBar');
    bar.hidden = false;
    document.getElementById('obImport').addEventListener('click', () =>
      document.getElementById('obImportInput').click());
    document.getElementById('obImportInput').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      await window.SBEngine.importProjectZip(f);
      // Reset model store to re-read from imported VFS.
      window.__SB_STORE.clear();
      location.reload();
    });
    document.getElementById('obSaveProj').addEventListener('click', async () => {
      // Persist the whole VFS (images + data) to on-device storage, then also
      // let the user save a copy of the project zip.
      await saveVfsToIDB();
      const blob = await window.SBEngine.exportProjectZip();
      downloadOrShare(blob, 'story-project.zip');
    });
    document.getElementById('obExportPack').addEventListener('click', async () => {
      const model = window.__SB_STORE.get();
      const v = window.SBEngine.validate(model);
      if (!v.ok) { alert('Please fix problems first:\n' + v.errors.join('\n')); return; }
      const blob = await window.SBEngine.exportContentPackZip(model);
      await saveVfsToIDB();
      downloadOrShare(blob, 'content-pack.zip');
    });
  }

  async function downloadOrShare(blob, filename) {
    // Capacitor path (Android): write to app storage + Share sheet.
    const cap = window.Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.Filesystem) {
      try {
        const Filesystem = cap.Plugins.Filesystem;
        const Share = cap.Plugins.Share;
        const dataUrl = await blobToDataUrl(blob);
        const base64 = dataUrl.split(',')[1];
        // Directory.Cache = 'CACHE'
        const res = await Filesystem.writeFile({ path: filename, data: base64, directory: 'CACHE' });
        if (Share) await Share.share({ title: filename, url: res.uri });
        else alert('Saved to: ' + res.uri);
        return;
      } catch (e) { console.warn('native share failed, falling back', e); }
    }
    // Browser fallback: trigger a download.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function blobToDataUrl(blob) {
    return new Promise((resolve) => { const r = new FileReader(); r.onloadend = () => resolve(r.result); r.readAsDataURL(blob); });
  }

  (async function main() {
    await seedIfNeeded();
    await injectBody();
    wireOfflineBar();
    await loadScript('preview.js');
    await loadScript('mapeditor.js');
    await loadScript('app.js'); // app.js self-boots via its boot() call
  })();
})();
