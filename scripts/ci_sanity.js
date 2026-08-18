'use strict';

/**
 * CI sanity check — runs WITHOUT the game data folder.
 *
 * Builds a tiny synthetic project entirely in memory (via the browser VFS +
 * shared engine), generates all data files, reads them back, and asserts the
 * chapters/levels round-trip. Also loads every lib module to catch syntax /
 * require errors.
 *
 * This proves the engine works end-to-end in a clean checkout (as it does in
 * the Android app), independent of the game's data/ folder.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Minimal browser-like globals so vfs.js / engine-lib.js load in Node ──────
global.window = global;
global.TextDecoder = require('util').TextDecoder;
global.TextEncoder = require('util').TextEncoder;
global.Blob = require('buffer').Blob;

const ROOT = path.resolve(__dirname, '..');

function loadFile(rel) {
  const file = path.join(ROOT, rel);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  \u2713 ${name}`); }
  else { failures++; console.log(`  \u2717 ${name}${detail ? ' \u2014 ' + detail : ''}`); }
}

function main() {
  // 1. Ensure the browser engine bundle exists (build it if missing).
  const bundle = path.join(ROOT, 'webapp', 'src', 'engine-lib.js');
  if (!fs.existsSync(bundle)) {
    console.log('  building engine bundle...');
    require('child_process').execFileSync('node', [path.join(ROOT, 'build-webapp.js')], { stdio: 'inherit' });
  }

  // 2. Load the VFS + engine bundle.
  loadFile('webapp/src/vfs.js');
  loadFile('webapp/src/engine-lib.js');

  // 3. Point the engine at an in-memory data root.
  global.SB_ROOT = '/project';
  global.SB_DATA_ROOT = '/data';

  const reader = window.SB.requireLib('/lib/reader');
  const generator = window.SB.requireLib('/lib/generator');
  const validate = window.SB.requireLib('/lib/validate');
  const config = window.SB.requireLib('/lib/config');

  ok('engine modules load', !!(reader.readProject && generator.generate && validate.validate));
  ok('data root is virtual', config.PATHS.data === '/data', config.PATHS.data);

  // 4. Build a tiny synthetic project model (2 chapters, 3 levels total).
  const model = {
    meta: { title: 'CI Test Story', description: 'synthetic', mapScreenBackground: '' },
    chapters: [
      {
        title: 'Chapter One', description: 'first',
        mapBackground: '', mapThemeColor: '#3D5A80',
        completionReward: { coins: 100, gems: 5, booster: '', boosterAmount: 1 },
        levels: [
          {
            title: 'Level 1', description: 'l1', image: '',
            dialogue: [{ text: 'Hello world.', duration: 4 }],
            difficulty: 'easy', targetScore: null, rarity: 'common',
            rewards: { coins: 50, gems: 0, booster: '', boosterAmount: 1 },
            mapNode: { x: 200, y: 300 },
          },
          {
            title: 'Level 2', description: 'l2', image: '',
            dialogue: [{ text: 'Second screen.', duration: 3 }],
            difficulty: 'medium', targetScore: 4000, rarity: 'rare',
            rewards: { coins: 75, gems: 2, booster: 'bomb', boosterAmount: 1 },
            mapNode: { x: 400, y: 350 },
          },
        ],
      },
      {
        title: 'Chapter Two', description: 'second',
        mapBackground: '', mapThemeColor: '#D4A574',
        completionReward: { coins: 0, gems: 0, booster: '', boosterAmount: 1 },
        levels: [
          {
            title: 'Level 3', description: 'l3', image: '',
            dialogue: [{ text: 'The end.', duration: 4 }],
            difficulty: 'hard', targetScore: null, rarity: 'legendary',
            rewards: { coins: 100, gems: 10, booster: '', boosterAmount: 1 },
            mapNode: { x: 360, y: 450 },
          },
        ],
      },
    ],
    shards: [
      { name: 'Relic', rarity: 'rare', category: 'artifacts', shards_required: 9, art_asset: '', silhouette_asset: '' },
    ],
  };

  // 5. Validate the synthetic model.
  const v = validate.validate(model);
  ok('synthetic model validates (no errors)', v.errors.length === 0, v.errors.join('; '));

  // 6. Generate all data files into the VFS.
  const summary = generator.generate(model, config.PATHS.data, { poSourceRoot: config.PATHS.data });
  ok('generate reports counts', summary.chapters === 2 && summary.levels === 3, JSON.stringify(summary));

  // 7. Key files were written.
  const vfs = window.SB.vfs;
  ok('flow written', vfs.has('/data/experience_flows/main_story.json'));
  ok('world map written', vfs.has('/data/levels/world_map.json'));
  ok('level_01 written', vfs.has('/data/levels/level_01.json'));
  ok('narrative isabella_01 written', vfs.has('/data/narrative_stages/isabella_01.json'));
  ok('collection written', vfs.has('/data/collections/isabella_journey_cards.json'));
  ok('gallery items written', vfs.has('/data/gallery_items.json'));
  ok('EN translations written', vfs.has('/data/translations/core/strings_en.po'));

  // 8. Flow structure: chapter metadata + a per-chapter completion reward node.
  const flow = JSON.parse(vfs.get('/data/experience_flows/main_story.json'));
  ok('flow has 2 chapter metadata', (flow.chapters || []).length === 2, String((flow.chapters || []).length));
  const chReward = flow.flow.find((n) => n.type === 'reward' && String(n.id || '').startsWith('chapter_1_complete'));
  ok('chapter-1 completion reward emitted', !!chReward && chReward.rewards.some((r) => r.type === 'coins' && r.amount === 100));

  // 9. World map: 2 sections with the right marker counts.
  const wm = JSON.parse(vfs.get('/data/levels/world_map.json')).world_map;
  ok('world map has 2 chapters', wm.chapters.length === 2);
  ok('chapter 1 has 2 markers', wm.chapters[0].levels.length === 2);

  // 10. Round-trip: read the generated data back and compare structure.
  const model2 = reader.readProject();
  const shape = (m) => m.chapters.map((c) => c.levels.length).join(',');
  ok('round-trip preserves chapter/level shape', shape(model) === shape(model2), `${shape(model)} vs ${shape(model2)}`);
  const titles = (m) => m.chapters.map((c) => c.title).join('|');
  ok('round-trip preserves chapter titles', titles(model) === titles(model2), `${titles(model)} vs ${titles(model2)}`);

  console.log('');
  if (failures === 0) { console.log('SANITY OK — all checks passed'); process.exit(0); }
  else { console.log(`SANITY FAILED — ${failures} check(s) failed`); process.exit(1); }
}

try { main(); }
catch (e) { console.error('SANITY ERROR:', e && e.stack || e); process.exit(1); }
