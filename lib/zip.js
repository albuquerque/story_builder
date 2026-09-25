'use strict';

/** Build a downloadable content-pack zip from the working model. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const { PATHS } = require('./config');
const { generate } = require('./generator');

/**
 * Generate the full data set into a temp staging dir, copy referenced images,
 * and stream a zip to the given HTTP response.
 */
function streamZip(model, res) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pack-'));
  const stagingData = path.join(staging, 'data');
  fs.mkdirSync(stagingData, { recursive: true });

  // Generate JSON + PO (preserve existing UI/other keys from the game data).
  generate(model, stagingData, { poSourceRoot: PATHS.data });

  // Copy referenced images into the pack.
  copyReferencedImages(model, stagingData);

  // README with import instructions.
  fs.writeFileSync(path.join(staging, 'README.txt'), README, 'utf8');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="content-pack.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { throw err; });
  archive.pipe(res);
  // Put data/ at the archive root so it maps directly onto the project.
  archive.directory(stagingData, 'data');
  archive.file(path.join(staging, 'README.txt'), { name: 'README.txt' });
  archive.finalize().then(() => {
    // Best-effort cleanup after the stream ends.
    res.on('close', () => fs.rmSync(staging, { recursive: true, force: true }));
  });
}

function copyReferencedImages(model, stagingData) {
  const storyDir = path.join(stagingData, 'images', 'story_content');
  const shardDir = path.join(stagingData, 'images', 'shards');
  const voiceDir = path.join(stagingData, 'audio', 'story_content');
  fs.mkdirSync(storyDir, { recursive: true });
  fs.mkdirSync(shardDir, { recursive: true });
  fs.mkdirSync(voiceDir, { recursive: true });

  for (const c of (model.chapters || [])) {
    if (c.image) copyIfExists(path.join(PATHS.images, c.image), path.join(storyDir, c.image));
    for (const lv of (c.levels || [])) {
      for (const d of (lv.dialogue || [])) {
        if (d.image) copyIfExists(path.join(PATHS.images, d.image), path.join(storyDir, d.image));
        if (d.voice) copyIfExists(path.join(PATHS.voice, d.voice), path.join(voiceDir, d.voice));
      }
    }
  }
  for (const s of (model.shards || [])) {
    const art = basenameIfLocal(s.art_asset);
    if (art) copyIfExists(path.join(PATHS.shardImages, art), path.join(shardDir, art));
    const sil = basenameIfLocal(s.silhouette_asset);
    if (sil) copyIfExists(path.join(PATHS.shardImages, sil), path.join(shardDir, sil));
  }
}

function basenameIfLocal(asset) {
  if (!asset) return '';
  if (asset.startsWith('http')) return '';
  // res://data/images/shards/<name> or a bare filename
  const b = String(asset).split('/').pop();
  return b || '';
}

function copyIfExists(src, dst) {
  try { if (fs.existsSync(src)) fs.copyFileSync(src, dst); } catch (e) { /* ignore */ }
}

const README = [
  'Story Builder — Content Pack',
  '============================',
  '',
  'This zip contains a partial "data" folder holding ONLY this content pack\'s',
  'files (story flow, narrative stages, levels, cards, gallery items, narrative',
  'translations, and referenced images/audio).',
  '',
  'IMPORTANT — apply it as an OVERLAY (merge), never a full-folder replace:',
  '',
  '  ✅ DO:   Copy the CONTENTS of this "data" folder INTO the project\'s existing',
  '          "data" folder, letting matching files be overwritten and leaving all',
  '          other files untouched.',
  '',
  '            # macOS / Linux:',
  '            cp -R data/. <project>/data/',
  '            # (the trailing /. merges contents without deleting siblings)',
  '',
  '  ❌ DON\'T: Delete or replace the whole "data" folder. Doing so removes',
  '          app-level assets this pack does NOT include — board themes',
  '          (data/themes/), reward container visuals (data/reward_containers/),',
  '          reward profiles, and the UI translations (data/translations/core/).',
  '',
  'This pack NEVER contains those app-level files by design. See',
  'data/content_packs/isabella/pack.json for the exact list of files it owns.',
  '',
  'After copying, open the project in Godot ONCE so it imports any new images',
  '(Godot regenerates the .import files automatically).',
].join('\n');

module.exports = { streamZip };
