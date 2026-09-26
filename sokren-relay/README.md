# SOKREN relay (Cloudflare Worker)

A tiny server that sits between www.sokren.com and the live-data providers.

* **/ais** — one shared AISStream connection (your key stays here as a secret) fanned out to every
  visitor over WebSocket. Newcomers get a snapshot of every vessel heard in the last 90 minutes, so
  the map is full within a second. Visitors' selected-situation areas are added to the subscription
  on the fly. Idle 3 minutes with no viewers → the upstream connection is dropped (free-plan friendly).
* **/air/mil**, **/air/point/LAT/LON/NM** — ADS-B aircraft (airplanes.live, adsb.lol fallback), cached 15 s.
* **/news?q=** — GDELT article search, cached 5 min.
* **/ais/status** — health JSON (upstream state, viewers, vessels held, message counts).

Only browsers on the origins listed in `wrangler.toml → ALLOWED_ORIGINS` can use it.

## Deploy (about 10 minutes, free)

1. **Cloudflare account** — https://dash.cloudflare.com/sign-up (free plan is enough).
2. **Node.js** — https://nodejs.org → download the macOS LTS installer, run it. (Check: open Terminal, type `node -v`.)
3. **Open Terminal in this folder**: `cd ~/Downloads/sokren-relay` (or wherever you unzipped it), then `npm install`.
4. **Log in**: `npx wrangler login` → a browser tab opens → Allow.
5. **Store the AIS key**: `npx wrangler secret put AISSTREAM_KEY` → paste your AISStream key → Enter.
   (The key never goes in a file or on GitHub.)
6. **Deploy**: `npx wrangler deploy` → the last line prints your URL, e.g.
   `https://sokren-relay.yourname.workers.dev`. If it asks to register a workers.dev subdomain, accept.
7. **Check it**: open that URL in a browser → "SOKREN relay · ok". Open `…/ais/status` → JSON.
8. **Point the site at it**: in `index.html` find `const RELAY_BASE = "";` (near the top of the script,
   search for RELAY_BASE) and paste the URL between the quotes. Commit. Hard-refresh the site.

Ships now appear for every visitor with no key; the ⚙ key button disappears.

## Updating later

Edit `src/index.js`, then `npx wrangler deploy` again. To rotate the AIS key: `npx wrangler secret put AISSTREAM_KEY`.
To allow another site origin, edit `ALLOWED_ORIGINS` in `wrangler.toml` and redeploy.

## Limits worth knowing

* AISStream allows **3 subscribed connections per account**. The relay uses one. Don't also run
  the old direct-from-browser mode on several machines at once.
* Cloudflare free plan: 100k requests/day and ~13k GB-seconds of Durable Object time/day. The hub only
  runs while someone is watching; a full 24 h of continuous viewers is roughly the daily budget. If the
  site gets busy enough to hit that, the $5/month Workers Paid plan removes the ceiling.
* AISStream's terms require server-side proxying (no direct browser connections) — this relay is
  the compliant setup.
