'use strict';

/**
 * Syntax-check all first-party JS with `node --check`, so broken files fail CI
 * fast. Skips node_modules and vendored libs. Excludes engine-lib.js (generated).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = ['node_modules', 'vendor', 'www'];
const SKIP_FILES = [path.join('webapp', 'src', 'engine-lib.js')];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = path.relative(ROOT, abs);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      if (SKIP_DIRS.includes(name)) continue;
      walk(abs, out);
    } else if (name.endsWith('.js') && !SKIP_FILES.includes(rel)) {
      out.push(abs);
    }
  }
}

const files = [];
walk(ROOT, files);

let failed = 0;
for (const f of files) {
  try {
    execFileSync('node', ['--check', f], { stdio: 'pipe' });
    console.log('  \u2713', path.relative(ROOT, f));
  } catch (e) {
    failed++;
    console.log('  \u2717', path.relative(ROOT, f));
    process.stderr.write((e.stderr || Buffer.from('')).toString());
  }
}

console.log('');
if (failed === 0) { console.log(`Syntax OK — ${files.length} file(s)`); process.exit(0); }
else { console.log(`Syntax FAILED — ${failed} file(s)`); process.exit(1); }
