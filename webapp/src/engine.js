// Browser-side engine wrapper. Uses the shared lib (engine-lib.js) over the VFS
// (vfs.js) plus JSZip for import/export. Exposes window.SBEngine.
//
// Data root in the VFS is "/data". Images are stored in the VFS as Uint8Array
// under /data/images/... and previewed via object URLs.

(function () {
  'use strict';

  // Tell config.js where the (virtual) project + data roots are.
  globalThis.SB_ROOT = '/project';
  globalThis.SB_DATA_ROOT = '/data';

  const vfs = window.SB.vfs;
  const req = window.SB.requireLib;

  // Lazily resolve lib modules (after engine-lib.js registered them).
  function lib() {
    return {
      reader: req('/lib/reader'),
      generator: req('/lib/generator'),
      validate: req('/lib/validate'),
      config: req('/lib/config'),
    };
  }

  // ── Object-URL cache for image previews ────────────────────────────────────
  const urlCache = new Map();  // vfs path -> objectURL
  // Image paths added by the author on THIS device (uploads). The lean content
  // pack includes only these (seed images already exist in the game repo).
  const userImagePaths = loadUserImagePaths();
  function loadUserImagePaths() {
    try { return new Set(JSON.parse(localStorage.getItem('sb_user_images') || '[]')); }
    catch (e) { return new Set(); }
  }
  function saveUserImagePaths() {
    try { localStorage.setItem('sb_user_images', JSON.stringify(Array.from(userImagePaths))); }
    catch (e) { /* ignore */ }
  }
  function imageUrl(vfsPath) {
    if (!vfs.has(vfsPath)) return '';
    if (urlCache.has(vfsPath)) return urlCache.get(vfsPath);
    const bytes = vfs.get(vfsPath);
    const blob = new Blob([bytes], { type: guessMime(vfsPath) });
    const url = URL.createObjectURL(blob);
    urlCache.set(vfsPath, url);
    return url;
  }
  function guessMime(p) {
    const e = p.toLowerCase().split('.').pop();
    return e === 'jpg' || e === 'jpeg' ? 'image/jpeg'
      : e === 'webp' ? 'image/webp' : e === 'svg' ? 'image/svg+xml' : 'image/png';
  }
  // Image folders in the VFS
  const STORY_DIR = '/data/images/story_content';
  const SHARD_DIR = '/data/images/shards';
  function storyImagePath(name) { return STORY_DIR + '/' + name; }
  function shardImagePath(name) { return SHARD_DIR + '/' + name; }

  // ── Public API ──────────────────────────────────────────────────────────────
  const SBEngine = {
    // Read the current project model from the VFS data files.
    readProject() {
      return lib().reader.readProject();
    },

    // Generate all game data files from the model into the VFS /data.
    generate(model) {
      const { generator, config } = lib();
      return generator.generate(model, config.PATHS.data, { poSourceRoot: config.PATHS.data });
    },

    validate(model) {
      return lib().validate.validate(model);
    },

    options() {
      const { config } = lib();
      // Themes come from data/themes/themes.json if present in the VFS.
      let themes = ['legacy', 'modern'];
      try {
        const raw = vfs.get('/data/themes/themes.json');
        if (raw) {
          const j = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
          const names = Object.keys(j.themes || {});
          if (names.length) themes = names;
        }
      } catch (e) { /* ignore */ }
      return {
        difficulties: Object.keys(config.DIFFICULTY_PRESETS),
        rarities: config.RARITIES,
        shardCategories: config.SHARD_CATEGORIES,
        boosters: config.BOOSTER_TYPES,
        themes,
      };
    },

    // ── Images ──
    // Save an uploaded File/Blob into the VFS; returns the stored basename.
    async saveImage(kind, file) {
      const dir = kind === 'shard' ? SHARD_DIR : STORY_DIR;
      const name = uniqueName(dir, safeName(file.name || 'image.png'));
      const buf = new Uint8Array(await file.arrayBuffer());
      const full = dir + '/' + name;
      vfs.set(full, buf);
      userImagePaths.add(full);   // track author-added images for the lean pack
      saveUserImagePaths();
      return name;
    },
    imageUrlFor(kind, name) {
      return imageUrl((kind === 'shard' ? SHARD_DIR : STORY_DIR) + '/' + name);
    },

    // ── Project persistence (whole VFS) ──
    // Serialize the entire VFS to a project zip (Blob).
    async exportProjectZip() {
      const zip = new JSZip();
      for (const key of vfs.keys()) {
        const v = vfs.get(key);
        zip.file(key.replace(/^\//, ''), v); // strip leading slash
      }
      return zip.generateAsync({ type: 'blob' });
    },

    // Lean, re-importable project backup: the editable model + only the images
    // the author added. Small enough to zip/share on a phone without OOM.
    async exportLeanProject(model) {
      const zip = new JSZip();
      zip.file('story-project.json', JSON.stringify(model || {}, null, 2));
      const imgs = this.listUserImages();
      for (const p of imgs) zip.file('user-images/' + p.replace(/^\//, ''), vfs.get(p));
      zip.file('README.txt', 'Story Builder project backup.\nOpen the app and use "Import project" to load it.\n');
      return zip.generateAsync({ type: 'blob' });
    },
    // Returns the model from a lean project zip and restores its user images.
    async importLeanProject(blob) {
      const zip = await JSZip.loadAsync(blob);
      let modelJson = zip.file('story-project.json');
      if (!modelJson) return null; // not a lean project
      const model = JSON.parse(await modelJson.async('string'));
      for (const f of Object.values(zip.files)) {
        if (f.dir || !f.name.startsWith('user-images/')) continue;
        const p = '/' + f.name.slice('user-images/'.length);
        this.putUserImage(p, await f.async('uint8array'));
      }
      return model;
    },

    // Load a project zip (from a previous export) into the VFS.
    async importProjectZip(blob) {
      const zip = await JSZip.loadAsync(blob);
      vfs.clear();
      urlCache.clear();
      const entries = Object.values(zip.files).filter((f) => !f.dir);
      for (const f of entries) {
        const p = '/' + f.name;
        const isText = /\.(json|po|txt|md|csv|import|gd|cfg)$/i.test(p);
        vfs.set(p, isText ? await f.async('string') : await f.async('uint8array'));
      }
    },

    // ── Content-pack export (for dropping into the game) ──
    // By default this is LEAN: it includes all JSON/PO plus ONLY images the
    // author added on this device (not the seed images already in the game
    // repo). Pass { fullImages: true } to include every image (large).
    async exportContentPackZip(model, opts) {
      opts = opts || {};
      this.generate(model); // regenerate JSON/PO into the VFS
      const zip = new JSZip();
      let images = 0, skipped = 0;
      for (const key of vfs.keys()) {
        if (!key.startsWith('/data/')) continue;
        const isImage = /\.(png|jpe?g|webp|svg)$/i.test(key);
        if (isImage) {
          // Lean pack: include an image only if the author added it here.
          if (!opts.fullImages && !userImagePaths.has(key)) { skipped++; continue; }
          images++;
        }
        zip.file(key.replace(/^\//, ''), vfs.get(key));
      }
      zip.file('README.txt', CONTENT_PACK_README + '\n' +
        (skipped ? `\n(Note: ${skipped} unchanged seed image(s) were omitted to keep this small.\n` +
          `They already exist in the game project. ${images} new/edited image(s) included.)\n` : ''));
      return zip.generateAsync({ type: 'blob' });
    },

    // ── User-image persistence (small): only the images the author added,
    // keyed by VFS path. Avoids ever zipping the 60MB+ seed for storage. ──
    listUserImages() {
      const out = [];
      for (const p of userImagePaths) if (vfs.has(p)) out.push(p);
      return out;
    },
    getImageBytes(vfsPath) { return vfs.get(vfsPath); },
    putUserImage(vfsPath, bytes) {
      vfs.set(vfsPath, bytes);
      userImagePaths.add(vfsPath);
      saveUserImagePaths();
    },

    // ── Seed the VFS from a bundled base data zip (first run) ──
    async seedFromBaseZip(url) {
      const res = await fetch(url);
      if (!res.ok) return false;
      await this.importProjectZip(await res.blob());
      return true;
    },

    vfs, imageUrl,
  };

  // ── helpers ──
  function safeName(original) {
    const ext = (original.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
    let base = original.replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base) base = 'image';
    const okExt = ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext) ? ext : '.png';
    return base + okExt;
  }
  function uniqueName(dir, name) {
    const ext = (name.match(/\.[a-z0-9]+$/i) || [''])[0];
    const base = name.replace(/\.[a-z0-9]+$/i, '');
    let cand = name, i = 2;
    while (vfs.has(dir + '/' + cand)) { cand = `${base}_${i}${ext}`; i++; }
    return cand;
  }

  const CONTENT_PACK_README = [
    'Story Builder — Content Pack',
    '============================',
    '',
    'This zip contains a "data" folder that maps onto the game project.',
    '',
    'To apply it:',
    '  1. Copy the "data" folder into the root of the game project,',
    '     overwriting the existing data folder (make a backup first).',
    '  2. Open the project in Godot ONCE so it imports any new images.',
    '',
  ].join('\n');

  window.SBEngine = SBEngine;
})();
