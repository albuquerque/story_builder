'use strict';

/**
 * Story Builder server.
 *
 * Serves the browser UI and a small JSON API to edit the working model,
 * upload images, validate, save into the game's data/, and export a zip.
 *
 * Run:   npm start
 * Open:  http://localhost:3000   (desktop)
 *        http://<this-machine-ip>:3000   (phone on same Wi-Fi)
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const store = require('./lib/store');
const images = require('./lib/images');
const { validate } = require('./lib/validate');
const { generate } = require('./lib/generator');
const { streamZip } = require('./lib/zip');
const { PATHS, DIFFICULTY_PRESETS, RARITIES, SHARD_CATEGORIES, BOOSTER_TYPES } = require('./lib/config');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve stored images for preview.
app.get('/img/:kind/:name', (req, res) => {
  const { kind, name } = req.params;
  if (!['story', 'shard'].includes(kind)) return res.status(400).end();
  const p = images.imagePath(kind, path.basename(name));
  if (!images.exists(kind, path.basename(name))) return res.status(404).end();
  res.sendFile(p);
});

// Options / presets for the UI.
app.get('/api/options', (req, res) => {
  res.json({
    difficulties: Object.keys(DIFFICULTY_PRESETS),
    rarities: RARITIES,
    shardCategories: SHARD_CATEGORIES,
    boosters: BOOSTER_TYPES,
    themes: readThemeNames(),
    dataPath: PATHS.data,
  });
});

function readThemeNames() {
  try {
    const fs = require('fs');
    const p = require('path').join(PATHS.data, 'themes', 'themes.json');
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const names = Object.keys(j.themes || {});
      if (names.length) return names;
    }
  } catch (e) { /* ignore */ }
  return ['legacy', 'modern'];
}

// Get the whole working model.
app.get('/api/project', (req, res) => {
  res.json(store.get());
});

// Replace the whole working model (autosave from the UI).
app.put('/api/project', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid body' });
  const model = {
    meta: body.meta || { title: '', description: '' },
    chapters: Array.isArray(body.chapters) ? body.chapters : [],
    shards: Array.isArray(body.shards) ? body.shards : [],
  };
  store.set(model);
  res.json({ ok: true });
});

// Re-load from the game's data/ (discard local edits).
app.post('/api/reseed', (req, res) => {
  res.json(store.reseedFromGame());
});

// Upload an image. field: file; query: kind=story|shard
app.post('/api/upload', upload.single('file'), (req, res) => {
  const kind = req.query.kind === 'shard' ? 'shard' : 'story';
  if (!req.file) return res.status(400).json({ error: 'no file' });
  try {
    const name = images.saveImage(kind, req.file.originalname, req.file.buffer);
    res.json({ name, url: `/img/${kind}/${encodeURIComponent(name)}` });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Validate the current model.
app.get('/api/validate', (req, res) => {
  res.json(validate(store.get()));
});

// Save into the game's data/.
app.post('/api/save', async (req, res) => {
  const model = store.get();
  const result = validate(model);
  if (!result.ok) return res.status(400).json({ error: 'validation failed', ...result });
  try {
    const summary = generate(model, PATHS.data, { poSourceRoot: PATHS.data });
    // Try to import new images into Godot automatically so they show up in-game
    // without a manual reimport. Best-effort: succeeds only if `godot` is found.
    const imported = await tryGodotImport();
    res.json({
      ok: true, ...summary, warnings: result.warnings, dataPath: PATHS.data,
      imported,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Explicit "reimport in Godot" endpoint.
app.post('/api/reimport', async (req, res) => {
  const imported = await tryGodotImport();
  res.json({ ok: imported, imported });
});

// Run `godot --headless --import` in the project root. Returns true if a Godot
// binary was found and ran without error, false otherwise (silently skipped).
function tryGodotImport() {
  return new Promise((resolve) => {
    const candidates = process.env.GODOT_BIN
      ? [process.env.GODOT_BIN]
      : ['godot', 'godot4', '/Applications/Godot.app/Contents/MacOS/Godot'];
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) return resolve(false);
      const bin = candidates[i++];
      execFile(bin, ['--headless', '--import'], { cwd: PATHS.root, timeout: 180000 },
        (err) => {
          // Godot may exit non-zero even on success in some versions; treat
          // "binary ran" as good enough. ENOENT => try the next candidate.
          if (err && err.code === 'ENOENT') return tryNext();
          resolve(true);
        });
    };
    tryNext();
  });
}

// Export a zip content pack.
app.get('/api/export', (req, res) => {
  const model = store.get();
  try {
    streamZip(model, res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nStory Builder running:`);
  console.log(`  Desktop: http://localhost:${PORT}`);
  for (const url of lanUrls(PORT)) console.log(`  Phone:   ${url}`);
  console.log(`\nEditing data at: ${PATHS.data}\n`);
});

function lanUrls(port) {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(`http://${iface.address}:${port}`);
    }
  }
  return out;
}
