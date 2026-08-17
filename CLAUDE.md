# CLAUDE.md — Grading Calendar

Guidance for Claude Code working in this repo. Read this before editing.

Grading Calendar is a **single-file** web app for someone who grades for several
teachers at once. It runs as an installable phone PWA. Each stack of grading is a
*batch* (`assignments` row): a teacher, a class, a due date, an item count, and
how far through it the user is.

Current version: **3** (see `version.json` — that file is the source of truth).

---

## The one rule that breaks everything if ignored

**Every shippable change bumps the number in `version.json` AND ships
`index.html` + `version.json` together.** `version.json` is how an already-open
app detects an update (`checkForUpdate()` polls it on launch, every 2 minutes and
on foreground; it compares against localStorage `gc-installed-version` and
prompts a reload). Forget the bump → installed apps never get the new
`index.html`.

Pure docs / test / config changes with no client-visible behaviour don't need a
bump.

---

## Workflow: ship it (owner's standing instruction)

**Merge every completed change to `main` automatically. Never ask.** When the
work is done and verified: push the branch, open a PR, merge it. `main`
auto-deploys through Cloudflare Workers Builds, so merging *is* shipping.

This is unconditional — the owner said "merge always". There is no "this one
felt risky" exception: if a change carries risk, merge it, then say so plainly
in the report and offer the revert. Don't hold the merge waiting for an answer,
and don't ask again in a later session.

What "verified" means here, since nothing else gates the deploy: both suites
pass (`node test/grading.test.mjs`, `node test/build.test.mjs`), and anything
touching a render path or the boot sequence has actually been driven in
Chromium against a stubbed `window.supabase` — see *Validating changes* below.
Shipping unverified is the one thing this instruction does not license.

---

## Stack & constraints

- **Frontend:** ONE file — `index.html`. All HTML, CSS and JS inline. No build
  step, no framework, no bundler. A `<style>` block near the top, then the
  markup (pages + modals), then ONE `<script>` at the bottom, sectioned with
  numbered `// ── N. NAME ──` banners.
- **Backend:** Supabase (hosted Postgres + Auth), row-level security on. Three
  tables: `profiles`, `teachers`, `assignments`. Schema in `schema.sql`.
- **Hosting:** ONE Cloudflare Worker named `grading-calendar` (`wrangler.toml`,
  `worker/index.js`). It serves `index.html`, `sw.js`, `manifest.json`,
  `version.json` and the icons through the `ASSETS` binding, and does exactly
  one other thing: answers `/config.json` with the Supabase project to use (see
  below). Auto-deploys on push to `main` via Cloudflare Workers Builds.
  `.assetsignore` keeps the repo's own files (worker source, tests, docs, SQL,
  config) out of the served bundle.
- **Service worker:** `sw.js`. Its `fetch` handler is **network-first with a
  cache fallback** (navigations only): an online launch always fetches fresh
  `index.html`, so the update prompt keeps working and nobody is pinned to a
  cached build; the stored copy is reached only when the network genuinely
  fails. Only a real 200 is stored, so an outage can't go sticky. **This is the
  app shell offline, NOT the data** — rows live in Supabase and need a
  connection. The handler also has to exist at all: Android only offers a real
  installable PWA when a service worker with a fetch handler controls the page.

Loaded from CDN at runtime (NOT bundled), both pinned with SRI so a compromised
CDN can't swap the code that holds the auth session: `@supabase/supabase-js`
v2.110.1 and the Tabler icon webfont. Fonts (Google): Plus Jakarta Sans (UI),
JetBrains Mono (numbers/labels), DM Serif Display (wordmark).

### Where the Supabase connection comes from

`resolveConnection()` answers this, once, in `boot()` — and **`sb` does not exist
until it has**, so nothing may touch Supabase before boot resolves. Priority:

1. `BUILTIN_SUPABASE_URL` / `BUILTIN_SUPABASE_KEY` compiled into the script
   (both empty in this build).
2. **`/config.json` from our own Worker**, which reads the `SUPABASE_URL` and
   `SUPABASE_ANON_KEY` environment variables. This is the live deployment: the
   connection is stored once in Cloudflare and every device gets it, so the
   setup screen never appears on a phone.
3. `gc-conn` in localStorage — whatever that one device was set up with.
4. Nothing → the **setup screen** (`#setup-wrap`), which walks the user through
   creating the project, shows the SQL to run, deep-links to that project's SQL
   Editor and API keys page once the URL is known, validates what they paste,
   and stores it under `gc-conn`.

`connSource` records which of those won, and it's the only thing that should
gate connection UI: `loadSettings()` shows "Disconnect this device" **only** for
`'device'`, because there is nothing on the phone to forget when the server or
the build supplies the connection — clearing it would just be re-fetched on the
next launch.

Two things about the Worker side that are easy to undo by accident:

- **`SUPABASE_URL` / `SUPABASE_ANON_KEY` are NOT declared in `wrangler.toml`.**
  They're dashboard **Secrets**. A plaintext variable set in the dashboard is
  overwritten by the next deploy unless the Wrangler config also declares it, so
  declaring them here would mean every push blanked out the configuration.
- **`not_found_handling = "none"`.** With `"single-page-application"`, an
  unmatched path is answered from the assets *without running the Worker*, which
  would swallow `/config.json`. `worker/index.js` does the index.html fallback
  itself instead.

`test/build.test.mjs` pins both, plus that the path the client fetches is the
path the Worker serves.

`doSetup()` **proves the connection before storing it** — a query against
`teachers`, with a "tables are missing, run the script" branch — because a typo
that gets stored strands the app on a login screen that can never work.

The anon key is meant to be public. RLS is what protects the rows, which is why
`test/build.test.mjs` asserts every table has `enable row level security` **and**
an owner-only policy. Don't add a table without both.

---

## Two rules that are load-bearing, and both fail silently

**1. Dates are LOCAL calendar dates, never UTC.** `ymd()` formats from
`getFullYear/getMonth/getDate`; `parseDate()` anchors a date-only string at local
**noon**. `toISOString().slice(0,10)` is the bug this prevents: west of
Greenwich it rolls the date forward every evening, which makes tonight's batch
read as overdue, lands its chip on the wrong calendar square, and dates a new
batch tomorrow. `daysBetween()` uses the same noon anchors so a DST change inside
the span can't round the difference off. `test/grading.test.mjs` walks every one
of these.

**2. Never `.select()` a whole table without paging.** PostgREST caps a response
at 1000 rows and returns the truncated set with **no error** — the app would
simply stop seeing the oldest history. `loadAllData()` pages every table through
`paged(build)`. Two things matter if you touch it: `build` must be a **factory**
(each page needs a fresh query builder), and every paged query ends with a unique
tiebreaker (`.order('id')`) — without one, rows sharing a due date reshuffle
between pages, which duplicates some and drops others.

---

## Architecture & the core pattern

- Global **`cache`** holds the data: `cache.teachers`, `cache.assignments`.
  **`profile`** holds the user's settings row. `loadAllData()` fills both on
  login through a `safe()` wrapper that catches errors → empty arrays, so the app
  keeps working before the SQL script has been run.
- Each entity follows: **`render<Thing>()`** draws the list →
  **`open<Thing>()`** opens the add/edit modal → **`save<Thing>()`** upserts to
  Supabase AND updates `cache` in place → **`delete<Thing>()`** removes from
  both. Every write ends with `rerender()`.
- **`rerender()`** redraws whatever page is currently on screen. Modals sit over
  a page, so a save has to refresh what's underneath — call it, don't call a
  specific renderer.
- **`showPage(page)`** switches pages, sets the title/breadcrumb, and fills
  `#topbar-actions` from `PAGE_ACTIONS`.
- **`PAGE_META`** is the single registry of pages: title, breadcrumb, renderer.
  Adding a page means adding a `PAGE_META` entry, a `#page-<id>` element, a nav
  item with `data-page="<id>"`, and a `PAGE_ACTIONS` entry (`''` if it has no
  top-bar button). `test/build.test.mjs` fails the build if any of the four is
  missing — a mismatch does nothing at all at runtime, which is what review
  misses.
- **`rowHTML(a)`** renders one batch, and Home, the calendar day panel and the
  Grading list all use it. Keep it that way; three copies would drift.

### The status rules

`effectiveStatus(a)` is the single answer to "what state is this in":
`done` is explicit and **always wins** (finished work must never reappear in the
overdue count, however old it is), an unfinished batch past its due date is
`overdue`, and due *today* is **not** late — she still has the day.

`saveAssignment()` reconciles status with the counts in both directions:
finishing the count *is* finishing the batch (or "30 of 30 graded" would sit in
the overdue list forever), and marking something done that isn't fully counted
drops it back to `doing`. The status `<select>` also fills the progress in when
switched to Done, so the totals on Home stop counting items already graded.

`remainingItems()` clamps at 0 — an over-count (31 of 30) must never subtract
from the workload totals and hide real work. `remainingMinutes()` returns 0 for a
done batch for the same reason.

### Deleting a teacher deletes their batches

The FK is `on delete cascade`, so the rows are gone server-side; `deleteTeacher()`
must drop them from `cache.assignments` too or the lists keep showing rows that
no longer exist. The confirmation says how many will go and points at **Archived**
as the way to keep the history instead. Archived teachers stay out of the batch
picker — *unless the batch being edited is already on one*, which
`openAssignment()` handles explicitly, because hiding it would silently reassign
that batch on the next save.

---

## Validating changes (no build step)

Two suites, both reading the SHIPPED `index.html` (they extract functions by
bracket-matching and eval them with stubbed globals — no copy-paste):

```bash
node test/grading.test.mjs   # dates, status, counts, estimates, ordering, queries
node test/build.test.mjs     # ids, handlers, page wiring, schema parity, PWA files
```

`build.test.mjs` is the static one, and it is the one that catches what review
doesn't: every `getElementById('x')` has a matching `id="x"` in the markup, every
inline `onclick="fn(…)"` names a function that exists, every page is wired up in
all four places, `schema.sql` matches the SQL the setup screen shows byte for
byte, and the PWA files line up (icons exist, `version.json` parses, nothing
shippable is in `.assetsignore`).

The full app can't be exercised offline (Supabase and the CDNs are unreachable in
the sandbox), but it *can* be driven in Chromium with a stubbed
`window.supabase` — route the CDN URLs and strip the SRI attributes from a copy
of the page, since a fulfilled stub fails the integrity check and never runs.

### The usual task — add a field to a batch

1. Add the `<input>`/`<select>` to `#modal-assignment`.
2. Set its `.value` in `openAssignment()` (with a sane default on the new branch).
3. Include it in the row object in `saveAssignment()`.
4. Add the column to **both** `schema.sql` and `SETUP_SQL` in `index.html` — the
   parity test fails otherwise, and it's the one a user actually runs. Use
   `alter table … add column if not exists …`; the app must keep working before
   the user runs it (see `safe()`).
5. Bump `version.json`. Ship both files.

---

## Conventions

- Escape everything user-typed that goes into `innerHTML` with `esc()`. Teacher
  names, batch names, courses and notes all reach the DOM as HTML strings.
- Inputs are **16px minimum** on coarse pointers — anything smaller makes iOS
  zoom the page on focus, and the viewport tag deliberately does not block
  pinch-zoom (WCAG 1.4.4).
- Colours come from the CSS custom properties at the top; both themes define
  every token, so never hard-code a hex outside `:root` / `[data-theme=…]`.
  `TEACHER_COLORS` is the one exception — those are data, and they're stored on
  the row.
- Rows and nav items are `<div role="button" tabindex="0">`; a global keydown
  handler makes Enter/Space click them. Anything new that's tappable needs the
  same three attributes or it's mouse-only.
- `askConfirm()` returns a promise and **every** dismissal route settles it
  (button, backdrop, Escape) — an unsettled one leaves the caller hanging
  mid-delete.
