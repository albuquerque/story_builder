'use strict';

/**
 * Working-model store. The tool holds the editable model in memory and
 * persists it to project.json so edits survive server restarts. On first run
 * (no project.json) it seeds from the game's existing data/.
 */

const fs = require('fs');
const path = require('path');
const { readProject } = require('./reader');

const STORE_FILE = path.join(__dirname, '..', 'project.json');

let model = null;

function load() {
  if (model) return model;
  if (fs.existsSync(STORE_FILE)) {
    try {
      model = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      return model;
    } catch (e) { /* fall through to reseed */ }
  }
  model = readProject();
  save();
  return model;
}

function save() {
  if (!model) return;
  fs.writeFileSync(STORE_FILE, JSON.stringify(model, null, 2), 'utf8');
}

function get() { return load(); }

function set(newModel) {
  model = newModel;
  save();
  return model;
}

/** Re-seed the working model from the game's data/ (discard local edits). */
function reseedFromGame() {
  model = readProject();
  save();
  return model;
}

module.exports = { get, set, save, reseedFromGame, STORE_FILE };
