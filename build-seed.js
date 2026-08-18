#!/usr/bin/env node
'use strict';

/**
 * Build webapp/base-data.zip — a snapshot of the game's data/ folder used to
 * seed the Android/offline app on first run. Paths inside the zip are rooted at
 * "data/..." to match the VFS layout (/data/...).
 *
 * Excludes .import sidecars and .godot caches (not needed for authoring; the
 * game regenerates them). Includes JSON, PO, and image binaries.
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ROOT = path.resolve(__dirname, '..', '..');       // game project root
const DATA = path.join(ROOT, 'data');
const OUT = path.join(__dirname, 'webapp', 'base-data.zip');

// Only include what the authoring engine reads/needs.
const INCLUDE_DIRS = [
  'experience_flows', 'flow_step_definitions', 'levels', 'narrative_stages',
  'collections', 'translations/core', 'images/story_content', 'images/shards',
  'themes',
];
const INCLUDE_FILES = ['gallery_items.json', 'theme_container_mappings.json', 'container_selection_rules.json'];

function shouldSkip(p) {
  return p.endsWith('.import') || p.includes('/.godot/');
}

function addDir(archive, absDir, relBase) {
  if (!fs.existsSync(absDir)) return;
  for (const name of fs.readdirSync(absDir)) {
    const abs = path.join(absDir, name);
    const rel = path.posix.join(relBase, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) addDir(archive, abs, rel);
    else if (!shouldSkip(abs)) archive.file(abs, { name: rel });
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const output = fs.createWriteStream(OUT);
const archive = archiver('zip', { zlib: { level: 9 } });
archive.pipe(output);

for (const d of INCLUDE_DIRS) addDir(archive, path.join(DATA, d), path.posix.join('data', d));
for (const f of INCLUDE_FILES) {
  const abs = path.join(DATA, f);
  if (fs.existsSync(abs)) archive.file(abs, { name: path.posix.join('data', f) });
}

output.on('close', () => console.log(`Wrote ${path.relative(ROOT, OUT)} (${archive.pointer()} bytes)`));
archive.finalize();
