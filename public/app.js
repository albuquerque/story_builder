'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let model = { meta: { title: '', description: '' }, chapters: [], shards: [] };
let options = { difficulties: ['easy', 'medium', 'hard'], rarities: [], shardCategories: [], boosters: [] };
let saveTimer = null;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ── Effect catalog ───────────────────────────────────────────────────────────
// Each effect the engine renders on a narrative screen. `fields` describe the
// editable parameters (all stored inline on the effect object).
const EFFECTS = {
  screen_flash: {
    label: 'Screen flash',
    defaults: { color: '#ffffff', intensity: 0.6, duration: 0.3 },
    fields: [
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'intensity', label: 'Strength', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'duration', label: 'Seconds', type: 'number', min: 0.1, max: 5, step: 0.1 },
    ],
  },
  background_tint: {
    label: 'Background tint',
    defaults: { color: '#3355ff', from: 0.0, to: 0.3, duration: 1.0 },
    fields: [
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'from', label: 'Start strength', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'to', label: 'End strength', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'duration', label: 'Seconds', type: 'number', min: 0.1, max: 8, step: 0.1 },
    ],
  },
  background_dim: {
    label: 'Darken background',
    defaults: { from: 0.0, to: 0.5, duration: 1.0 },
    fields: [
      { key: 'from', label: 'Start darkness', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'to', label: 'End darkness', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'duration', label: 'Seconds', type: 'number', min: 0.1, max: 8, step: 0.1 },
    ],
  },
  progressive_brightness: {
    label: 'Brighten (fade to light)',
    defaults: { start: 0.0, end: 0.7, duration: 1.5 },
    fields: [
      { key: 'start', label: 'Start', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'end', label: 'End', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'duration', label: 'Seconds', type: 'number', min: 0.1, max: 8, step: 0.1 },
    ],
  },
  vignette: {
    label: 'Vignette (dark edges)',
    defaults: { from: 0.0, to: 0.5, duration: 0.6 },
    fields: [
      { key: 'from', label: 'Start strength', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'to', label: 'End strength', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'duration', label: 'Seconds', type: 'number', min: 0.1, max: 8, step: 0.1 },
    ],
  },
  camera_shake: {
    label: 'Shake',
    defaults: { magnitude: 4.0, duration: 0.4 },
    fields: [
      { key: 'magnitude', label: 'Amount', type: 'number', min: 0.5, max: 30, step: 0.5 },
      { key: 'duration', label: 'Seconds', type: 'number', min: 0.1, max: 3, step: 0.1 },
    ],
  },
  particle_burst: {
    label: 'Particle burst',
    defaults: { particle_type: 'spark', count: 25, duration: 1.2 },
    fields: [
      { key: 'particle_type', label: 'Type', type: 'select', options: ['spark', 'petal', 'star'] },
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 200, step: 1 },
      { key: 'duration', label: 'Seconds', type: 'number', min: 0.1, max: 5, step: 0.1 },
    ],
  },
};


// Convert legacy single-strength fade effects to from/to (so the reverse
// controls, End < Start, work). Non-destructive once migrated.
function migrateEffect(fx) {
  if (!fx || !fx.type) return;
  if (fx.type === 'background_tint' || fx.type === 'background_dim' || fx.type === 'vignette') {
    if (fx.to === undefined) {
      const legacy = (fx.strength !== undefined) ? fx.strength
                   : (fx.intensity !== undefined) ? fx.intensity : 0.3;
      fx.from = (fx.from !== undefined) ? fx.from : 0.0;
      fx.to = legacy;
    }
    delete fx.strength;
    delete fx.intensity;
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  options = await fetchJson('/api/options');
  model = await fetchJson('/api/project');
  normalizeModel();
  setupTabs();
  bindGlobalButtons();
  Preview.init();
  MapEditor.init(() => touch());
  renderAll();
  applyOfflineMode();
  $('#dataPathHint').textContent = options.offline
    ? 'On-device: use “Download content pack” to export a .zip you copy into the game.'
    : 'This will write into: ' + options.dataPath;
}

// On the offline/Android build there is no server-side data folder. Adapt the
// Save & Export tab: "Download content pack" exports/shares a zip; hide the
// server-only "Save into the game" button.
function isOffline() { return !!(options && options.offline) || typeof window.__SB_exportPack === 'function'; }
function applyOfflineMode() {
  if (!isOffline()) return;
  const save = $('#btnSave');
  if (save) save.style.display = 'none';         // server-only
  const exp = $('#btnExport');
  if (exp) {
    exp.textContent = 'Download content pack (.zip)';
    exp.removeAttribute('href');                 // stop the WebView navigating to /api/export
    exp.setAttribute('role', 'button');
  }
}

function normalizeModel() {
  model.meta = model.meta || { title: '', description: '' };
  model.chapters = model.chapters || [];
  model.shards = model.shards || [];
  model.chapters.forEach((ch) => {
    ch.levels = ch.levels || [];
    ch.completionReward = ch.completionReward || { coins: 0, gems: 0, booster: '', boosterAmount: 1 };
    ch.levels.forEach((lv) => {
      lv.rewards = lv.rewards || { coins: 0, gems: 0, booster: '', boosterAmount: 1 };
      lv.dialogue = lv.dialogue || [];
    });
  });
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
function setupTabs() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    $$('.panel').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $('#tab-' + t.dataset.tab).classList.add('active');
    if (t.dataset.tab === 'settings') refreshSettings();
  }));
}

// ── Rendering ────────────────────────────────────────────────────────────────
function renderAll() {
  renderChapters();
  renderShards();
  $('#storyTitle').value = model.meta.title || '';
  $('#storyDesc').value = model.meta.description || '';
}

function fillSelect(sel, values, current, labelFn) {
  sel.innerHTML = '';
  values.forEach((v) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = labelFn ? labelFn(v) : (v === '' ? '(none)' : cap(v));
    if (v === current) o.selected = true;
    sel.appendChild(o);
  });
}

function renderChapters() {
  const list = $('#chapterList');
  list.innerHTML = '';
  model.chapters.forEach((ch, ci) => list.appendChild(buildChapterCard(ch, ci)));
}

// ── Chapter wrapper ──────────────────────────────────────────────────────────
function buildChapterCard(ch, ci) {
  const node = $('#chapterTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.index = ci;
  if (!Array.isArray(ch.levels)) ch.levels = [];
  if (!ch.completionReward) ch.completionReward = { coins: 0, gems: 0, booster: '', boosterAmount: 1 };

  $('.chapter-num', node).textContent = 'Ch ' + (ci + 1);
  $('.chw-title', node).value = ch.title || '';
  $('.chw-desc', node).value = ch.description || '';

  // Completion bonus
  fillSelect($('.chc-booster', node), options.boosters, ch.completionReward.booster || '');
  $('.chc-coins', node).value = ch.completionReward.coins || 0;
  $('.chc-gems', node).value = ch.completionReward.gems || 0;

  // Level list
  const levelsEl = $('.chapter-levels', node);
  ch.levels.forEach((lv, li) => levelsEl.appendChild(buildLevelCard(lv, ch, ci, li)));

  wireChapterCard(node, ch, ci);
  return node;
}

function wireChapterCard(node, ch, ci) {
  $('.chw-title', node).addEventListener('input', (e) => { ch.title = e.target.value; touch(); });
  $('.chw-desc', node).addEventListener('input', (e) => { ch.description = e.target.value; touch(); });
  $('.chc-coins', node).addEventListener('input', (e) => { ch.completionReward.coins = intval(e.target.value); touch(); });
  $('.chc-gems', node).addEventListener('input', (e) => { ch.completionReward.gems = intval(e.target.value); touch(); });
  $('.chc-booster', node).addEventListener('change', (e) => { ch.completionReward.booster = e.target.value; touch(); });

  $('.add-level', node).addEventListener('click', () => {
    ch.levels.push(newLevel());
    renderChapters(); touch();
  });

  $('.mapedit', node).addEventListener('click', () => { MapEditor.open(ch, ci); });
  $('.up', node).addEventListener('click', () => moveChapter(ci, -1));
  $('.down', node).addEventListener('click', () => moveChapter(ci, +1));
  $('.del', node).addEventListener('click', () => deleteChapter(ci));
  setupDragReorder(node, 'chapter');
}

function newLevel() {
  return {
    title: '', description: '', image: '', dialogue: [{ text: '', duration: 4 }],
    difficulty: 'medium', targetScore: null, rarity: 'common',
    rewards: { coins: 100, gems: 0, booster: '', boosterAmount: 1 },
    mapNode: null, _levelPreserve: false,
  };
}

function moveChapter(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= model.chapters.length) return;
  const [it] = model.chapters.splice(idx, 1);
  model.chapters.splice(j, 0, it);
  renderChapters(); touch();
}
function deleteChapter(idx) {
  if (!confirm('Delete this whole chapter and all its levels?')) return;
  model.chapters.splice(idx, 1);
  renderChapters(); touch();
}

// ── Level card (was the old chapter editor) ──────────────────────────────────
function buildLevelCard(c, ch, ci, li) {
  const node = $('#levelTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.ci = ci;
  node.dataset.li = li;
  $('.level-num', node).textContent = 'L' + (li + 1);
  $('.ch-title', node).value = c.title || '';
  $('.ch-desc', node).value = c.description || '';
  if (!c.dialogue) c.dialogue = [];
  if (!c.rewards) c.rewards = { coins: 0, gems: 0, booster: '', boosterAmount: 1 };

  const preview = $('.ch-image-preview', node);
  const ph = $('.image-col .image-placeholder', node);
  if (c.image) { preview.src = imgUrl('story', c.image); preview.hidden = false; if (ph) ph.hidden = true; }

  fillSelect($('.ch-difficulty', node), options.difficulties, c.difficulty || 'medium');
  fillSelect($('.ch-rarity', node), options.rarities, c.rarity || 'common');
  fillSelect($('.ch-booster', node), options.boosters, (c.rewards && c.rewards.booster) || '');
  fillSelect($('.ch-theme', node), (options.themes || ['legacy', 'modern']), c.theme || 'legacy');

  const bgPreview = $('.ch-bg-preview', node);
  const bgPh = $('.board-bg-drop .image-placeholder', node);
  const bgClear = $('.ch-bg-clear', node);
  if (c.boardBackground && !/^(res:\/\/|https?:)/.test(c.boardBackground)) {
    bgPreview.src = imgUrl('story', c.boardBackground); bgPreview.hidden = false;
    if (bgPh) bgPh.hidden = true; bgClear.hidden = false;
  } else if (c.boardBackground) {
    if (bgPh) bgPh.textContent = 'Custom path set';
    bgClear.hidden = false;
  }

  $('.ch-coins', node).value = (c.rewards && c.rewards.coins) || 0;
  $('.ch-gems', node).value = (c.rewards && c.rewards.gems) || 0;

  const dl = $('.dialogue-list', node);
  (c.dialogue.length ? c.dialogue : [{ text: '', duration: 4 }]).forEach((line) =>
    dl.appendChild(buildDialogueLine(line)));

  wireLevelCard(node, c, ch, ci, li);
  return node;
}

function wireLevelCard(node, c, ch, ci, li) {
  $('.ch-title', node).addEventListener('input', (e) => { c.title = e.target.value; touch(); });
  $('.ch-desc', node).addEventListener('input', (e) => { c.description = e.target.value; touch(); });
  $('.ch-coins', node).addEventListener('input', (e) => { c.rewards.coins = intval(e.target.value); touch(); });
  $('.ch-gems', node).addEventListener('input', (e) => { c.rewards.gems = intval(e.target.value); touch(); });
  $('.ch-booster', node).addEventListener('change', (e) => { c.rewards.booster = e.target.value; touch(); });
  $('.ch-rarity', node).addEventListener('change', (e) => { c.rarity = e.target.value; touch(); });
  $('.ch-theme', node).addEventListener('change', (e) => { c.theme = e.target.value; c._levelPreserve = false; touch(); });

  // Board background override upload/clear
  const bgDrop = $('.board-bg-drop', node);
  const bgInput = $('.ch-bg-input', node);
  const bgClearBtn = $('.ch-bg-clear', node);
  const bgPh2 = $('.board-bg-drop .image-placeholder', node);
  bgDrop.addEventListener('click', () => bgInput.click());
  const onBg = (name) => {
    c.boardBackground = name;
    const p = $('.ch-bg-preview', node);
    p.src = imgUrl('story', name); p.hidden = false;
    if (bgPh2) bgPh2.hidden = true; bgClearBtn.hidden = false;
    touch();
  };
  bgInput.addEventListener('change', () => uploadImage('story', bgInput.files[0], bgDrop, onBg));
  setupDropZone(bgDrop, 'story', onBg);
  bgClearBtn.addEventListener('click', () => {
    c.boardBackground = '';
    const p = $('.ch-bg-preview', node);
    p.hidden = true; if (bgPh2) { bgPh2.hidden = false; bgPh2.textContent = 'Tap to set'; }
    bgClearBtn.hidden = true; touch();
  });

  $('.ch-difficulty', node).addEventListener('change', (e) => {
    c.difficulty = e.target.value;
    c._levelPreserve = false;
    c.targetScore = null;
    touch();
  });

  // Dialogue add/remove/edit
  const dl = $('.dialogue-list', node);
  $('.add-line', node).addEventListener('click', () => {
    c.dialogue.push({ text: '', duration: 4 });
    dl.appendChild(buildDialogueLine({ text: '', duration: 4 }));
    touch();
  });
  dl.addEventListener('input', (e) => {
    const lineEl = e.target.closest('.dialogue-line');
    const i = Array.from(dl.children).indexOf(lineEl);
    if (i < 0 || !c.dialogue[i]) return;
    if (e.target.classList.contains('dl-text')) c.dialogue[i].text = e.target.value;
    if (e.target.classList.contains('dl-duration')) c.dialogue[i].duration = floatval(e.target.value);
    touch();
  });
  dl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('dl-remove')) return;
    const lineEl = e.target.closest('.dialogue-line');
    const i = Array.from(dl.children).indexOf(lineEl);
    if (i >= 0) { c.dialogue.splice(i, 1); lineEl.remove(); touch(); }
  });

  // Narrative image upload
  const drop = $('.image-col .image-drop', node);
  const input = $('.ch-image-input', node);
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => uploadImage('story', input.files[0], drop, (name) => {
    c.image = name; touch();
  }));
  setupDropZone(drop, 'story', (name) => {
    c.image = name;
    const p = $('.ch-image-preview', node);
    p.src = imgUrl('story', name); p.hidden = false;
    $('.image-col .image-placeholder', node).hidden = true;
    touch();
  });

  // Level actions
  $('.preview', node).addEventListener('click', () => { Preview.open(c); });
  $('.up', node).addEventListener('click', () => moveLevel(ci, li, -1));
  $('.down', node).addEventListener('click', () => moveLevel(ci, li, +1));
  $('.dup', node).addEventListener('click', () => duplicateLevel(ci, li));
  $('.del', node).addEventListener('click', () => deleteLevel(ci, li));
}

function moveLevel(ci, li, dir) {
  const levels = model.chapters[ci].levels;
  const j = li + dir;
  if (j < 0 || j >= levels.length) return;
  const [it] = levels.splice(li, 1);
  levels.splice(j, 0, it);
  renderChapters(); touch();
}
function duplicateLevel(ci, li) {
  const copy = JSON.parse(JSON.stringify(model.chapters[ci].levels[li]));
  copy.title = (copy.title || 'Level') + ' (copy)';
  delete copy._stageId; delete copy._levelId; delete copy._rewardNodeId; delete copy._adReward;
  copy._levelPreserve = false; copy.mapNode = null;
  model.chapters[ci].levels.splice(li + 1, 0, copy);
  renderChapters(); touch();
}
function deleteLevel(ci, li) {
  if (!confirm('Delete this level?')) return;
  model.chapters[ci].levels.splice(li, 1);
  renderChapters(); touch();
}

function buildDialogueLine(line) {
  const n = $('#dialogueLineTemplate').content.firstElementChild.cloneNode(true);
  $('.dl-text', n).value = line.text || '';
  $('.dl-duration', n).value = typeof line.duration === 'number' ? line.duration : 4;

  // Per-screen image (optional override of the chapter image).
  const imgDrop = $('.dl-image-drop', n);
  const imgInput = $('.dl-image-input', n);
  const imgPreview = $('.dl-image-preview', n);
  const imgPh = $('.image-placeholder', imgDrop);
  const clearBtn = $('.dl-image-clear', n);
  const showLineImage = (name) => {
    if (name) {
      imgPreview.src = imgUrl('story', name);
      imgPreview.hidden = false; imgPh.hidden = true; clearBtn.hidden = false;
    } else {
      imgPreview.hidden = true; imgPh.hidden = false; clearBtn.hidden = true;
    }
  };
  showLineImage(line.image || '');
  imgDrop.addEventListener('click', () => imgInput.click());
  imgInput.addEventListener('change', () => uploadImage('story', imgInput.files[0], imgDrop, (name) => {
    line.image = name; showLineImage(name); touch();
  }));
  setupDropZone(imgDrop, 'story', (name) => { line.image = name; showLineImage(name); touch(); });
  clearBtn.addEventListener('click', () => { line.image = ''; showLineImage(''); touch(); });

  // Populate the "+ Add effect…" dropdown.
  const addSel = $('.dl-add-effect', n);
  Object.keys(EFFECTS).forEach((key) => {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = EFFECTS[key].label;
    addSel.appendChild(o);
  });
  addSel.addEventListener('change', () => {
    const key = addSel.value;
    addSel.value = '';
    if (!key || !EFFECTS[key]) return;
    if (!Array.isArray(line.effects)) line.effects = [];
    line.effects.push(Object.assign({ type: key }, EFFECTS[key].defaults));
    renderEffectList(n, line);
    touch();
  });

  renderEffectList(n, line);
  return n;
}

// Render the list of effects attached to a dialogue line.
function renderEffectList(lineNode, line) {
  const listEl = $('.effect-list', lineNode);
  listEl.innerHTML = '';
  const effects = Array.isArray(line.effects) ? line.effects : [];
  effects.forEach((fx, i) => listEl.appendChild(buildEffectRow(lineNode, line, fx, i)));
}

function buildEffectRow(lineNode, line, fx, index) {
  migrateEffect(fx);
  const spec = EFFECTS[fx.type];
  const row = $('#effectRowTemplate').content.firstElementChild.cloneNode(true);
  $('.effect-name', row).textContent = spec ? spec.label : fx.type;  $('.effect-remove', row).addEventListener('click', () => {
    line.effects.splice(index, 1);
    renderEffectList(lineNode, line);
    touch();
  });

  const fieldsEl = $('.effect-fields', row);
  if (spec) {
    spec.fields.forEach((f) => fieldsEl.appendChild(buildEffectField(fx, f)));
  } else {
    const warn = document.createElement('div');
    warn.className = 'effect-unknown';
    warn.textContent = 'Unknown effect (kept as-is): ' + fx.type;
    fieldsEl.appendChild(warn);
  }
  return row;
}

function buildEffectField(fx, f) {
  const wrap = document.createElement('label');
  wrap.className = 'effect-field';
  const span = document.createElement('span');
  span.textContent = f.label;
  wrap.appendChild(span);

  let input;
  const cur = fx[f.key];
  if (f.type === 'select') {
    input = document.createElement('select');
    (f.options || []).forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt; o.textContent = cap(opt);
      if (opt === cur) o.selected = true;
      input.appendChild(o);
    });
    input.addEventListener('change', () => { fx[f.key] = input.value; touch(); });
  } else if (f.type === 'color') {
    input = document.createElement('input');
    input.type = 'color';
    input.value = toHex(cur) || '#ffffff';
    input.addEventListener('input', () => { fx[f.key] = input.value; touch(); });
  } else if (f.type === 'range') {
    input = document.createElement('input');
    input.type = 'range';
    input.min = f.min; input.max = f.max; input.step = f.step;
    input.value = (typeof cur === 'number') ? cur : f.min;
    const out = document.createElement('span');
    out.className = 'range-val';
    out.textContent = Number(input.value).toFixed(2);
    input.addEventListener('input', () => {
      fx[f.key] = parseFloat(input.value);
      out.textContent = Number(input.value).toFixed(2);
      touch();
    });
    wrap.appendChild(input);
    wrap.appendChild(out);
    return wrap;
  } else {
    input = document.createElement('input');
    input.type = 'number';
    if (f.min !== undefined) input.min = f.min;
    if (f.max !== undefined) input.max = f.max;
    if (f.step !== undefined) input.step = f.step;
    input.value = (typeof cur === 'number') ? cur : 0;
    input.addEventListener('input', () => { fx[f.key] = parseFloat(input.value); touch(); });
  }
  wrap.appendChild(input);
  return wrap;
}

function toHex(v) {
  if (typeof v !== 'string') return null;
  if (v.startsWith('#')) return v.slice(0, 7);
  const named = { white: '#ffffff', black: '#000000', gold: '#ffe64d', blue: '#4d80ff', purple: '#cc4dff', green: '#33e666', red: '#ff4d4d', pink: '#ff99cc' };
  return named[v] || null;
}

// ── Shards ───────────────────────────────────────────────────────────────────
function renderShards() {
  const list = $('#shardList');
  list.innerHTML = '';
  model.shards.forEach((s, idx) => list.appendChild(buildShardCard(s, idx)));
}
function buildShardCard(s, idx) {
  const node = $('#shardTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.index = idx;
  $('.sh-name', node).value = s.name || '';
  fillSelect($('.sh-rarity', node), options.rarities, s.rarity || 'common');
  fillSelect($('.sh-category', node), options.shardCategories, s.category || 'artifacts');
  $('.sh-required', node).value = s.shards_required || 5;

  const localImg = basenameIfLocal(s.art_asset);
  if (localImg) {
    const preview = $('.sh-image-preview', node);
    preview.src = imgUrl('shard', localImg); preview.hidden = false;
    $('.image-placeholder', node).hidden = true;
  }

  $('.sh-name', node).addEventListener('input', (e) => { s.name = e.target.value; touch(); });
  $('.sh-rarity', node).addEventListener('change', (e) => { s.rarity = e.target.value; touch(); });
  $('.sh-category', node).addEventListener('change', (e) => { s.category = e.target.value; touch(); });
  $('.sh-required', node).addEventListener('input', (e) => { s.shards_required = intval(e.target.value); touch(); });

  const drop = $('.image-drop', node);
  const input = $('.sh-image-input', node);
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => uploadImage('shard', input.files[0], drop, (name) => {
    s.art_asset = name; touch();
  }));
  setupDropZone(drop, 'shard', (name) => {
    s.art_asset = name;
    const preview = $('.sh-image-preview', node);
    preview.src = imgUrl('shard', name); preview.hidden = false;
    $('.image-placeholder', node).hidden = true;
    touch();
  });

  $('.up', node).addEventListener('click', () => moveShard(idx, -1));
  $('.down', node).addEventListener('click', () => moveShard(idx, +1));
  $('.del', node).addEventListener('click', () => deleteShard(idx));
  setupDragReorder(node, 'shard');
  return node;
}
function moveShard(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= model.shards.length) return;
  const [it] = model.shards.splice(idx, 1);
  model.shards.splice(j, 0, it);
  renderShards(); touch();
}
function deleteShard(idx) {
  if (!confirm('Delete this item?')) return;
  model.shards.splice(idx, 1);
  renderShards(); touch();
}

// ── Global buttons ───────────────────────────────────────────────────────────
function bindGlobalButtons() {
  $('#addChapter').addEventListener('click', () => {
    model.chapters.push({
      title: '', description: '',
      mapBackground: '', mapThemeColor: '#3D5A80',
      completionReward: { coins: 0, gems: 0, booster: '', boosterAmount: 1 },
      levels: [newLevel()],
    });
    renderChapters(); touch();
    window.scrollTo(0, document.body.scrollHeight);
  });
  $('#addShard').addEventListener('click', () => {
    model.shards.push({ name: '', rarity: 'common', category: 'artifacts', shards_required: 5, art_asset: '', silhouette_asset: '' });
    renderShards(); touch();
    window.scrollTo(0, document.body.scrollHeight);
  });
  $('#storyTitle').addEventListener('input', (e) => { model.meta.title = e.target.value; touch(); });
  $('#storyDesc').addEventListener('input', (e) => { model.meta.description = e.target.value; touch(); });

  // World-map screen background (behind all chapters)
  const msDrop = $('#mapScreenBgDrop');
  const msInput = $('#mapScreenBgInput');
  const msClear = $('#mapScreenBgClear');
  const msPreview = $('#mapScreenBgPreview');
  const msPh = $('#mapScreenBgDrop .image-placeholder');
  const showMapScreenBg = () => {
    const v = model.meta.mapScreenBackground || '';
    if (v && !/^(res:\/\/|https?:)/.test(v)) {
      msPreview.src = imgUrl('story', v); msPreview.hidden = false;
      if (msPh) msPh.hidden = true; msClear.hidden = false;
    } else if (v) {
      if (msPh) { msPh.hidden = false; msPh.textContent = 'Custom path'; } msClear.hidden = false;
    } else {
      msPreview.hidden = true; if (msPh) { msPh.hidden = false; msPh.textContent = 'Tap to set'; } msClear.hidden = true;
    }
  };
  showMapScreenBg();
  msDrop.addEventListener('click', () => msInput.click());
  msInput.addEventListener('change', () => uploadImage('story', msInput.files[0], msDrop, (name) => {
    model.meta.mapScreenBackground = name; showMapScreenBg(); touch();
  }));
  setupDropZone(msDrop, 'story', (name) => { model.meta.mapScreenBackground = name; showMapScreenBg(); touch(); });
  msClear.addEventListener('click', () => { model.meta.mapScreenBackground = ''; showMapScreenBg(); touch(); });

  $('#btnValidate').addEventListener('click', runValidation);
  $('#btnSave').addEventListener('click', saveIntoGame);
  $('#btnReseed').addEventListener('click', reseed);

  // "Download content pack" — on the offline/Android build this must NOT navigate
  // to /api/export (that blanks the WebView). Route it through the safe in-app
  // export (share sheet on Android, download in a browser).
  const exp = $('#btnExport');
  if (exp) {
    exp.addEventListener('click', async (e) => {
      if (typeof window.__SB_exportPack === 'function') {
        e.preventDefault();
        await flushSave();
        window.__SB_exportPack();
      }
      // Otherwise (desktop server): let the <a href="/api/export"> download run.
    });
  }
}

function refreshSettings() { runValidation(); }

async function runValidation() {
  await flushSave();
  const res = await fetchJson('/api/validate');
  const box = $('#validation');
  box.innerHTML = '';
  if (res.ok && res.warnings.length === 0) {
    box.appendChild(vItem('ok', 'Everything looks good!'));
  }
  res.errors.forEach((m) => box.appendChild(vItem('error', m)));
  res.warnings.forEach((m) => box.appendChild(vItem('warn', m)));
  return res;
}
function vItem(kind, msg) {
  const d = document.createElement('div');
  d.className = 'v-item v-' + kind;
  d.textContent = (kind === 'error' ? '⛔ ' : kind === 'warn' ? '⚠️ ' : '✅ ') + msg;
  return d;
}

async function saveIntoGame() {
  await flushSave();
  const result = $('#saveResult');
  result.className = 'result';
  result.textContent = 'Saving… (importing images may take a moment)';
  try {
    const res = await fetch('/api/save', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      result.className = 'result err';
      result.textContent = '⛔ ' + (data.error || 'Save failed') +
        (data.errors ? ' — ' + data.errors.join(' ') : '');
      return;
    }
    result.className = 'result ok';
    const imgNote = data.imported
      ? 'New images were imported automatically.'
      : 'Open the project in Godot once to import new images (Godot not found on this machine).';
    result.textContent = `✅ Saved ${data.chapters} chapter(s), ${data.levels} level(s) and ${data.shards} shard(s) into the game. ${imgNote}`;
  } catch (e) {
    result.className = 'result err';
    result.textContent = '⛔ ' + e.message;
  }
}

async function reseed() {
  if (!confirm('Discard your changes and reload the story from the game?')) return;
  model = await fetchJson('/api/reseed', { method: 'POST' });
  normalizeModel();
  renderAll();
}

// ── Image upload helpers ─────────────────────────────────────────────────────
async function uploadImage(kind, file, dropEl, onDone) {
  if (!file) return;
  dropEl.classList.add('uploading');
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload?kind=' + kind, { method: 'POST', body: fd });
    const data = await res.json();
    if (data.name) {
      // Update the preview inside THIS drop zone only (works for chapter,
      // shard, and per-dialogue-line images alike).
      const preview = dropEl.querySelector('img');
      if (preview) { preview.src = imgUrl(kind, data.name); preview.hidden = false; }
      const ph = $('.image-placeholder', dropEl); if (ph) ph.hidden = true;
      onDone(data.name);
    }
  } finally {
    dropEl.classList.remove('uploading');
  }
}

function setupDropZone(dropEl, kind, onName) {
  ['dragenter', 'dragover'].forEach((ev) => dropEl.addEventListener(ev, (e) => {
    e.preventDefault(); dropEl.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((ev) => dropEl.addEventListener(ev, (e) => {
    e.preventDefault(); dropEl.classList.remove('dragover');
  }));
  dropEl.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) uploadImage(kind, file, dropEl, onName);
  });
}

// ── Drag reorder (chapters & shards) ─────────────────────────────────────────
let dragEl = null, dragKind = null;
function setupDragReorder(node, kind) {
  const handle = $('.drag-handle', node);
  handle.setAttribute('draggable', 'true');
  handle.addEventListener('dragstart', (e) => {
    dragEl = node; dragKind = kind; node.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  handle.addEventListener('dragend', () => {
    if (dragEl) dragEl.classList.remove('dragging');
    dragEl = null; dragKind = null;
    $$('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  });
  node.addEventListener('dragover', (e) => {
    if (!dragEl || dragKind !== kind || dragEl === node) return;
    e.preventDefault();
    node.classList.add('drop-target');
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
  node.addEventListener('drop', (e) => {
    if (!dragEl || dragKind !== kind || dragEl === node) return;
    e.preventDefault();
    node.classList.remove('drop-target');
    const arr = kind === 'chapter' ? model.chapters : model.shards;
    const from = parseInt(dragEl.dataset.index, 10);
    const to = parseInt(node.dataset.index, 10);
    const [it] = arr.splice(from, 1);
    arr.splice(to, 0, it);
    kind === 'chapter' ? renderChapters() : renderShards();
    touch();
  });
}

// ── Autosave ─────────────────────────────────────────────────────────────────
function touch() {
  setSaveState('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}
async function flushSave() {
  clearTimeout(saveTimer);
  await fetch('/api/project', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  });
  setSaveState('saved');
}
function setSaveState(state) {
  const el = $('#saveState');
  el.className = 'save-state ' + state;
  el.textContent = state === 'saving' ? 'Saving…' : 'Saved';
}

// ── Utils ────────────────────────────────────────────────────────────────────
async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}
function imgUrl(kind, name) {
  if (typeof window.__SB_IMG_URL === 'function') return window.__SB_IMG_URL(kind, name) || '';
  return '/img/' + kind + '/' + encodeURIComponent(name) + '?t=' + Date.now();
}
function basenameIfLocal(asset) {
  if (!asset || asset.startsWith('http')) return '';
  return String(asset).split('/').pop();
}
function intval(v) { const n = parseInt(v, 10); return Number.isNaN(n) ? 0 : n; }
function floatval(v) { const n = parseFloat(v); return Number.isNaN(n) ? 4 : n; }
function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

boot();
