// Static checks on the shipped file. Every failure here is the kind that does
// NOTHING at runtime — a mistyped element id, an onclick naming a function that
// doesn't exist, a page with no renderer — which is exactly what reading the
// diff misses. Run: node test/build.test.mjs
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {HTML, SCRIPT, ROOT, extractConst, eq, ok, done} from './harness.mjs';

// ── the script has to parse ─────────────────────────────────────────────────
let syntax = 'ok';
try { new Function(SCRIPT); } catch (e) { syntax = e.message; }
eq(syntax, 'ok', 'the inline script parses');

// ── every id the script reaches for exists in the markup ────────────────────
const markupIds = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const wanted = new Set([...SCRIPT.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]));
for (const id of wanted) ok(markupIds.has(id), `#${id} is referenced by the script and exists in the markup`);

// Ids reached by querySelector('#id') too.
for (const m of SCRIPT.matchAll(/querySelector\(['"]#([\w-]+)['"]\)/g)) {
  ok(markupIds.has(m[1]), `#${m[1]} (querySelector) exists in the markup`);
}

// ── every inline handler names a function that exists ───────────────────────
const declared = new Set([...SCRIPT.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
const BUILTIN = new Set(['if', 'return', 'event', 'this', 'true', 'false', 'null', 'typeof', 'new', 'Number', 'String', 'parseInt', 'parseFloat']);
const handlers = [...HTML.matchAll(/\son(?:click|input|change|submit|keydown)="([^"]*)"/g)].map(m => m[1]);
ok(handlers.length > 10, 'inline handlers were found to check');
for (const h of handlers) {
  for (const call of h.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = call[1];
    if (BUILTIN.has(name)) continue;
    ok(declared.has(name), `onclick="${name}(…)" has a matching function`);
  }
}

// ── pages: nav item <-> #page-<id> <-> PAGE_META, all three or none ─────────
const pageMetaSrc = extractConst('PAGE_META');
const metaIds = [...pageMetaSrc.matchAll(/(?:^|[\s{,])([a-z]+):\s*\{/g)].map(m => m[1]);
ok(metaIds.length >= 5, 'PAGE_META has an entry per page');
const navPages = [...HTML.matchAll(/data-page="([^"]+)"/g)].map(m => m[1]);
const actionIds = [...extractConst('PAGE_ACTIONS').matchAll(/(?:^|[\s{,])([a-z]+):\s*'/g)].map(m => m[1]);

for (const p of metaIds) {
  ok(markupIds.has('page-' + p), `PAGE_META.${p} has a #page-${p} element`);
  ok(navPages.includes(p), `PAGE_META.${p} has a nav item`);
  ok(actionIds.includes(p), `PAGE_META.${p} has a PAGE_ACTIONS entry (use '' for none)`);
}
for (const p of new Set(navPages)) ok(metaIds.includes(p), `nav item "${p}" has a PAGE_META entry`);
// Every renderer named in PAGE_META must actually exist, or opening that tab
// throws and leaves the previous page's content on screen.
for (const m of pageMetaSrc.matchAll(/render:\s*([A-Za-z_$][\w$]*)/g)) {
  ok(declared.has(m[1]), `PAGE_META renderer ${m[1]}() is defined`);
}
// Every showPage('x') target is a real page.
for (const m of HTML.matchAll(/showPage\('([^']+)'\)/g)) ok(metaIds.includes(m[1]), `showPage('${m[1]}') targets a real page`);

// ── first-run centring is set in one place and cleared in another ───────────
// renderHome adds .centred to the content area; showPage clears it. Lose the
// clear and every OTHER page inherits the centring, lose the rule and the
// first screen goes back to hugging the top bar — neither errors anywhere.
ok(/classList\.toggle\('centred'/.test(SCRIPT), 'renderHome toggles .centred on the content area');
ok(/classList\.remove\('centred'\)/.test(SCRIPT), 'showPage clears .centred so it cannot leak to another page');
ok(/\.content\.centred/.test(HTML), 'the .centred layout rule exists in the stylesheet');

// ── the setup screen's SQL and schema.sql must not drift ────────────────────
// The app shows SETUP_SQL to a user who may never open the repo; schema.sql is
// what anyone reading the repo runs. If they disagree, one of them is wrong.
const setupSql = extractConst('SETUP_SQL').replace(/^const SETUP_SQL = `/, '').replace(/`;$/, '');
const fileSql = readFileSync(join(ROOT, 'schema.sql'), 'utf8');
eq(fileSql.trim(), setupSql.trim(), 'schema.sql matches the SQL the setup screen shows');

// Both copies must actually switch RLS on for every table — without it the
// published anon key would expose every row to anyone.
for (const t of ['profiles', 'teachers', 'assignments']) {
  ok(new RegExp(`alter table ${t} enable row level security`).test(fileSql), `${t} has row level security enabled`);
  ok(new RegExp(`create policy ${t}_own`).test(fileSql), `${t} has an owner-only policy`);
}

// ── PWA files line up ───────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
for (const i of manifest.icons) ok(existsSync(join(ROOT, i.src)), `manifest icon ${i.src} exists on disk`);
ok(manifest.icons.some(i => i.purpose === 'maskable'), 'a maskable icon is declared');
for (const m of HTML.matchAll(/<link[^>]+href="(icon[^"]*\.png)"/g)) ok(existsSync(join(ROOT, m[1])), `${m[1]} referenced by index.html exists`);

// ── the Worker and the client have to agree about /config.json ─────────────
// The connection lives in Cloudflare's environment; if these two drift the app
// silently falls back to asking every device to set itself up by hand.
const worker = readFileSync(join(ROOT, 'worker/index.js'), 'utf8');
const wrangler = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');

const clientPath = SCRIPT.match(/fetch\('([\w./-]*config\.json)/);
ok(clientPath, 'the client fetches a config endpoint');
ok(worker.includes(`'/${clientPath[1]}'`), `the Worker serves /${clientPath[1]}, which is what the client asks for`);
for (const v of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
  ok(worker.includes('env.' + v), `the Worker reads env.${v}`);
  // Declaring these in wrangler.toml would overwrite the dashboard values on
  // every deploy — the whole point is that a push can't blank them out.
  ok(!new RegExp('^\\s*' + v + '\\s*=', 'm').test(wrangler), `${v} is NOT declared in wrangler.toml`);
}
ok(/^main\s*=/m.test(wrangler), 'wrangler.toml points at the Worker script');
ok(/binding\s*=\s*"ASSETS"/.test(wrangler) && worker.includes('env.ASSETS'), 'the assets binding is declared and used');
// SPA not-found handling answers unmatched paths from the assets WITHOUT running
// the Worker, which would swallow /config.json before it is ever reached.
ok(/not_found_handling\s*=\s*"none"/.test(wrangler), 'not_found_handling is "none" so the Worker sees unmatched paths');
ok(ignoreHasWorker(), 'worker/ is excluded from the deployed assets');
function ignoreHasWorker() {
  return readFileSync(join(ROOT, '.assetsignore'), 'utf8').split('\n').map(s => s.trim()).includes('worker/');
}

// ── the deploy workflow is the only gate before a change reaches a phone ────
const wf = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
ok(/branches:\s*\[main\]/.test(wf), 'the workflow deploys on push to main');
ok(/wrangler-action/.test(wf), 'the workflow actually deploys');
// The tests must run BEFORE the deploy step, or a red build ships anyway.
const testAt = wf.indexOf('test/grading.test.mjs');
const deployAt = wf.indexOf('wrangler-action');
ok(testAt > -1 && wf.includes('test/build.test.mjs'), 'the workflow runs both suites');
ok(testAt < deployAt, 'the suites run BEFORE the deploy, so a failure blocks it');
ok(!/CLOUDFLARE_API_TOKEN\s*[:=]\s*['"a-z0-9]/i.test(wf.replace(/\$\{\{[^}]*\}\}/g, '')),
   'the API token is referenced as a secret, never inlined');

const version = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8'));
ok(Number.isInteger(version.version), 'version.json holds an integer version');
ok(typeof version.note === 'string' && version.note.length > 0, 'version.json has a note for the update prompt');

// The update prompt only works if the client reads the same file the Worker
// serves, and the service worker must not be in .assetsignore.
ok(/fetch\('version\.json/.test(SCRIPT), 'the client polls version.json');
const ignore = readFileSync(join(ROOT, '.assetsignore'), 'utf8').split('\n').map(s => s.trim());
for (const f of ['index.html', 'sw.js', 'manifest.json', 'version.json']) {
  ok(!ignore.includes(f), `${f} is NOT excluded from the deployed assets`);
}
ok(readFileSync(join(ROOT, 'sw.js'), 'utf8').includes("addEventListener('fetch'"),
   'the service worker has a fetch handler (Android needs one to install the PWA)');

done('build');
