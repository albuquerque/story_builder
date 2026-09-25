'use strict';

/** Image handling: save uploads into the game's data image folders. */

const fs = require('fs');
const path = require('path');
const { PATHS } = require('./config');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

/** Sanitise a filename to a safe, lowercase, extension-preserving basename. */
function safeName(original, kind) {
  const ext = (path.extname(original) || '.png').toLowerCase();
  let base = path.basename(original, path.extname(original));
  base = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) base = (kind === 'voice') ? 'voice' : 'image';
  const allowed = (kind === 'voice')
    ? ['.ogg', '.mp3', '.wav']
    : ['.png', '.jpg', '.jpeg', '.webp'];
  const fallback = (kind === 'voice') ? '.ogg' : '.png';
  const okExt = allowed.includes(ext) ? ext : fallback;
  return base + okExt;
}

/** Avoid clobbering: if name exists, append _2, _3, ... */
function uniqueName(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  let i = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}_${i}${ext}`;
    i++;
  }
  return candidate;
}

function dirFor(kind) {
  if (kind === 'shard') return PATHS.shardImages;
  if (kind === 'voice') return PATHS.voice;
  return PATHS.images;
}

/**
 * Save an uploaded buffer into a target folder ('story', 'shard' or 'voice').
 * Returns the final basename stored (to reference from JSON).
 */
function saveImage(kind, originalName, buffer) {
  const dir = dirFor(kind);
  ensureDir(dir);
  const name = uniqueName(dir, safeName(originalName, kind));
  fs.writeFileSync(path.join(dir, name), buffer);
  return name;
}

/** Absolute path for previewing a stored asset. */
function imagePath(kind, name) {
  return path.join(dirFor(kind), name);
}

function exists(kind, name) {
  return fs.existsSync(imagePath(kind, name));
}

module.exports = { saveImage, imagePath, exists, safeName };
