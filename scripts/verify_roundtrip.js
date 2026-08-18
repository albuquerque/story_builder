'use strict';

/**
 * Round-trip verification: read the current data/ into the model, regenerate
 * into a temp folder, and compare the semantic content of key files with the
 * originals. This proves the reader+generator preserve the existing game data.
 *
 * We compare parsed JSON (order-insensitive for objects) rather than raw bytes,
 * because formatting/ordering may differ but meaning must not.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PATHS, FLOW_ID, COLLECTION_ID, pad2 } = require('../lib/config');
const { readProject } = require('../lib/reader');
const { generate } = require('../lib/generator');

function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }

function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === 'object') {
    const out = {};
    for (const k of Object.keys(x).sort()) out[k] = canonical(x[k]);
    return out;
  }
  return x;
}
function eq(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }

function main() {
  const model = readProject();
  console.log(`Read model: ${model.chapters.length} chapters, ${model.shards.length} shards`);

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-verify-'));
  const stagingData = path.join(staging, 'data');
  fs.mkdirSync(stagingData, { recursive: true });
  generate(model, stagingData, { poSourceRoot: PATHS.data });

  let pass = 0, fail = 0;
  const check = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
  };

  const n = model.chapters.length;

  // 1. Flow: same number of nodes and same ids/types in order.
  const origFlow = readJson(path.join(PATHS.flows, `${FLOW_ID}.json`));
  const genFlow = readJson(path.join(stagingData, 'experience_flows', `${FLOW_ID}.json`));
  const sig = (fl) => fl.flow.map((x) => `${x.type}:${x.id || ''}`).join('|');
  check('flow node sequence matches', sig(origFlow) === sig(genFlow),
    `orig=${origFlow.flow.length} gen=${genFlow.flow.length}`);

  // 2. Reward nodes: coins/gems/card preserved per chapter.
  const rewardOf = (fl, id) => fl.flow.find((x) => x.type === 'reward' && x.id === id);
  let rewardOk = true;
  for (let i = 1; i <= n; i++) {
    const id = `level_${pad2(i)}_complete`;
    const a = rewardOf(origFlow, id), b = rewardOf(genFlow, id);
    if (!a || !b || !eq(a.rewards, b.rewards)) { rewardOk = false; break; }
  }
  check('all reward entries preserved', rewardOk);

  // 3. Levels: core numeric fields preserved.
  let levelOk = true, levelDetail = '';
  for (let i = 1; i <= n; i++) {
    const f = `level_${pad2(i)}.json`;
    const a = readJson(path.join(PATHS.levels, f));
    const b = readJson(path.join(stagingData, 'levels', f));
    for (const k of ['level_number', 'grid_width', 'grid_height', 'max_moves', 'num_tile_types']) {
      if (a[k] !== b[k]) { levelOk = false; levelDetail = `${f}.${k}: ${a[k]} != ${b[k]}`; break; }
    }
    if (levelOk && (a.layout || '') !== (b.layout || '')) { levelOk = false; levelDetail = `${f} layout`; }
    if (!levelOk) break;
  }
  check('level core fields preserved', levelOk, levelDetail);

  // 4. Narrative stages: id/name and per-state text_key + asset preserved.
  let narrOk = true, narrDetail = '';
  for (let i = 1; i <= n; i++) {
    const f = `isabella_${pad2(i)}.json`;
    const a = readJson(path.join(PATHS.narrativeStages, f));
    const b = readJson(path.join(stagingData, 'narrative_stages', f));
    if (a.id !== b.id) { narrOk = false; narrDetail = `${f} id`; break; }
    if ((a.states || []).length !== (b.states || []).length) {
      narrOk = false; narrDetail = `${f} state count ${a.states.length}!=${b.states.length}`; break;
    }
    for (let s = 0; s < a.states.length; s++) {
      if ((a.states[s].text_key || '') !== (b.states[s].text_key || '')) {
        narrOk = false; narrDetail = `${f} state ${s} text_key`; break;
      }
      if ((a.states[s].asset || '') !== (b.states[s].asset || '')) {
        narrOk = false; narrDetail = `${f} state ${s} asset`; break;
      }
      if (!eq(a.states[s].effects || [], b.states[s].effects || [])) {
        narrOk = false; narrDetail = `${f} state ${s} effects`; break;
      }
    }
    if (!narrOk) break;
  }
  check('narrative stage keys/assets preserved', narrOk, narrDetail);

  // 5. Collection: same card ids + unlock conditions + rarities.
  const oc = readJson(path.join(PATHS.collections, `${COLLECTION_ID}.json`));
  const gc = readJson(path.join(stagingData, 'collections', `${COLLECTION_ID}.json`));
  const cardSig = (col) => (col.items || []).map((it) => `${it.id}:${it.unlock_condition}:${it.rarity}`).join('|');
  check('collection cards preserved', cardSig(oc) === cardSig(gc));

  // 6. Translations: every narrative EN msgid preserved with same text.
  const { readPo } = require('../lib/po');
  const oEn = readPo(path.join(PATHS.translationsCore, 'strings_en.po'));
  const gEn = readPo(path.join(stagingData, 'translations', 'core', 'strings_en.po'));
  let trOk = true, trDetail = '';
  for (const [k, v] of Object.entries(oEn)) {
    if (k.startsWith('NARRATIVE_ISABELLA_')) {
      if (gEn[k] !== v) { trOk = false; trDetail = `${k}`; break; }
    }
  }
  // Also: existing UI keys must be preserved.
  for (const [k, v] of Object.entries(oEn)) {
    if (k.startsWith('UI_') && gEn[k] !== v) { trOk = false; trDetail = `${k} (UI)`; break; }
  }
  check('translation keys preserved (narrative + UI)', trOk, trDetail);

  // 7. Gallery items preserved.
  if (fs.existsSync(PATHS.galleryItems)) {
    const og = readJson(PATHS.galleryItems);
    const gg = readJson(path.join(stagingData, 'gallery_items.json'));
    const gsig = (arr) => arr.map((x) => `${x.id}:${x.shards_required}:${x.rarity}:${x.category}`).join('|');
    check('gallery items preserved', gsig(og) === gsig(gg), `orig=${og.length} gen=${gg.length}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(`(staging: ${staging})`);
  // Clean up staging on success
  if (fail === 0) fs.rmSync(staging, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
}

main();
