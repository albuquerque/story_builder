'use strict';

/** Image handling: save uploads into the game's data image folders. */

const fs = require('fs');
const path = require('path');
const { PATHS } = require('./config');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

/** Sanitise a filename to a safe, lowercase, .png/.jpg-preserving basename. */
function safeName(original) {
  const ext = (path.extname(original) || '.png').toLowerCase();
  let base = path.basename(original, path.extname(original));
  base = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) base = 'image';
  const okExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
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

/**
 * Save an uploaded buffer into a target folder ('story' or 'shard').
 * Returns the final basename stored (to reference from JSON).
 */
function saveImage(kind, originalName, buffer) {
  const dir = kind === 'shard' ? PATHS.shardImages : PATHS.images;
  ensureDir(dir);
  const name = uniqueName(dir, safeName(originalName));
  fs.writeFileSync(path.join(dir, name), buffer);
  return name;
}

/** Absolute path for previewing a stored image. */
function imagePath(kind, name) {
  const dir = kind === 'shard' ? PATHS.shardImages : PATHS.images;
  return path.join(dir, name);
}

function exists(kind, name) {
  return fs.existsSync(imagePath(kind, name));
}

module.exports = { saveImage, imagePath, exists, safeName };
