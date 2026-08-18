'use strict';

/** Plain-English validation of the model before save/export. */

const { DIFFICULTY_PRESETS, RARITIES, SHARD_CATEGORIES } = require('./config');

function validate(model) {
  const errors = [];
  const warnings = [];

  const chapters = model.chapters || [];
  if (chapters.length === 0) errors.push('There are no chapters. Add at least one chapter.');

  let totalLevels = 0;
  chapters.forEach((ch, ci) => {
    const chLabel = `Chapter ${ci + 1}${ch.title ? ` (“${ch.title}”)` : ''}`;
    if (!ch.title || !ch.title.trim()) warnings.push(`${chLabel} has no title.`);
    const levels = Array.isArray(ch.levels) ? ch.levels : [];
    if (levels.length === 0) warnings.push(`${chLabel} has no levels.`);
    const cr = ch.completionReward || {};
    if ((cr.coins || 0) < 0 || (cr.gems || 0) < 0) errors.push(`${chLabel} has a negative completion bonus.`);

    levels.forEach((c, li) => {
      totalLevels++;
      const label = `${chLabel} · Level ${li + 1}${c.title ? ` (“${c.title}”)` : ''}`;
      if (!c.image) warnings.push(`${label} has no story image.`);
      const dialogue = (c.dialogue || []).filter((d) => (d.text || '').trim() !== '');
      if (dialogue.length === 0) warnings.push(`${label} has no intro dialogue text.`);
      if (c.difficulty && !DIFFICULTY_PRESETS[c.difficulty]) {
        errors.push(`${label} has an unknown difficulty “${c.difficulty}”.`);
      }
      if (c.rarity && !RARITIES.includes(c.rarity)) {
        errors.push(`${label} has an unknown rarity “${c.rarity}”.`);
      }
      const r = c.rewards || {};
      if ((r.coins || 0) < 0 || (r.gems || 0) < 0) errors.push(`${label} has a negative reward amount.`);
      (c.dialogue || []).forEach((d, di) => {
        if (typeof d.duration === 'number' && (d.duration <= 0 || d.duration > 60)) {
          warnings.push(`${label} line ${di + 1} has an unusual duration (${d.duration}s).`);
        }
      });
    });
  });
  if (totalLevels === 0) errors.push('There are no levels. Add at least one level to a chapter.');

  const shards = model.shards || [];
  const seen = new Set();
  shards.forEach((s, i) => {
    const label = `Shard ${i + 1}${s.name ? ` (“${s.name}”)` : ''}`;
    if (!s.name || !s.name.trim()) warnings.push(`${label} has no name.`);
    if (!s.art_asset) warnings.push(`${label} has no image.`);
    if (s.category && !SHARD_CATEGORIES.includes(s.category)) {
      warnings.push(`${label} uses a non-standard category “${s.category}”.`);
    }
    if (s.rarity && !RARITIES.includes(s.rarity)) {
      errors.push(`${label} has an unknown rarity “${s.rarity}”.`);
    }
    const req = Number(s.shards_required);
    if (!(req >= 1)) errors.push(`${label} needs “shards required” to be 1 or more.`);
    if (s.name) {
      const key = s.name.trim().toLowerCase();
      if (seen.has(key)) warnings.push(`${label} has a duplicate name.`);
      seen.add(key);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validate };
