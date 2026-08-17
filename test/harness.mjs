// Pull functions and constants straight out of the SHIPPED index.html and make
// them callable, so the tests exercise the real code — no copy-paste, no build
// step. Same approach the bookkeeper repo uses.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

// The single big <script> at the bottom of the file.
export const SCRIPT = (() => {
  const blocks = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) throw new Error('no inline <script> found in index.html');
  return blocks.reduce((a, b) => (a.length > b.length ? a : b), '');
})();

// Walk forward from `start` (which must be an opening bracket) to its match,
// skipping anything inside strings, template literals, regexes or comments.
function matchBracket(src, start) {
  const open = src[start];
  const close = {'{': '}', '(': ')', '[': ']'}[open];
  if (!close) throw new Error('not a bracket at ' + start);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === q) break;
        // `${ ... }` can contain anything, brackets included — skip the whole span.
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') i = matchBracket(src, i + 1);
      }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  throw new Error('unbalanced bracket from ' + start);
}

// `function name(...) { ... }`
export function extractFn(name) {
  const re = new RegExp('(?:^|\\n)\\s*function\\s+' + name + '\\s*\\(');
  const m = SCRIPT.match(re);
  if (!m) throw new Error('function not found: ' + name);
  const start = m.index + m[0].indexOf('function');
  const paren = SCRIPT.indexOf('(', start);
  const brace = SCRIPT.indexOf('{', matchBracket(SCRIPT, paren));
  return SCRIPT.slice(start, matchBracket(SCRIPT, brace) + 1);
}

// Walk a template literal from its opening backtick to the closing one,
// skipping escapes and `${ … }` spans (which may themselves hold backticks).
function matchTemplate(src, start) {
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '`') return i;
    if (src[i] === '$' && src[i + 1] === '{') i = matchBracket(src, i + 1);
  }
  throw new Error('unterminated template literal from ' + start);
}

// `const NAME = <expr>;` — the expression may be an object/array literal or a
// template literal (the setup SQL is one, and it is full of semicolons).
export function extractConst(name) {
  const re = new RegExp('(?:^|\\n)\\s*const\\s+' + name + '\\s*=\\s*');
  const m = SCRIPT.match(re);
  if (!m) throw new Error('const not found: ' + name);
  const valueAt = m.index + m[0].length;
  const first = SCRIPT[valueAt];
  let end;
  if (first === '{' || first === '[') end = matchBracket(SCRIPT, valueAt) + 1;
  else if (first === '`') end = matchTemplate(SCRIPT, valueAt) + 1;
  else end = SCRIPT.indexOf(';', valueAt);
  return `const ${name} = ` + SCRIPT.slice(valueAt, end) + ';';
}

// Build a sandbox holding the named functions/consts plus the module-level state
// they read. `today` is left overridable so date-dependent logic can be pinned.
export function sandbox({fns = [], consts = []} = {}) {
  const src = `
    let profile = {};
    let cache = {teachers: [], assignments: []};
    ${consts.map(extractConst).join('\n')}
    ${fns.map(extractFn).join('\n')}
    return {
      ${fns.join(', ')},
      get profile() { return profile; },  set profile(v) { profile = v; },
      get cache() { return cache; },      set cache(v) { cache = v; },
      setToday(fn) { today = fn; }
    };`;
  return new Function(src)();
}

// ── tiny test runner ────────────────────────────────────────────────────────
let failures = 0, count = 0;
export function eq(actual, expected, label) {
  count++;
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) { failures++; console.error(`  ✗ ${label}\n      expected ${b}\n      got      ${a}`); }
}
export function ok(cond, label) { eq(!!cond, true, label); }
export function done(suite) {
  if (failures) { console.error(`\n${suite}: ${failures} of ${count} checks FAILED`); process.exit(1); }
  console.log(`${suite}: ${count} checks passed`);
}
