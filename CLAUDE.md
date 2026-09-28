# SOKREN Global Operations — project guide for Claude Code

Open OSINT conflict-monitoring site. Owner: Timothy Rios (SOKREN, Tampa). Live at **https://www.sokren.com**
(GitHub Pages from this repo, `main` branch, root; Squarespace DNS → Pages, `www` is canonical).
Free, no accounts, no tracking. Aesthetic: dark, minimal, "operational" — JetBrains Mono for data,
orange accent, red = P1/critical, no decoration for its own sake. Tim has an art background and notices
misaligned pixels; keep the visual language consistent with what exists.

## Layout of the repo

| Path | What |
|---|---|
| `index.html` | **The entire app.** Vanilla HTML/CSS/JS, one file, ~250 KB, no build step, no framework, no bundler. |
| `cables.json` | TeleGeography submarine-cable GeoJSON (730 systems, CC BY-NC-SA). Loaded same-origin. Refresh occasionally from `https://www.submarinecablemap.com/api/v3/cable/cable-geo.json`. |
| `README.md` | Public-facing README (also shows on the repo page). Keep in sync when features change. |
| `sokren-relay/` | Cloudflare Worker + Durable Object: shared AIS feed, ADS-B + news pass-through. Own README with deploy steps. |
| `tests/` | Playwright headless-Chromium tests. `npm test` runs all. |
| `CLAUDE.md` | This file. Update it when architecture or rules change. |

There is no `sokren-global-ops.html` any more — `index.html` is the single source of truth.

## Golden rules

1. **One file, plain JS.** Do not introduce React/Vue/bundlers/TypeScript/npm runtime deps. Everything the
   page needs is inline. External requests at runtime are only: Google Fonts, `./cables.json`, the world
   TopoJSON (`WORLD_URL`), GDELT, ADS-B providers, OpenSky, AISStream (or the relay), and the public CORS
   relays in `proxied()` as last resort.
2. **Never commit secrets.** The AISStream key lives only in the relay (`wrangler secret`) or in a viewer's
   localStorage. No keys, tokens or emails in this repo. The repo is public.
3. **Test before you push.** `npm test` must be green (see Testing). For visual changes also look at the
   screenshots in `tests/out/`. Syntax-check alone (`npm run syntax`) is not enough.
4. **Deploy = push to `main`.** GitHub Pages republishes in 1–3 min. Tim checks with a hard refresh
   (Cmd+Shift+R) or a private window; the site is cached aggressively.
5. **Small commits, descriptive messages.** One feature or fix per commit. Tim reads the history.
6. **Don't break mobile.** Every change is checked at 390 px wide: no horizontal scroll, header fits,
   drawer becomes full-width with backdrop.
7. **Stay honest in the UI.** Live-signal counts carry the "proximity is a cue, not corroboration" caveat;
   dark-ship flags say "transmission stopped, cause unknown". Keep that register — no false precision.

## How the app is structured (index.html)

Order inside the file: `<style>` → markup → one `<script>`.

**Views** (`switchView(name)`, hash routing `#home #feed #situations #about`):
- `#view-home` — monitor bar (`#monitor-bar`: Filter ▾ `#pop-filter` with `#map-chips`; Layers ▾ `#pop-layers`
  with `#layer-chips`, `#ship-filter`, `#air-diag`) → map (`#map-wrap`, SVG basemap + `#markers` + overlay
  `#ov`/`#ov-pts`, `#ship-card`, `#zoom-ctl`, `#legend`, `#tooltip`) → three intel columns (`#intel-grid`:
  Active Conflicts / Emerging Flashpoints / Analytic Outlook).
- `#view-feed` — wire ticker, net-note, `#adhoc` live-search results, feed list, sources.
- `#view-situations` — cards grouped active/threat/emerging, `#sit-search`.
- `#view-about` — methodology, STI key (`#sti-key`), sources, licensing.
- Overlays live after `</footer>` as body children: `#drawer-bg`, `#detail` (slide-in situation drawer),
  `#cmdk` (⌘K search palette), `#akey` (AIS key modal, only shown without relay).

**Data model:** `EVENTS` (situations: id, name, lon/lat, priority 1–4, category, status active|threat|emerging,
query for GDELT, STI etc.), `ANALYSIS` (per-event ACH/SWOT/linchpin/outlook text), `CHOKEPOINTS` (12),
`CABLES` (curated corridor fallback), `COUNTRIES` (~130, for search: `[name, lon, lat, [eventIds], aliases]`),
`WIRES`/`WIRE_LINKS` (news sources), `SEED` (fallback headlines). Global `state` object holds everything
mutable (`selected`, `view {k,x,y}`, `layers`, `layerData`, `layerStatus`, `ships`, `ais`, `ck`, `adhoc`…).

**Map layers** (`LAYERS`, `toggleLayer`, `refreshLayer`, `renderOverlay`, `renderLayerChips`):
- `chokepoints` — static diamonds.
- `cables` — `./cables.json` → TeleGeography API → curated fallback. One red `<path id="cable-path">`, width
  scales with zoom in `applyView`. Antimeridian split in `splitAntimeridian`.
- `aircraft` ("Air Tracker") — `loadFlights()` military worldwide via relay `/air/mil` (OpenSky snapshot,
  `source:"opensky"`, `MIL_HEX` ranges) → dead direct fallbacks; `loadArea()` all traffic 250 nm around the selected
  situation. Diag string in `state.airDiag`, shown in `#air-diag`.
- `ships` — AIS. `connectAis()` opens **either** the relay (`RELAY_BASE` set → `wss://…/ais`, no key, sends
  `{boxes:[…]}` for the selected situation) **or** AISStream directly with a per-browser key. Messages →
  `handleAisText` → `handleAisMessage` (also accepts JSON arrays = relay snapshot chunks, and `RelayStatus`).
  `refreshShips()` every 5 s prunes, runs `detectDark()`, re-renders. Areas = 12 chokepoint boxes + `AIS_LANES`
  (22 shipping-lane boxes, mirrored in the relay's `BASE_BOXES` — keep in sync) + selected situation. That's 10k+ vessels;
  `pickShips()` → `state.shipsDrawn`: zoomed in = on-screen only; cap `SHIP_DRAW_CAP` (1500 desktop, 600 phone) by dark, military/law, near selection, newest. Trails only at zoom ≥ 2. Thousands of DOM markers made Safari reload the tab for memory. Vessel classes: `shipBaseClass(v)`
  by AIS type code (35 military; 51/55 law; 80–89 tanker; 70–79 cargo; 60–69 passenger; 30–37/52–57 or
  Class B → small). `shipVisible(v)` applies `state.shipFilter` (`SHIP_FILTERS`). Dark-ship rule in
  `detectDark()`: silent ≥12 min, feed healthy, heard on this connection, was ≥3 kt, inside boxes with
  0.4° margin. Vessel card: `selectShip(mmsi)` → `renderShipCard()`; flag from `mmsiFlag()` (MID table).

**Search:** header field opens ⌘K palette (`ckOpen/ckResults/renderCk/ckRun`): countries, situations,
chokepoints, cable names, headlines, then "Live search" → `runAdhoc(q)` (GDELT). Items act on `mousedown`
(click was lost to re-render). `focusMap(lon,lat,k)` zooms.

**Situation drawer:** `setSelected(id)` → `renderDetail()`; `renderSignals(ev)` builds the Live Signals rows
(aircraft ≤600 km, all aircraft ≤250 nm, vessels ≤450 km, AIS gaps, chokepoints/cables in scope).

**Networking helpers:** `fetchJSONDirect(urls, ms)` (first that works, 429 → limited), `fetchJSONAny`
(direct then `proxied()` relays), `fetchTextTimed`, `relayUrl(path)`.

## The relay (sokren-relay/)

Cloudflare Worker (free plan) with one Durable Object `AisHub`. Why it exists: AISStream forbids direct
browser connections and allows 3 connections per account; the hub keeps one upstream connection and fans
it out, sends newcomers a 90-min snapshot, adds viewers' selected areas to the subscription, throttles
per-vessel forwarding to 6 s, and goes idle 3 min after the last viewer leaves. Also `/air/*` and `/news`
cached pass-throughs (CORS locked to `ALLOWED_ORIGINS`).

- Deploy: `cd sokren-relay && npm install && npx wrangler login && npx wrangler secret put AISSTREAM_KEY && npx wrangler deploy`
- Deployed at `https://sokren-relay.sokren-relay.workers.dev`; `RELAY_BASE` in `index.html` points there.
- Health: `<relay>/ais/status`. Local dev: `npx wrangler dev --port 8787 --var AIS_UPSTREAM:ws://127.0.0.1:9999 --var AISSTREAM_KEY:SECRET123 --var "ALLOWED_ORIGINS:http://localhost:8080"` with `node test/fake_ais.mjs` running, then `node test/client_test.mjs`; the browser e2e is `tests/relay-e2e.manual.mjs`.
- Outbound WebSockets from Workers use `fetch("https://…", {headers:{Upgrade:"websocket"}})` — never `wss://` in fetch.
- AISStream subscription message-type names must be exact (`StaticDataReport`, not A/B variants); a malformed subscription closes the socket with no error text.
- **Aircraft (AirHub DO + Deno helper).** Every free ADS-B source refuses Cloudflare (airplanes.live 403 needs approval,
  adsb.fi 403, adsb.lol 429) and OpenSky doesn't even answer it, so `air-helper/main.ts` runs on Deno Deploy
  (playground "serene-lemming-5927", Tim's Deno org; code is pasted into the Deno editor — keep the repo copy in sync)
  and logs in to OpenSky (env `OPENSKY_CLIENT_ID/SECRET`, `HELPER_KEY`). Relay var `AIR_HELPER_URL`, secret
  `AIR_HELPER_KEY` (= Deno `HELPER_KEY`). AirHub pulls one worldwide `/states/all` (4 credits) at most every 120 s,
  only while someone asks; `/air/mil` and `/air/point` are cut from it in readsb `{ac:[]}` shape with `source`/`age`.
  4000 credits/day. Health + login probe: `<relay>/air/status?probe=1`. Helper returns errors as 200 `{error}`
  (a 5xx body gets replaced by the edge). Test creds locally: `sokren-relay/test/opensky_login_check.sh FILE.json`.

## Testing

```
npm install            # once: playwright + ws
npx playwright install chromium   # once
npm test               # syntax + all tests/*.test.mjs, screenshots in tests/out/
node tests/dark.test.mjs          # one test, full JSON output
```
Tests blank `RELAY_BASE` (direct-key mode) except `relay.test.mjs`, which checks the page as deployed. Tests serve `index.html` via Playwright route interception at `http://localhost/` and mock every network
call (GDELT, ADS-B, OpenSky, cables) — they run offline and finish in ~50 s. AIS is tested with a fake
`window.WebSocket` class and hand-built AISStream JSON fixtures. Each test prints a JSON result block and
`PAGE ERRORS: none`; the runner fails on any page error or non-zero exit. When you add a feature, add or
extend a test and eyeball the screenshot. Python patch scripts with asserted-unique string replacement were
used historically; with a repo checkout, direct edits are fine.

## Data sources and licensing (keep the About page truthful)

GDELT DOC 2.0 (news), OpenSky (aircraft, via relay + Deno helper; adsb.lol/adsb.fi fallback, rate-limited
anonymous), AISStream.io (AIS, free key, proxy-only terms), TeleGeography Submarine Cable Map (CC BY-NC-SA —
attribution required, commercial use needs a license), Natural Earth via world-atlas TopoJSON.
No FlightRadar24 / MarineTraffic scraping — no public API / against ToS; link out instead.

## Known issues / open threads

- Air Tracker showed "unreachable" on Tim's Mac while it worked in tests; root cause never captured.
  The relay's `/air/mil` should fix it. If not, read the `Aircraft —` line in the Layers dropdown.
- A ship directly under a situation marker can't be clicked (marker sits on top). Zooming separates them.
- Public CORS relays (`proxied()`) are unreliable; prefer the SOKREN relay for anything new.
- Cable lines cluster visually around chokepoints at world zoom — accepted for now.
- AIS coverage is receiver-dependent (patchy mid-Gulf, off Yemen): expect innocent "dark" flags.

## Backlog candidates (discussed with Tim, not yet built)

- Remove the per-browser AIS key path once the relay has been stable for a while.
- Alerting: notify when a P1 situation's Live Signals change sharply (many mil aircraft, new dark ships).
- Persist vessel tracks server-side (relay) for longer trails / replay.
- Per-situation "watchlist" of MMSIs / hex codes.
- Feature ideas borrowed from World Monitor / God's Eye View / Osiris / OpenGridWorks: internet outages
  (IODA/Cloudflare Radar), NOTAM/airspace closures, GPS-jamming heatmap (gpsjam), protest/ACLED-style
  event layer, satellite fire hotspots were removed on purpose — don't re-add without asking.
- Monetization ideas were discussed (consulting funnel, premium briefs); the site itself stays free/open.

## Working with Tim

- He is not a professional developer but is technical (USAF intel/cyber background, Zero Trust governance
  lead). Explain *what* changed and *why* in plain terms; skip lecture-y detail unless asked.
- Bottom line first. When something breaks, give the one most likely cause and the check that confirms it.
- He uploads/commits from a Mac; commands should be copy-pasteable for macOS Terminal.
- He wants to move fast on "a lot of areas to upgrade": prefer shipping small verified increments over
  big rewrites, and always leave the site in a working state on `main`.
