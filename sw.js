// Grading Calendar service worker.
//
// Two jobs, both small:
//   1. Exist, with a fetch handler — Android/Samsung Internet only treat the app
//      as installable (full-screen WebAPK, real icon) when a service worker with
//      a fetch handler already controls the page. Without it "Add to Home
//      Screen" makes a plain bookmark.
//   2. Keep a last-known-good copy of the app document, so a dropped connection
//      lands on the app instead of the browser's error page.
//
// The network ALWAYS wins when it answers, so this can never serve a stale build.

// Holds only the app document. doUpdate() deletes every cache, so applying an
// update clears this automatically — bump the suffix only if the shape changes.
const SHELL_CACHE = 'gc-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// NETWORK-FIRST, cache only as a fallback. This ordering is the whole point: an
// online launch always fetches a fresh index.html, so version.json's update
// prompt keeps working and nobody gets pinned to a cached build. The stored copy
// is reached only when the network genuinely fails.
//
// NOTE this gets you the app shell offline, not the data — rows live in Supabase
// and still need a connection.
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        // Only ever store a genuine 200 — caching a 5xx would make an outage sticky.
        if (res && res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put('shell', copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.open(SHELL_CACHE)
        .then(c => c.match('shell'))
        .then(hit => hit || Response.error()))
  );
});
