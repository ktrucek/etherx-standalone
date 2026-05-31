#!/usr/bin/env node
/**
 * EtherX v3.0 — Extract inline CSS/JS from src/index.html
 * into separate files for Opcija 3 structure.
 *
 * Output:
 *   src/renderer/css/browser.css  ← extracted CSS
 *   src/renderer/js/browser.js   ← extracted JS
 *   src/index.html               ← slim HTML skeleton (~6k lines)
 *   src/renderer/browser.html    ← slim HTML skeleton (same, adjusted paths)
 *
 * Usage:  node scripts/extract-v3.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const INDEX = path.join(SRC, 'index.html');
const CSS_OUT = path.join(SRC, 'renderer', 'css', 'browser.css');
const JS_OUT = path.join(SRC, 'renderer', 'js', 'browser.js');
const BROWSER = path.join(SRC, 'renderer', 'browser.html');

const DRY = process.argv.includes('--dry-run');

// ─── Read source ─────────────────────────────────────────────────────────────
console.log('Reading src/index.html …');
const html = fs.readFileSync(INDEX, 'utf8');
const lines = html.split('\n');
console.log(`  Total lines: ${lines.length}`);

// ─── Find <style> block ───────────────────────────────────────────────────────
const styleOpen = lines.findIndex(l => /^\s*<style>\s*$/.test(l));
const styleClose = lines.findIndex((l, i) => i > styleOpen && /^\s*<\/style>\s*$/.test(l));

if (styleOpen === -1 || styleClose === -1) {
    console.error('ERROR: Could not find <style>…</style> block');
    process.exit(1);
}
console.log(`  CSS block : lines ${styleOpen + 1}–${styleClose + 1} (${styleClose - styleOpen - 1} lines)`);

// ─── Find <script> block (last one — the big inline block) ───────────────────
let scriptOpen = -1;
let scriptClose = -1;
for (let i = lines.length - 1; i >= 0; i--) {
    if (scriptClose === -1 && /^\s*<\/script>\s*$/.test(lines[i])) {
        scriptClose = i;
    } else if (scriptClose !== -1 && /^\s*<script>\s*$/.test(lines[i])) {
        scriptOpen = i;
        break;
    }
}

if (scriptOpen === -1 || scriptClose === -1) {
    console.error('ERROR: Could not find inline <script>…</script> block');
    process.exit(1);
}
console.log(`  JS  block : lines ${scriptOpen + 1}–${scriptClose + 1} (${scriptClose - scriptOpen - 1} lines)`);

// ─── Extract CSS and JS content ───────────────────────────────────────────────
const cssContent = lines.slice(styleOpen + 1, styleClose).join('\n');
const jsContent = lines.slice(scriptOpen + 1, scriptClose).join('\n');

// ─── Build slim HTML (index.html version) ─────────────────────────────────────
// Replace <style>…</style> with <link>
// Replace <script>…</script> with <script src>
const beforeStyle = lines.slice(0, styleOpen);
const afterStyle = lines.slice(styleClose + 1, scriptOpen);
const afterScript = lines.slice(scriptClose + 1);

const slimIndexLines = [
    ...beforeStyle,
    '    <link rel="stylesheet" href="renderer/css/browser.css">',
    ...afterStyle,
    '    <script src="renderer/js/browser.js"></script>',
    ...afterScript,
];
const slimIndex = slimIndexLines.join('\n');

// ─── Build slim HTML (browser.html version — paths go up one level) ───────────
const slimBrowserLines = [
    ...beforeStyle,
    '    <link rel="stylesheet" href="css/browser.css">',
    ...afterStyle,
    '    <script src="js/browser.js"></script>',
    ...afterScript,
];
const slimBrowser = slimBrowserLines.join('\n');

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\nPlan:');
console.log(`  browser.css  : ${cssContent.split('\n').length} lines  → ${CSS_OUT.replace(ROOT, '.')}`);
console.log(`  browser.js   : ${jsContent.split('\n').length} lines  → ${JS_OUT.replace(ROOT, '.')}`);
console.log(`  index.html   : ${slimIndexLines.length} lines  (was ${lines.length})`);
console.log(`  browser.html : ${slimBrowserLines.length} lines  (was ${lines.length})`);

if (DRY) {
    console.log('\n[DRY RUN] No files written.');
    process.exit(0);
}

// ─── Write files ─────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(CSS_OUT), { recursive: true });
fs.mkdirSync(path.dirname(JS_OUT), { recursive: true });

// Backup originals
const ts = new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(INDEX, `${INDEX}.backup-${ts}`);
fs.copyFileSync(BROWSER, `${BROWSER}.backup-${ts}`);
console.log(`\nBackup created: src/index.html.backup-${ts}`);

fs.writeFileSync(CSS_OUT, cssContent, 'utf8');
fs.writeFileSync(JS_OUT, jsContent, 'utf8');
fs.writeFileSync(INDEX, slimIndex, 'utf8');
fs.writeFileSync(BROWSER, slimBrowser, 'utf8');

console.log('\nDone! Files written:');
console.log('  ✅ src/renderer/css/browser.css');
console.log('  ✅ src/renderer/js/browser.js');
console.log('  ✅ src/index.html  (slim skeleton)');
console.log('  ✅ src/renderer/browser.html  (slim skeleton)');
console.log('\nNext: node --check src/renderer/js/browser.js && ./deploy.sh');
