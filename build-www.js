#!/usr/bin/env node
'use strict';

/**
 * Assemble webapp/www/ — the Capacitor webDir for the offline Android app.
 * - Extracts the <body> UI markup (panels + templates, no scripts) from
 *   public/index.html into www/app-body.html.
 * - Copies shared assets: styles.css, preview.js, mapeditor.js, app.js.
 * - Copies the offline stack: index.html (from index.template.html), src/*,
 *   vendor/*, base-data.zip.
 */

const fs = require('fs');
const path = require('path');

const SB = __dirname;
const PUBLIC = path.join(SB, 'public');
const WEBAPP = path.join(SB, 'webapp');
const WWW = path.join(WEBAPP, 'www');

function cp(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

// 1. Extract body UI (everything inside <body> except <script> tags).
const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const bodyMatch = indexHtml.match(/<body>([\s\S]*?)<\/body>/i);
let body = bodyMatch ? bodyMatch[1] : '';
body = body.replace(/<script[\s\S]*?<\/script>/gi, ''); // strip script tags
fs.writeFileSync(path.join(WWW, 'app-body.html'), body.trim() + '\n', 'utf8');

// 2. Shared UI assets.
for (const f of ['styles.css', 'preview.js', 'mapeditor.js', 'app.js']) {
  cp(path.join(PUBLIC, f), path.join(WWW, f));
}

// 3. Offline index.html (from template).
cp(path.join(WEBAPP, 'index.template.html'), path.join(WWW, 'index.html'));

// 4. Offline src + vendor.
for (const f of ['vfs.js', 'engine-lib.js', 'engine.js', 'api-adapter.js', 'boot.js']) {
  cp(path.join(WEBAPP, 'src', f), path.join(WWW, 'src', f));
}
cp(path.join(WEBAPP, 'vendor', 'jszip.min.js'), path.join(WWW, 'vendor', 'jszip.min.js'));

// 5. Seed data.
if (fs.existsSync(path.join(WEBAPP, 'base-data.zip'))) {
  cp(path.join(WEBAPP, 'base-data.zip'), path.join(WWW, 'base-data.zip'));
} else {
  console.warn('WARNING: base-data.zip missing — run build-seed.js first');
}

// 6. Offline-bar CSS append.
fs.appendFileSync(path.join(WWW, 'styles.css'), `
/* Offline / Android top bar */
.offline-bar { position: sticky; top: 0; z-index: 30; display: flex; gap: 6px; align-items: center;
  flex-wrap: wrap; background: #2a2740; border-bottom: 1px solid #322e46; padding: 8px 10px; }
.offline-bar > span { color: var(--accent2); font-weight: 600; font-size: 13px; margin-right: auto; }
`);

console.log('Assembled webapp/www/');
console.log('  files:', fs.readdirSync(WWW).join(', '));
