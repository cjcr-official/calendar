// Grading Calendar — the whole server side.
//
// It does exactly one thing beyond serving the static files: it answers
// /config.json with the Supabase project this deployment should talk to, read
// from the Worker's environment. That is what lets the connection be stored
// ONCE in Cloudflare instead of being pasted into every phone: the app fetches
// it at boot and skips its setup screen entirely.
//
// Neither value is a secret. The anon key is designed to be public — row-level
// security is what protects the rows — so handing it to the browser is exactly
// what it is for. Keeping it here rather than in index.html just means it can be
// changed (or pointed at a different project) without touching the app.
//
// Set them in the Cloudflare dashboard under
//   Workers & Pages -> grading-calendar -> Settings -> Variables and Secrets
// as SUPABASE_URL and SUPABASE_ANON_KEY. Add them as **Secrets**: a plaintext
// variable added in the dashboard is wiped by the next `wrangler deploy` unless
// it is also declared in wrangler.toml, while secrets survive every deploy.
// Nothing is declared in wrangler.toml on purpose, so a push can never blank
// out what you set.
//
// If they are unset the endpoint reports that plainly and the app falls back to
// its own setup screen, so a fresh deploy is never a broken deploy.

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);

    if (pathname === '/config.json') {
      const url = (env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
      const key = (env.SUPABASE_ANON_KEY || '').trim();
      return new Response(JSON.stringify(url && key ? {url, key} : {configured: false}), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          // Never cached: changing the project in Cloudflare has to take effect
          // on the next launch, not whenever a cache happens to expire.
          'cache-control': 'no-store'
        }
      });
    }

    // Everything else is a static file (index.html, sw.js, manifest.json,
    // version.json, the icons). Unknown paths fall back to the app itself.
    const res = await env.ASSETS.fetch(request);
    if (res.status === 404 && request.method === 'GET') {
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
    }
    return res;
  }
};
