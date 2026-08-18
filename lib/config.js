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
  translationsCore: path.join(DATA, 'translations', 'core'),
};

// Runtime resource paths (as the game addresses them via res://)
const RES = {
  storyImage: (fileName) => `res://data/images/story_content/${fileName}`,
  shardImage: (fileName) => `res://data/images/shards/${fileName}`,
};

const FLOW_ID = 'main_story';
const COLLECTION_ID = 'isabella_journey_cards';
const LANGS = ['en', 'es', 'pt', 'fr'];

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
  FLOW_ID, COLLECTION_ID, LANGS,
  DIFFICULTY_PRESETS, RARITIES, SHARD_CATEGORIES, BOOSTER_TYPES,
  pad2, pad3,
};
