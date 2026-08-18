// Boot sequence for the offline / Android app.
// 1. Seed the VFS from base-data.zip (first run) or restore a saved project.
// 2. Inject the app UI markup (extracted from the desktop index.html body).
// 3. Load the shared UI scripts (preview.js, mapeditor.js, app.js).
//
// This runs after the offline engine + api-adapter are ready.

(function () {
  'use strict';

  const SEED_FLAG = 'sb_seeded_v2';

  // Surface any unhandled error/rejection instead of leaving a blank screen.
  window.addEventListener('error', (e) => {
    try { console.error('window error', e.error || e.message); } catch (_) {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try {
      console.error('unhandled rejection', e.reason);
      const msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason);
      // Only alert for real failures, not benign share cancellations.
      if (!/cancel/i.test(msg)) alert('Something went wrong:\n' + msg);
    } catch (_) {}
  });

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
      try {
        await window.SBEngine.importProjectZip(f);
        window.__SB_STORE.clear();
        location.reload();
      } catch (err) {
        alert('Could not import that project zip:\n' + (err && err.message ? err.message : err));
      }
    });
    document.getElementById('obSaveProj').addEventListener('click', (ev) =>
      runBusy(ev.currentTarget, 'Saving…', async () => {
        await saveVfsToIDB();
        const blob = await window.SBEngine.exportProjectZip();
        await downloadOrShare(blob, 'story-project.zip');
      }));
    document.getElementById('obExportPack').addEventListener('click', (ev) =>
      runBusy(ev.currentTarget, 'Exporting…', async () => {
        const model = window.__SB_STORE.get();
        const v = window.SBEngine.validate(model);
        if (!v.ok) { alert('Please fix problems first:\n' + v.errors.join('\n')); return; }
        const blob = await window.SBEngine.exportContentPackZip(model);
        await saveVfsToIDB();
        await downloadOrShare(blob, 'content-pack.zip');
      }));
  }

  // Run an async task with a button busy state; surface any error as an alert
  // (so a failure never leaves the app on a blank screen).
  async function runBusy(btn, label, task) {
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = label; }
    try {
      await task();
    } catch (err) {
      console.error(err);
      alert('Something went wrong:\n' + (err && err.message ? err.message : err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    }
  }

  function isNative() {
    const cap = window.Capacitor;
    return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  }

  async function downloadOrShare(blob, filename) {
    try {
      if (isNative()) {
        await saveAndShareNative(blob, filename);
        return;
      }
    } catch (e) {
      alert('Could not save the file: ' + (e && e.message ? e.message : e));
      return; // never fall through to a WebView navigation on native
    }
    // Real browser (desktop) fallback: trigger a normal download.
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    } catch (e) {
      alert('Download failed: ' + (e && e.message ? e.message : e));
    }
  }

  // Write the blob to the app's cache dir and open the Android share sheet.
  async function saveAndShareNative(blob, filename) {
    const cap = window.Capacitor;
    const Filesystem = cap.Plugins && cap.Plugins.Filesystem;
    const Share = cap.Plugins && cap.Plugins.Share;
    if (!Filesystem) throw new Error('Filesystem plugin unavailable');

    const base64 = await blobToBase64(blob);
    // Directory.Cache = 'CACHE'
    const res = await Filesystem.writeFile({ path: filename, data: base64, directory: 'CACHE', recursive: true });
    const fileUri = (res && res.uri) ? res.uri : null;
    if (Share && fileUri) {
      try {
        await Share.share({ title: filename, text: filename, url: fileUri });
        return;
      } catch (e) {
        // User dismissed the sheet, or share not possible — that's fine.
        if (String(e && e.message || e).toLowerCase().includes('cancel')) return;
      }
    }
    alert('Saved to app storage:\n' + (fileUri || filename));
  }

  // Memory-safe base64 (chunked) — avoids call-stack limits on large blobs.
  async function blobToBase64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
    }
    return btoa(binary);
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
