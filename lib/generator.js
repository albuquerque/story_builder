'use strict';

/**
 * Generator: turn the editable model (chapters + shards + meta) into the game's
 * data files. Deterministic and naming-convention-preserving.
 *
 * Writes into a target data root (defaults to the game's data/). Can also write
 * into a staging dir for zip export.
 */

const fs = require('fs');
const path = require('path');
const {
  FLOW_ID, COLLECTION_ID, LANGS,
  DIFFICULTY_PRESETS, pad2, pad3,
} = require('./config');
const { readPo, writePo } = require('./po');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// Naming helpers ------------------------------------------------------------
const stageId = (n) => `isabella_${pad2(n)}`;
const levelId = (n) => `level_${pad2(n)}`;
const cardId = (n) => `chapter_${pad2(n)}`;
const rewardNodeId = (n) => `level_${pad2(n)}_complete`;
const textKey = (n, line) => `NARRATIVE_ISABELLA_${pad2(n)}_LINE_${line}`;
const storyImageRes = (fileName) => `res://data/images/story_content/${fileName}`;
const shardImageRes = (fileName) => `res://data/images/shards/${fileName}`;

/**
 * Generate everything for a data root.
 * @param model { meta, chapters, shards }
 * @param dataRoot absolute path to a data/ folder (game or staging)
 * @param opts { poSourceRoot } - where to read existing .po from to preserve
 *        non-narrative keys (defaults to dataRoot)
 */
function generate(model, dataRoot, opts = {}) {
  const poSourceRoot = opts.poSourceRoot || dataRoot;
  const P = paths(dataRoot);

  const chapters = model.chapters || [];
  const shards = model.shards || [];

  // Flatten chapters -> ordered levels with a global 1-based number, and record
  // which levels belong to which chapter (for flow grouping + worldmap).
  const flat = flattenLevels(chapters);

  writeFlow(P, model, chapters, flat);
  writeNarrativeStages(P, flat);
  writeLevels(P, flat);
  writeCollection(P, model, flat);
  writeGalleryItems(P, shards);
  writeTranslations(P, poSourceRoot, flat);
  writeWorldMap(P, model, chapters, flat);
  ensureSupportFiles(P);

  return { chapters: chapters.length, levels: flat.length, shards: shards.length };
}

// Build a flat list: [{ level, n, chapterIndex, chapter, isChapterLast }]
function flattenLevels(chapters) {
  const flat = [];
  let n = 0;
  chapters.forEach((ch, ci) => {
    const levels = Array.isArray(ch.levels) ? ch.levels : [];
    levels.forEach((lv, li) => {
      n += 1;
      flat.push({
        level: lv,
        n,
        chapterIndex: ci,
        chapter: ch,
        isChapterLast: li === levels.length - 1,
      });
    });
  });
  return flat;
}

function paths(dataRoot) {
  return {
    dataRoot,
    flows: path.join(dataRoot, 'experience_flows'),
    narrativeStages: path.join(dataRoot, 'narrative_stages'),
    levels: path.join(dataRoot, 'levels'),
    collections: path.join(dataRoot, 'collections'),
    galleryItems: path.join(dataRoot, 'gallery_items.json'),
    translationsCore: path.join(dataRoot, 'translations', 'core'),
    flowStepDefs: path.join(dataRoot, 'flow_step_definitions'),
    rewardContainers: path.join(dataRoot, 'reward_containers'),
    rewardProfiles: path.join(dataRoot, 'reward_profiles'),
    themeMappings: path.join(dataRoot, 'theme_container_mappings.json'),
    selectionRules: path.join(dataRoot, 'container_selection_rules.json'),
    images: path.join(dataRoot, 'images', 'story_content'),
    shardImages: path.join(dataRoot, 'images', 'shards'),
  };
}

// Flow ----------------------------------------------------------------------
function writeFlow(P, model, chapters, flat) {
  const flow = [];
  flat.forEach((entry) => {
    const lv = entry.level;
    const n = entry.n;
    flow.push({ definition_id: 'narrative_stage', id: stageId(n), type: 'narrative_stage' });
    flow.push({ type: 'level', id: levelId(n) });
    flow.push({ type: 'show_rewards', level_number: n, completed: true });
    const rewards = buildRewardEntries(lv, n);
    flow.push({ id: rewardNodeId(n), type: 'reward', rewards });
    // Preserve an existing ad bonus attached to this level (round-trip safe).
    if (lv._adReward && typeof lv._adReward === 'object') {
      flow.push(lv._adReward);
    }
    // After a chapter's last level, grant the per-chapter completion reward.
    if (entry.isChapterLast) {
      const chReward = buildChapterRewardEntries(entry.chapter);
      if (chReward.length) {
        // Emitted as a normal "reward" node (the game grants it the same way);
        // the id pattern + chapter field let the tool recognise it on read.
        flow.push({
          id: `chapter_${entry.chapterIndex + 1}_complete`,
          type: 'reward',
          chapter: entry.chapterIndex + 1,
          rewards: chReward,
        });
      }
    }
  });

  // Chapter grouping metadata (level-number ranges). Ignored by the game,
  // used by the Story Builder to reconstruct chapters on read.
  const chaptersMeta = [];
  let cursor = 0;
  chapters.forEach((ch, ci) => {
    const count = Array.isArray(ch.levels) ? ch.levels.length : 0;
    if (count === 0) return;
    const from = cursor + 1;
    const to = cursor + count;
    cursor = to;
    chaptersMeta.push({
      id: ci + 1,
      title: ch.title || `Chapter ${ci + 1}`,
      description: ch.description || '',
      from_level: from,
      to_level: to,
      map_background: mapBackgroundRes(ch),
      map_theme_color: ch.mapThemeColor || '#3D5A80',
    });
  });

  const doc = {
    experience_id: FLOW_ID,
    flow_id: FLOW_ID,
    version: '1.0.0',
    name: (model.meta && model.meta.title) || "Isabella's Journey",
    description: (model.meta && model.meta.description) || '',
    chapters: chaptersMeta,
    flow,
  };
  writeJson(path.join(P.flows, `${FLOW_ID}.json`), doc);
}

function buildRewardEntries(lv, n) {
  const r = lv.rewards || {};
  const out = [];
  const coins = Number(r.coins) || 0;
  const gems = Number(r.gems) || 0;
  if (coins > 0) out.push({ type: 'coins', amount: coins });
  if (gems > 0) out.push({ type: 'gems', amount: gems });
  if (r.booster) {
    out.push({ type: 'booster', booster_type: r.booster, amount: Number(r.boosterAmount) || 1 });
  }
  // Always grant the level's collectible card.
  out.push({ type: 'card', collection_id: COLLECTION_ID, card_id: cardId(n) });
  return out;
}

function buildChapterRewardEntries(chapter) {
  const r = (chapter && chapter.completionReward) || {};
  const out = [];
  const coins = Number(r.coins) || 0;
  const gems = Number(r.gems) || 0;
  if (coins > 0) out.push({ type: 'coins', amount: coins });
  if (gems > 0) out.push({ type: 'gems', amount: gems });
  if (r.booster) {
    out.push({ type: 'booster', booster_type: r.booster, amount: Number(r.boosterAmount) || 1 });
  }
  return out;
}

// Narrative stages ----------------------------------------------------------
function writeNarrativeStages(P, flat) {
  flat.forEach((entry) => {
    const c = entry.level;
    const n = entry.n;
    const bg = c.backgroundColor || '#0b0f1a';
    const txt = c.textColor || '#f8f4e3';
    const imageRes = c.image ? storyImageRes(c.image) : '';

    const dialogue = (c.dialogue && c.dialogue.length) ? c.dialogue : [{ text: '', duration: 4.0 }];
    const states = dialogue.map((d, di) => {
      const st = {
        name: `line_${di + 1}`,
        position: 'fullscreen',
        text_key: textKey(n, di + 1),
        duration: typeof d.duration === 'number' ? d.duration : 4.0,
        background_color: bg,
        text_color: txt,
      };
      // Per-screen image if the author set one, else fall back to the chapter image.
      const lineImg = d.image ? storyImageRes(d.image) : imageRes;
      if (lineImg) st.asset = lineImg;
      // Preserve authored per-state effects if present (now rendered in-engine).
      if (Array.isArray(d.effects) && d.effects.length) st.effects = d.effects;
      return st;
    });

    const transitions = [{ from: '', to: 'line_1', event: 'stage_loaded' }];
    for (let di = 0; di < states.length - 1; di++) {
      transitions.push({
        from: `line_${di + 1}`,
        to: `line_${di + 2}`,
        event: 'auto_advance',
        delay: states[di].duration,
      });
    }

    const doc = {
      id: stageId(n),
      name: c.title || `Chapter ${n}`,
      description: c.description || '',
      anchor: 'fullscreen',
      background_color: bg,
      text_color: txt,
      states,
      transitions,
    };
    writeJson(path.join(P.narrativeStages, `${stageId(n)}.json`), doc);
  });
}

// Levels --------------------------------------------------------------------
function writeLevels(P, flat) {
  flat.forEach((entry) => {
    const c = entry.level;
    const n = entry.n;
    const preset = DIFFICULTY_PRESETS[c.difficulty] || DIFFICULTY_PRESETS.medium;
    // Prefer values captured from an existing level (preserves hand-tuning on
    // round-trip); fall back to the difficulty preset for new/edited chapters.
    const lv = c._level || {};
    const useStored = c._levelPreserve !== false && lv && typeof lv.max_moves === 'number';
    const w = num(lv.grid_width, preset.grid_width);
    const h = num(lv.grid_height, preset.grid_height);
    const tiles = num(lv.num_tile_types, preset.num_tile_types);
    const moves = useStored ? num(lv.max_moves, preset.max_moves) : preset.max_moves;
    const target = (typeof c.targetScore === 'number' && c.targetScore > 0)
      ? c.targetScore
      : (useStored ? num(lv.target_score, preset.base_target) : preset.base_target + (n - 1) * 250);
    const theme = c.theme || lv.theme || 'legacy';
    // Preserve the existing hand-authored board layout when the grid size is
    // unchanged (round-trip safe). Otherwise generate a fresh empty board.
    let layout;
    if (useStored && typeof lv.layout === 'string' && num(lv.grid_width, w) === w && num(lv.grid_height, h) === h) {
      layout = lv.layout;
    } else {
      layout = emptyLayout(w, h);
    }

    const doc = {
      level_number: n,
      title: c.title || `Chapter ${n}`,
      description: c.description || '',
      grid_width: w,
      grid_height: h,
      target_score: target,
      max_moves: moves,
      num_tile_types: tiles,
      theme,
      layout,
      collectible_target: useStored ? num(lv.collectible_target, 0) : 0,
      collectible_type: (useStored && lv.collectible_type) ? lv.collectible_type : 'coin',
      unmovable_target: useStored ? num(lv.unmovable_target, 0) : 0,
      unmovable_type: (useStored && lv.unmovable_type) ? lv.unmovable_type : 'snow',
    };
    // Optional per-level board background override (res:// path or a filename
    // that the author uploaded, resolved to the story image folder).
    const bg = boardBackgroundRes(c);
    if (bg) doc.background = bg;
    writeJson(path.join(P.levels, `${levelId(n)}.json`), doc);
  });
}

// World map ------------------------------------------------------------------
// One WorldMap chapter per story chapter, each with a single level node whose
// position the author places on the chapter background. Matches the schema
// WorldMap.gd reads from res://data/levels/world_map.json.
const MAP_W = 720;   // base canvas width  (WorldMap.gd scales from 720x1280)
const MAP_H = 900;   // per-chapter height in code (900 * scale_factor.y)

function mapBackgroundRes(c) {
  const v = c.mapBackground || '';
  if (!v) return '';
  if (v.startsWith('res://') || v.startsWith('http')) return v;
  return storyImageRes(v);
}

function writeWorldMap(P, model, chapters, flat) {
  // Global level number for each level object (so markers reference level_NN).
  const numByLevel = new Map();
  flat.forEach((entry) => numByLevel.set(entry.level, entry.n));

  const worldChapters = chapters.map((ch, ci) => {
    const chLevels = Array.isArray(ch.levels) ? ch.levels : [];
    const markers = chLevels.map((lv, li) => {
      const n = numByLevel.get(lv) || 0;
      const node = (lv.mapNode && typeof lv.mapNode.x === 'number')
        ? lv.mapNode
        : { x: Math.round(MAP_W * ((li + 1) / (chLevels.length + 1))), y: Math.round(MAP_H / 2) };
      return {
        level: n,
        pos: [Math.round(node.x), Math.round(node.y)],
        unlocked: n === 1,
        name: lv.title || `Level ${n}`,
      };
    });
    return {
      id: ci + 1,
      title: ch.title || `Chapter ${ci + 1}`,
      background_image: mapBackgroundRes(ch),
      theme_color: ch.mapThemeColor || '#3D5A80',
      level_grid: { rows: 1, columns: Math.max(1, chLevels.length) },
      levels: markers,
      next_chapter_button_pos: [Math.round(MAP_W / 2), MAP_H - 60],
    };
  });

  const doc = {
    world_map: {
      title: (model.meta && model.meta.title) || "Isabella's Journey",
      background_image: mapScreenBackgroundRes(model),
      chapters: worldChapters,
    },
  };
  writeJson(path.join(P.levels, 'world_map.json'), doc);
}

// Screen-wide world-map background (behind all chapters). From story meta.
function mapScreenBackgroundRes(model) {
  const v = (model.meta && model.meta.mapScreenBackground) || '';
  if (!v) return '';
  if (v.startsWith('res://') || v.startsWith('http')) return v;
  return storyImageRes(v);
}

function boardBackgroundRes(c) {
  const v = c.boardBackground || '';
  if (!v) return '';
  if (v.startsWith('res://') || v.startsWith('http')) return v;
  // treat as an uploaded story-content image filename
  return storyImageRes(v);
}

function emptyLayout(w, h) {
  const row = Array.from({ length: w }, () => '0').join(' ');
  return Array.from({ length: h }, () => row).join('\n');
}

function num(v, fallback) {
  return (typeof v === 'number' && !Number.isNaN(v)) ? v : fallback;
}

// Collection ----------------------------------------------------------------
function writeCollection(P, model, flat) {
  const items = flat.map((entry) => {
    const c = entry.level;
    const n = entry.n;
    return {
      id: cardId(n),
      name: c.title || `Level ${n}`,
      description: c.description || '',
      image: c.image ? storyImageRes(c.image) : '',
      unlock_condition: rewardNodeId(n),
      rarity: c.rarity || 'common',
    };
  });
  const doc = {
    collection_id: COLLECTION_ID,
    name: (model.meta && model.meta.title) || "Isabella's Journey",
    description: (model.meta && model.meta.collectionDescription) || 'Collectible chapter cards.',
    category: 'story',
    items,
    completion_reward: (model.meta && model.meta.completionReward) || {
      type: 'gems',
      amount: 200,
      title: 'Journey Complete!',
      description: "You've collected every chapter.",
    },
  };
  writeJson(path.join(P.collections, `${COLLECTION_ID}.json`), doc);
}

// Gallery / shards ----------------------------------------------------------
function writeGalleryItems(P, shards) {
  const arr = shards.map((s, i) => {
    const id = s.id && /^artifact_\d{3}$/.test(s.id) ? s.id : `artifact_${pad3(i + 1)}`;
    let art = s.art_asset || '';
    // If the author supplied a bare filename, treat it as a shard image path.
    if (art && !art.startsWith('res://') && !art.startsWith('http')) {
      art = shardImageRes(art);
    }
    let sil = s.silhouette_asset || 'res://assets/gallery/locked_placeholder.svg';
    if (sil && !sil.startsWith('res://') && !sil.startsWith('http')) {
      sil = shardImageRes(sil);
    }
    return {
      id,
      name: s.name || id,
      rarity: s.rarity || 'common',
      category: s.category || 'artifacts',
      shards_required: Number(s.shards_required) || 5,
      art_asset: art,
      silhouette_asset: sil,
    };
  });
  writeJson(P.galleryItems, arr);
}

// Translations --------------------------------------------------------------
function writeTranslations(P, poSourceRoot, flat) {
  const srcCore = path.join(poSourceRoot, 'translations', 'core');
  ensureDir(P.translationsCore);

  const langName = { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French' };

  for (const lang of LANGS) {
    const existing = readPo(path.join(srcCore, `strings_${lang}.po`));

    // Narrative keys we are (re)generating this run.
    const generatedKeys = new Set();
    const narrativeEntries = [];
    flat.forEach((entry) => {
      const c = entry.level;
      const n = entry.n;
      const dialogue = (c.dialogue && c.dialogue.length) ? c.dialogue : [{ text: '' }];
      dialogue.forEach((d, di) => {
        const key = textKey(n, di + 1);
        generatedKeys.add(key);
        let val;
        if (lang === 'en') val = d.text || '';
        else val = existing[key] !== undefined && existing[key] !== '' ? existing[key] : (d.text || '');
        narrativeEntries.push({ id: key, str: val });
      });
    });

    // Preserve all existing non-narrative keys in their original order-ish.
    // (We keep every key that we did NOT (re)generate.)
    const preserved = [];
    for (const [id, str] of Object.entries(existing)) {
      if (!generatedKeys.has(id)) preserved.push({ id, str });
    }

    // Narrative keys first (grouped), then the preserved UI/other keys.
    const entries = [...narrativeEntries, ...preserved];
    writePo(path.join(P.translationsCore, `strings_${lang}.po`), langName[lang], lang, entries);
  }
}

// Support files (only create if missing; never clobber tuned ones) ----------
function ensureSupportFiles(P) {
  // flow step definitions
  ensureDir(P.flowStepDefs);
  ensureIfMissing(path.join(P.flowStepDefs, 'narrative_stage.json'),
    { id: 'narrative_stage', type: 'narrative_stage', auto_advance_delay: 4.0, skippable: true });
  ensureIfMissing(path.join(P.flowStepDefs, 'reward_coins.json'),
    { id: 'reward_coins', type: 'reward', rewards: [{ type: 'coins', amount: 100 }] });
  ensureIfMissing(path.join(P.flowStepDefs, 'reward_gems.json'),
    { id: 'reward_gems', type: 'reward', rewards: [{ type: 'gems', amount: 10 }] });

  // theme mappings & selection rules
  ensureIfMissing(P.themeMappings, {
    modern: { reward_container: 'fade_chest_example', description: 'Modern theme container' },
    legacy: { reward_container: 'simple_box', description: 'Legacy theme container' },
    _default: { reward_container: 'fade_chest_example', description: 'Default container' },
  });
  ensureIfMissing(P.selectionRules, {
    description: 'Conditional container selection rules',
    rules: [],
    priority: 'first_match',
    fallback: 'use_theme_mapping',
  });
}

function ensureIfMissing(file, obj) {
  if (!fs.existsSync(file)) writeJson(file, obj);
}

module.exports = {
  generate,
  // exported for tests / reuse
  _naming: { stageId, levelId, cardId, rewardNodeId, textKey, storyImageRes, shardImageRes },
  paths,
};
