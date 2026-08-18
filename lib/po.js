'use strict';

/**
 * Minimal gettext .po reader/writer that matches the format
 * systems/TranslationBootstrap.gd parses at runtime.
 *
 * Only single-line msgid/msgstr are used (that's what the game's parser and
 * the existing strings_*.po files use). We escape \, " and newlines.
 */

const fs = require('fs');

function unescapePo(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function escapePo(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

/** Parse a .po file into { msgid: msgstr } (skips the empty header msgid). */
function readPo(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  let curId = null;
  let curStr = null;
  let inStr = false;
  const flush = () => {
    if (curId !== null && curId !== '' && curStr !== null) out[curId] = curStr;
    curId = null; curStr = null; inStr = false;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('msgid ')) {
      flush();
      curId = unescapePo(stripQuotes(line.slice(6)));
      curStr = '';
      inStr = false;
    } else if (line.startsWith('msgstr ')) {
      curStr = unescapePo(stripQuotes(line.slice(7)));
      inStr = true;
    } else if (line.startsWith('"') && inStr && curStr !== null) {
      curStr += unescapePo(stripQuotes(line));
    } else if (line.startsWith('"') && !inStr && curId !== null) {
      curId += unescapePo(stripQuotes(line));
    } else if (line === '' && curId !== null) {
      flush();
    }
  }
  flush();
  return out;
}

function stripQuotes(s) {
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

function poHeader(langName, langCode) {
  return [
    '# Translation file for Match-3 Game',
    `# Language: ${langName} (${langCode})`,
    '#',
    'msgid ""',
    'msgstr ""',
    `"Language: ${langCode}\\n"`,
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"',
    '',
    '',
  ].join('\n');
}

/**
 * Write a .po file from an ordered list of {id, str} entries.
 * Preserves insertion order.
 */
function writePo(filePath, langName, langCode, entries) {
  let body = poHeader(langName, langCode);
  for (const { id, str } of entries) {
    body += `msgid "${escapePo(id)}"\n`;
    body += `msgstr "${escapePo(str)}"\n\n`;
  }
  fs.writeFileSync(filePath, body, 'utf8');
}

module.exports = { readPo, writePo, escapePo, poHeader };
