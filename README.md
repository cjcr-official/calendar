# Grading Calendar

A calendar and workload tracker for someone who grades for **several teachers at
once**. Every stack of grading is a *batch*: who it's for, what class, how many
items, when it's due, and how far through it you are.

It's an installable phone app (PWA) — add it to the Home Screen and it opens
full-screen like any other app.

- **Home** — what's overdue, what's due this week, how many items are left and
  roughly how long that will take, plus the next two weeks day by day.
- **Calendar** — a month grid, colour-coded per teacher. Tap a day to see or add
  what's due on it.
- **Grading** — the full list, filtered by To do / Overdue / Started / Done, with
  a per-teacher filter and search.
- **Teachers** — everyone you grade for, each with their own colour and a live
  count of what's still outstanding.

---

## Setting it up

Three things, in this order: a database, the hosting, and the app on the phone.

### 1. Database (Supabase, free)

1. Create a project at [supabase.com](https://supabase.com) — any name, pick the
   region nearest you. Note the database password somewhere safe.
2. In the project, open **SQL Editor**, paste the whole of
   [`schema.sql`](schema.sql), and press **Run**. It creates three tables
   (`profiles`, `teachers`, `assignments`) and turns on row-level security so an
   account can only ever read its own rows.
3. Open **Project Settings → API** and keep this page open — you need the
   **Project URL** and the **anon / public** key in step 3 below.

Optional but recommended: under **Authentication → Providers → Email**, turn
**Confirm email** off if you'd rather not deal with a confirmation link on a
personal account. Leave it on if you prefer.

### 2. Hosting (Cloudflare Workers, free)

The app is static files, so the Worker just serves them. There is no server-side
code and no secrets to configure.

1. Push this repo to GitHub (it already is, if you're reading this there).
2. In the Cloudflare dashboard go to **Workers & Pages → Create → Workers →
   Import a repository**, and pick this repo.
3. Cloudflare reads [`wrangler.toml`](wrangler.toml) — the Worker is named
   `grading-calendar` and serves the repo root as static assets. Leave the build
   command empty; there is no build step.
4. Deploy. Every later push to `main` redeploys automatically.

You'll get a `grading-calendar.<your-subdomain>.workers.dev` URL. A custom domain
can be attached later under the Worker's **Domains & Routes**.

### 3. Store the connection in Cloudflare

Do this once and **every device is connected** — no setup screen, on any phone.

In the Cloudflare dashboard: **Workers & Pages → `grading-calendar` → Settings →
Variables and Secrets → Add**. Add two, both as **Secret**:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` (Project URL from step 1) |
| `SUPABASE_ANON_KEY` | the `anon` / `public` key from step 1 |

Deploy (or just push anything) and open the app. The Worker answers
`/config.json` with those two values, the app reads it at launch, and goes
straight to the sign-in screen.

**Add them as Secrets, not plaintext variables.** A plaintext variable added in
the dashboard is overwritten by the next deploy unless it is also declared in
`wrangler.toml` — and it deliberately isn't, so that a push can never blank out
your configuration. Secrets survive every deploy.

Neither value is really secret. The anon key is *designed* to be public: it can
only reach rows that row-level security already allows. Keeping it in Cloudflare
rather than in `index.html` just means you can point the app at a different
project without touching the code.

**Fallbacks, in priority order** — the app tries each in turn, so it is never
stuck:

1. `BUILTIN_SUPABASE_URL` / `BUILTIN_SUPABASE_KEY` at the top of the script in
   `index.html`, if you'd rather compile them in.
2. `/config.json` from the Worker — the setup above.
3. Whatever that device was set up with by hand.
4. Nothing configured anywhere → the app shows its own setup screen, which walks
   through creating the project, links to that project's SQL Editor and API keys
   page, and validates the URL and key before storing them on that device.

### 4. Install it on the phone

- **iPhone:** open the URL in Safari → Share → **Add to Home Screen**.
- **Android:** open in Chrome → menu → **Install app** / **Add to Home screen**.

---

## Updating the app

`version.json` is how installed copies notice a new build. The app polls it on
launch, every two minutes, and whenever it comes back to the foreground; when the
number differs from what's installed it shows the update prompt, clears its
caches and reloads.

**So: every shippable change bumps `version.json` and ships it together with
`index.html`.** Forget the bump and phones keep running the old build.

## Development

Everything is in `index.html` — HTML, CSS and JavaScript in one file, no build
step, no framework, no dependencies to install. Open it in a browser and it runs.

```bash
node test/grading.test.mjs   # dates, status, workload maths, ordering
node test/build.test.mjs     # element ids, page wiring, schema/SQL parity, PWA files
```

The tests read the shipped `index.html` and pull the real functions out of it, so
they can't drift from what actually runs. `build.test.mjs` catches the class of
mistake that fails silently at runtime — a mistyped element id, an `onclick`
naming a function that doesn't exist, a page with no renderer, `schema.sql`
disagreeing with the SQL the setup screen shows.

See [`CLAUDE.md`](CLAUDE.md) for the conventions and the reasoning behind the
parts that look odd.
