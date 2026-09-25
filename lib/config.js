'use strict';

/**
 * Paths & shared config for the Story Builder data engine.
 *
 * The game project root is two levels up from tools/story-builder.
 * All data lives under <root>/data.
 */

const path = require('path');

// ROOT/DATA can be overridden (e.g. in the browser build, where there is no
// __dirname and data lives in a virtual filesystem). Node/desktop uses the
// real project root two levels up.
const ROOT = (typeof globalThis !== 'undefined' && globalThis.SB_ROOT)
  ? globalThis.SB_ROOT
  : path.resolve(__dirname, '..', '..', '..');
const DATA = (typeof globalThis !== 'undefined' && globalThis.SB_DATA_ROOT)
  ? globalThis.SB_DATA_ROOT
  : path.join(ROOT, 'data');

const PATHS = {
  root: ROOT,
  data: DATA,
  flows: path.join(DATA, 'experience_flows'),
  flowStepDefs: path.join(DATA, 'flow_step_definitions'),
  levels: path.join(DATA, 'levels'),
  narrativeStages: path.join(DATA, 'narrative_stages'),
  collections: path.join(DATA, 'collections'),
  galleryItems: path.join(DATA, 'gallery_items.json'),
  rewardContainers: path.join(DATA, 'reward_containers'),
  rewardProfiles: path.join(DATA, 'reward_profiles'),
  themeMappings: path.join(DATA, 'theme_container_mappings.json'),
  selectionRules: path.join(DATA, 'container_selection_rules.json'),
  images: path.join(DATA, 'images', 'story_content'),
  shardImages: path.join(DATA, 'images', 'shards'),
  voice: path.join(DATA, 'audio', 'story_content'),
  translationsCore: path.join(DATA, 'translations', 'core'),
  // Content-pack narrative translations live under the pack, NOT in
  // translations/core (which holds stable app-level UI strings).
  contentPackRoot: path.join(DATA, 'content_packs'),
};

// Runtime resource paths (as the game addresses them via res://)
const RES = {
  storyImage: (fileName) => `res://data/images/story_content/${fileName}`,
  shardImage: (fileName) => `res://data/images/shards/${fileName}`,
  storyVoice: (fileName) => `res://data/audio/story_content/${fileName}`,
};

const FLOW_ID = 'main_story';
const COLLECTION_ID = 'isabella_journey_cards';
const LANGS = ['en', 'es', 'pt', 'fr'];

// Identifier for this content pack. Narrative translations and any pack-scoped
// assets live under data/content_packs/<PACK_ID>/.
const PACK_ID = 'isabella';

// ── Content-pack boundary ──────────────────────────────────────────────────
// The EXPLICIT allowlist of data paths a content pack owns and may write. Any
// path NOT in this list is app-level and must never be generated, overwritten,
// or deleted by a pack. Paths are relative to the data/ root.
//
// A pack is applied as an OVERLAY (copy-in only) — never a full-folder replace —
// so app-level folders (themes/, reward_containers/, reward_profiles/,
// translations/core/) are always preserved.
const CONTENT_PACK_PATHS = [
  'experience_flows/main_story.json',
  'narrative_stages/',                 // isabella_*.json
  'levels/',                           // level_*.json + world_map.json
  'collections/isabella_journey_cards.json',
  'gallery_items.json',
  `content_packs/${PACK_ID}/`,         // narrative translations + pack manifest
  'images/story_content/',
  'images/shards/',
  'audio/story_content/',
];

// App-level paths a content pack must NEVER touch (documented for clarity /
// used by guardrail checks).
const APP_LEVEL_PATHS = [
  'translations/core/',                // UI strings
  'themes/',                           // board tile/booster art
  'reward_containers/',                // reward screen visuals
  'reward_profiles/',                  // reward presentation profiles
  'theme_container_mappings.json',
  'container_selection_rules.json',
  'flow_step_definitions/',            // shared step defaults
];


// Difficulty presets → level numeric settings (empty boards)
const DIFFICULTY_PRESETS = {
  easy:   { grid_width: 7, grid_height: 7, max_moves: 25, num_tile_types: 5, base_target: 3000 },
  medium: { grid_width: 8, grid_height: 8, max_moves: 22, num_tile_types: 6, base_target: 5000 },
  hard:   { grid_width: 9, grid_height: 9, max_moves: 18, num_tile_types: 7, base_target: 8000 },
};

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const SHARD_CATEGORIES = ['artifacts', 'relics', 'heroes'];
const BOOSTER_TYPES = ['', 'hammer', 'swap', 'shuffle', 'bomb', 'rainbow', 'lightning'];

// Zero-padded id helpers
const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(n).padStart(3, '0');

module.exports = {
  PATHS, RES, RES_ROOT: ROOT,
  FLOW_ID, COLLECTION_ID, LANGS, PACK_ID,
  CONTENT_PACK_PATHS, APP_LEVEL_PATHS,
  DIFFICULTY_PRESETS, RARITIES, SHARD_CATEGORIES, BOOSTER_TYPES,
  pad2, pad3,
};
