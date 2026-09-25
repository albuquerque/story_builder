'use strict';

/**
 * validate-pack.js — content-pack boundary guardrail.
 *
 * Verifies that a data/ folder (or the game project) keeps content and app-level
 * assets properly separated. Catches the class of problems where a content pack
 * overwrites UI translations, empties container configs, or deletes app assets.
 *
 * Usage:
 *   node validate-pack.js [dataDir]     # defaults to the game project's data/
 *
 * Exit code 0 = OK, 1 = violations found.
 */

const fs = require('fs');
const path = require('path');
const { PATHS, PACK_ID, APP_LEVEL_PATHS } = require('./lib/config');
const { readPo } = require('./lib/po');

/**
 * Validate the content-pack boundary in a data directory.
 * Returns { ok, errors, warnings }.
 */
function validateBoundary(dataDir) {
  const errors = [];
  const warnings = [];
  const exists = (rel) => fs.existsSync(path.join(dataDir, rel));

  // 1) UI translations (translations/core) must contain NO NARRATIVE_ content
  //    keys (except NARRATIVE_SKIP, an app-level control label).
  for (const lang of ['en', 'es', 'pt', 'fr']) {
    const p = path.join(dataDir, 'translations', 'core', `strings_${lang}.po`);
    if (fs.existsSync(p)) {
      const keys = Object.keys(readPo(p));
      const uiCount = keys.filter((k) => !k.startsWith('NARRATIVE_')).length;
      const leaked = keys.filter((k) => k.startsWith('NARRATIVE_') && k !== 'NARRATIVE_SKIP');
      if (leaked.length) {
        errors.push(`translations/core/strings_${lang}.po contains ${leaked.length} NARRATIVE_ content keys (e.g. ${leaked[0]}). UI translations must not include pack content.`);
      }
      if (uiCount === 0) {
        errors.push(`translations/core/strings_${lang}.po has 0 UI keys — UI strings appear to have been wiped.`);
      }
    } else {
      warnings.push(`Missing app-level UI translation: translations/core/strings_${lang}.po`);
    }
  }

  // 2) Content-pack narrative files must contain ONLY NARRATIVE_ keys.
  for (const lang of ['en', 'es', 'pt', 'fr']) {
    const p = path.join(dataDir, 'content_packs', PACK_ID, 'translations', `narrative_${lang}.po`);
    if (fs.existsSync(p)) {
      const keys = Object.keys(readPo(p));
      const nonNarr = keys.filter((k) => !k.startsWith('NARRATIVE_'));
      if (nonNarr.length) {
        errors.push(`content_packs/${PACK_ID}/translations/narrative_${lang}.po contains ${nonNarr.length} non-narrative keys (e.g. ${nonNarr[0]}). Content packs must not include UI keys.`);
      }
    }
  }

  // 3) App-level assets must be present (a pack must never delete them).
  const REQUIRED_APP_ASSETS = [
    'themes/themes.json',
    'reward_containers/simple_box.json',
    'reward_containers/fade_chest_example.json',
    'container_selection_rules.json',
    'theme_container_mappings.json',
  ];
  for (const rel of REQUIRED_APP_ASSETS) {
    if (!exists(rel)) {
      errors.push(`Missing app-level asset: data/${rel} (a content pack must never delete app-level files).`);
    }
  }

  // 4) At least one theme folder with tile art must exist.
  if (exists('themes/legacy/tiles')) {
    const tiles = fs.readdirSync(path.join(dataDir, 'themes', 'legacy', 'tiles')).filter((f) => f.endsWith('.png'));
    if (tiles.length === 0) {
      errors.push('data/themes/legacy/tiles/ has no tile PNGs — board would render as flat colors.');
    }
  } else {
    errors.push('Missing data/themes/legacy/tiles/ — board tile art is absent.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateBoundary };

// CLI entry point.
if (require.main === module) {
  const dataDir = process.argv[2] ? path.resolve(process.argv[2]) : PATHS.data;
  const { ok, errors, warnings } = validateBoundary(dataDir);
  console.log(`Validating content-pack boundary in: ${dataDir}\n`);
  if (warnings.length) {
    console.log('Warnings:');
    warnings.forEach((w) => console.log('  ⚠ ' + w));
    console.log('');
  }
  if (!ok) {
    console.log('ERRORS:');
    errors.forEach((e) => console.log('  ✗ ' + e));
    console.log(`\n${errors.length} violation(s) found. App-level assets must stay separate from content packs.`);
    console.log('App-level paths (never owned by a pack):');
    APP_LEVEL_PATHS.forEach((p) => console.log('  - data/' + p));
    process.exit(1);
  } else {
    console.log('✓ Content-pack boundary OK — content and app-level assets are properly separated.');
    process.exit(0);
  }
}
