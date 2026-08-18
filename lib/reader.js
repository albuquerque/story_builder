'use strict';

/**
 * Reader: reconstruct the editable model (chapters + shards + meta) from the
 * game's existing data/ folder, so authors edit real content instead of a
 * blank slate.
 */

const fs = require('fs');
const path = require('path');
const { PATHS, FLOW_ID, COLLECTION_ID } = require('./config');
const { readPo } = require('./po');

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function basenameFromRes(resPath) {
  if (!resPath) return '';
  return String(resPath).split('/').pop();
}

/** Build the whole editable project model from data/. */
function readProject() {
  const flow = readJson(path.join(PATHS.flows, `${FLOW_ID}.json`), null);
  const collection = readJson(path.join(PATHS.collections, `${COLLECTION_ID}.json`), null);
  const en = readPo(path.join(PATHS.translationsCore, 'strings_en.po'));

  const meta = {
    title: (flow && flow.name) || "Isabella's Journey",
    description: (flow && flow.description) || '',
    // Preserve collection-level texts so round-trips don't rewrite them.
    collectionDescription: (collection && collection.description) || 'Collectible chapter cards.',
    completionReward: (collection && collection.completion_reward) || {
      type: 'gems', amount: 200, title: 'Journey Complete!',
      description: "You've collected every chapter.",
    },
  };

  const chapters = flow ? readChapters(flow, collection, en) : [];
  const shards = readShards();
  applyWorldMap(chapters, meta);

  return { meta, chapters, shards };
}

/**
 * Walk the flow[] array. It repeats: narrative_stage -> level -> show_rewards ->
 * reward (with a card). Each such group becomes a LEVEL. Levels are then grouped
 * into CHAPTERS using the flow's optional `chapters` metadata (level-number
 * ranges); legacy data with no metadata collapses into a single chapter.
 */
function readChapters(flow, collection, en) {
  const nodes = Array.isArray(flow.flow) ? flow.flow : [];
  const cardById = {};
  if (collection && Array.isArray(collection.items)) {
    for (const it of collection.items) cardById[it.id] = it;
  }

  // 1. Parse the flat flow into an ordered list of LEVEL objects.
  const levels = [];
  let current = null;
  const pushCurrent = () => { if (current) levels.push(current); current = null; };

  for (const node of nodes) {
    const type = node.type;
    if (type === 'narrative_stage') {
      pushCurrent();
      current = newLevelFromNarrative(node, en);
    } else if (type === 'level') {
      if (!current) current = emptyLevel();
      applyLevel(current, node);
    } else if (type === 'show_rewards') {
      // regenerated automatically
    } else if (type === 'reward') {
      // A reward node with a `chapter` marker (id "chapter_N_complete") is a
      // per-chapter completion reward, not a level reward.
      if (node.chapter || /^chapter_\d+_complete$/.test(String(node.id || ''))) {
        _pendingChapterRewards.push(node);
      } else {
        if (!current) current = emptyLevel();
        applyReward(current, node, cardById);
      }
    } else if (type === 'ad_reward') {
      if (current) current._adReward = node;
    }
  }
  pushCurrent();
  levels.forEach((lv, i) => { lv.levelNumber = i + 1; });

  // 2. Group levels into chapters using flow.chapters metadata if present.
  const meta = Array.isArray(flow.chapters) ? flow.chapters : null;
  let chapters;
  if (meta && meta.length) {
    chapters = meta.map((cm) => {
      const from = Number(cm.from_level) || 1;
      const to = Number(cm.to_level) || levels.length;
      const chLevels = levels.filter((lv) => lv.levelNumber >= from && lv.levelNumber <= to);
      const ch = newChapter(cm);
      ch.levels = chLevels;
      return ch;
    });
  } else {
    // Legacy: one chapter holding every level.
    const ch = newChapter({ title: (flow.name || "Isabella's Journey") });
    ch.levels = levels;
    chapters = [ch];
  }

  // 3. Attach per-chapter completion rewards (matched by chapter number order).
  _pendingChapterRewards.forEach((node) => {
    const chNum = Number(node.chapter) || 0;
    if (chNum >= 1 && chNum <= chapters.length) {
      chapters[chNum - 1].completionReward = rewardsToObject(node.rewards);
    }
  });
  _pendingChapterRewards = [];

  chapters.forEach((c, i) => { c.index = i + 1; });
  return chapters;
}

let _pendingChapterRewards = [];

function newChapter(cm) {
  return {
    index: 0,
    title: (cm && cm.title) || '',
    description: (cm && cm.description) || '',
    mapBackground: (cm && cm.map_background)
      ? (String(cm.map_background).startsWith('res://data/images/story_content/')
          ? String(cm.map_background).split('/').pop() : String(cm.map_background))
      : '',
    mapThemeColor: (cm && cm.map_theme_color) || '#3D5A80',
    completionReward: { coins: 0, gems: 0, booster: '', boosterAmount: 1 },
    levels: [],
  };
}

function rewardsToObject(rewards) {
  const out = { coins: 0, gems: 0, booster: '', boosterAmount: 1 };
  for (const r of (Array.isArray(rewards) ? rewards : [])) {
    if (r.type === 'coins') out.coins = Number(r.amount) || 0;
    else if (r.type === 'gems') out.gems = Number(r.amount) || 0;
    else if (r.type === 'booster') { out.booster = r.booster_type || ''; out.boosterAmount = Number(r.amount) || 1; }
  }
  return out;
}

function emptyLevel() {
  return {
    levelNumber: 0,
    title: '',
    description: '',
    image: '',           // narrative story image (basename)
    dialogue: [],        // narrative dialogue lines
    difficulty: 'medium',
    targetScore: null,
    rewards: { coins: 0, gems: 0, booster: '', boosterAmount: 1 },
    rarity: 'common',
    mapNode: null,       // { x, y } worldmap marker
  };
}

function newLevelFromNarrative(node, en) {
  const c = emptyLevel();
  const stageId = node.id || '';
  const stageFile = path.join(PATHS.narrativeStages, `${stageId}.json`);
  const stage = readJson(stageFile, null);
  if (stage) {
    c.title = stage.name || '';
    c.description = stage.description || '';
    const states = Array.isArray(stage.states) ? stage.states : [];
    if (states.length && states[0].asset) {
      c.image = basenameFromRes(states[0].asset);
    }
    c.dialogue = states.map((s) => {
      const lineImg = s.asset ? basenameFromRes(s.asset) : '';
      return {
        text: s.text_key && en[s.text_key] !== undefined ? en[s.text_key]
              : (s.text || ''),
        duration: typeof s.duration === 'number' ? s.duration : 4.0,
        _text_key: s.text_key || '',
        // Per-screen image override — only kept when it differs from the
        // chapter image, so round-trips stay clean.
        image: (lineImg && lineImg !== c.image) ? lineImg : '',
        // Preserve authored per-state effects (rendered in-engine).
        effects: Array.isArray(s.effects) ? s.effects : undefined,
      };
    });
    if (stage.background_color) c.backgroundColor = stage.background_color;
    if (stage.text_color) c.textColor = stage.text_color;
  }
  c._stageId = stageId;
  return c;
}

function applyLevel(c, node) {
  const levelId = node.id || '';
  const lvl = readJson(path.join(PATHS.levels, `${levelId}.json`), null);
  if (lvl) {
    if (!c.title) c.title = lvl.title || '';
    if (!c.description) c.description = lvl.description || '';
    c.targetScore = typeof lvl.target_score === 'number' ? lvl.target_score : c.targetScore;
    c._level = {
      grid_width: lvl.grid_width, grid_height: lvl.grid_height,
      max_moves: lvl.max_moves, num_tile_types: lvl.num_tile_types,
      theme: lvl.theme, target_score: lvl.target_score,
      layout: lvl.layout,
      collectible_target: lvl.collectible_target, collectible_type: lvl.collectible_type,
      unmovable_target: lvl.unmovable_target, unmovable_type: lvl.unmovable_type,
    };
    // Infer a difficulty from tile count if present
    if (lvl.num_tile_types >= 7) c.difficulty = 'hard';
    else if (lvl.num_tile_types <= 5) c.difficulty = 'easy';
    else c.difficulty = 'medium';
    // Board theme + optional background override (surface to the model).
    c.theme = lvl.theme || 'legacy';
    if (lvl.background) {
      const b = String(lvl.background);
      // Show uploaded story images by basename; keep res:///http paths verbatim.
      c.boardBackground = (b.startsWith('res://data/images/story_content/'))
        ? b.split('/').pop() : b;
    }
  }
  c._levelId = levelId;
}

function applyReward(c, node, cardById) {
  const rewards = Array.isArray(node.rewards) ? node.rewards : [];
  for (const r of rewards) {
    if (r.type === 'coins') c.rewards.coins = Number(r.amount) || 0;
    else if (r.type === 'gems') c.rewards.gems = Number(r.amount) || 0;
    else if (r.type === 'booster') {
      c.rewards.booster = r.booster_type || '';
      c.rewards.boosterAmount = Number(r.amount) || 1;
    } else if (r.type === 'card') {
      const card = cardById[r.card_id];
      if (card) {
        c.rarity = card.rarity || 'common';
        if (!c.image && card.image) c.image = basenameFromRes(card.image);
      }
    }
  }
  c._rewardNodeId = node.id || '';
}

function readShards() {
  const arr = readJson(PATHS.galleryItems, []);
  if (!Array.isArray(arr)) return [];
  return arr.map((it) => ({
    id: it.id || '',
    name: it.name || '',
    rarity: it.rarity || 'common',
    category: it.category || 'artifacts',
    shards_required: Number(it.shards_required) || 5,
    // Keep original asset strings; UI shows basename for local images.
    art_asset: it.art_asset || '',
    silhouette_asset: it.silhouette_asset || '',
  }));
}

// Load world_map.json and merge map data: per-chapter (background/color) and
// per-level marker positions (by global level number).
function applyWorldMap(chapters, meta) {
  const wm = readJson(path.join(PATHS.levels, 'world_map.json'), null);
  const root = wm && wm.world_map ? wm.world_map : null;
  if (!root || !Array.isArray(root.chapters)) return;
  // Screen-wide background into story meta.
  if (meta && root.background_image) {
    const b = String(root.background_image);
    meta.mapScreenBackground = b.startsWith('res://data/images/story_content/')
      ? b.split('/').pop() : b;
  }
  // Index chapters by id, and collect all level markers by level number.
  const posByLevel = {};
  for (const wc of root.chapters) {
    const idx = (Number(wc.id) || 0) - 1;
    const ch = (idx >= 0 && idx < chapters.length) ? chapters[idx] : null;
    if (ch) {
      if (wc.background_image) {
        const b = String(wc.background_image);
        ch.mapBackground = b.startsWith('res://data/images/story_content/')
          ? b.split('/').pop() : b;
      }
      if (wc.theme_color) ch.mapThemeColor = wc.theme_color;
    }
    for (const lv of (Array.isArray(wc.levels) ? wc.levels : [])) {
      if (Array.isArray(lv.pos) && lv.pos.length >= 2) {
        posByLevel[Number(lv.level)] = { x: Number(lv.pos[0]) || 0, y: Number(lv.pos[1]) || 0 };
      }
    }
  }
  // Attach marker positions to the matching level objects.
  for (const ch of chapters) {
    for (const lv of ch.levels) {
      if (posByLevel[lv.levelNumber]) lv.mapNode = posByLevel[lv.levelNumber];
    }
  }
}

module.exports = { readProject, readJson };
