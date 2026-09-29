# SOKREN Global Operations

## 🔴 Live site: [www.sokren.com](https://www.sokren.com)

Open-source global situational awareness on a live 3D globe: 45 tracked conflicts, cyber campaigns and emerging
threats, each with a structured analytic assessment (STI threat index, ACH / linchpin / SWOT, outlook), live
aircraft and ship tracking, and source-linked coverage from ~45 respected outlets. Assessments are reviewed
automatically every week against new reporting and revised in place only when the reporting is material, with a
public record of what changed and why.

*This repository hosts the deployed application. To use the platform, visit
**[www.sokren.com](https://www.sokren.com)** — this page is just the engine room.*

## Navigation

- **Monitor** (home): a full-screen operations console on a WebGL globe (MapLibre). Floating panels, each collapsible
  (‹ › or the `[` `]` keys): **Layers** (map layers with live counts, vessel filter, situation filter, key) on the
  left; the **Situation board** (Active / Emerging / Outlook / Changes, ranked by STI) on the right; a status strip
  with a time-zone clock (Zulu, local, any capital, or "follow the selected situation") and live feed health.
  Bottom right: zoom, keep-spinning (⟳), globe/flat toggle (▭), reset. On phones the panels become sheets.
- **Feed**: wire ticker, current coverage with category/priority filters, news sources, and live-search results.
- **Situations**: all tracked situations as cards, grouped (active / threat activity / emerging), with a filter box.
- **About**: what the platform is, how to read it, the STI key, methods, data sources, limits.
- Selecting a situation flies the globe to it, draws its 250 nm area of interest and opens the **situation drawer**:
  brief, review status ("auto-updated" / "reviewed, no material change"), **What changed** with sources, STI,
  outlook, live signals, the full ACH / linchpin / SWOT assessment, and linked coverage. Esc or ✕ closes it.
- **Search** (header box, ⌘K / Ctrl+K): countries (focuses the map and opens the linked situation), situations,
  chokepoints, cables, current headlines, and a **live coverage search** on any topic via GDELT.
- The pre-redesign site remains at `/classic.html` for now.

## Intel pipeline

A GitHub Actions job (`.github/workflows/intel.yml`) keeps the content current without manual work:

- **Daily** — `pipeline/collect.mjs` gathers reporting from ~30 feeds (Crisis Group, CFR, Atlantic Council, War on
  the Rocks, Long War Journal, UN News, the major US and international newsrooms, cyber threat-intelligence teams)
  plus GDELT searches per situation and per outlet (AP, Reuters, CNN, ISW, CSIS, RAND, …). Only an allowlist of
  respected outlets is kept. Output: `data/news.json`.
- **Weekly (Monday)** — `pipeline/assess.mjs` sends each situation with new reporting to Claude with its current
  assessment. Only material developments change it; the ACH, linchpins, SWOT, outlook, STI, priority and status are
  revised in place and every change is logged with its sources (`data/intel.json`, `data/changes.json`). The site
  labels these revisions as machine-drafted.

## Map layers

Toggle from the **Layers** dropdown on the map bar (choices are remembered per browser):

| Layer | Source | Refresh |
|---|---|---|
| Chokepoints | curated (12 maritime chokepoints, linked to situations) | static |
| Cables | `cables.json` in this repo (TeleGeography Submarine Cable Map geometry, CC BY-NC-SA); falls back to TeleGeography's live API, then to curated corridors | on toggle |
| Air Tracker | military aircraft worldwide plus all traffic within 250 nm of the selected situation, from OpenSky Network via the SOKREN relay (one shared worldwide snapshot about every 2 min; military by ICAO hex allocation); community ADS-B feeds as fallback | 60 s (data ~2 min) |
| Ships (AIS) | AISStream.io live AIS — waters around every chokepoint, 22 major shipping lanes, and the selected situation; every vessel drawn on the GPU. Shared with all visitors through the SOKREN relay (`sokren-relay/`, Cloudflare Worker; set `RELAY_BASE` in index.html). Without a relay: per-browser key via ⚙ on the chip | live |

**Vessel filter (Layers ▾ → Vessels):** All / Military / Coast guard-LE / Tankers / Cargo / Small craft / AIS gaps.
Classes come from the AIS ship-type code each vessel broadcasts (35 = military, 51/55 = SAR & law enforcement,
80–89 tanker, 70–79 cargo, 30–37 & 52–57 fishing/tugs/pilot/dredgers). Class B transponders (the cheap units on
craft under 300 GT that are not required to carry AIS) are also subscribed and shown as small craft.

**AIS gaps ("dark ships"):** a vessel is flagged with a pulsing red ring when it was heard on this connection,
was underway (≥3 kt), sits inside the subscribed waters (not near an edge), and has now been silent for 12+ minutes
while the feed itself is still healthy. It is a cue to look, not proof of anything — AIS coverage from shore/satellite
receivers is patchy and ships do drop out for innocent reasons. Flags clear the moment the vessel is heard again.

### Adding the cable file (one time)

Open <https://www.submarinecablemap.com/api/v3/cable/cable-geo.json> in your browser, save it as `cables.json`,
and upload it to this repo next to `index.html`. The Cables layer then loads it from the same origin, with no
cross-domain dependency. Re-download occasionally to pick up new systems.

Selecting a situation shows a **Live signals** block: military aircraft within 600 km, all aircraft within
250 nm, AIS vessels within 450 km, and chokepoints/cables in scope.
These are proximity counts, not corroboration.

**⌘K / Ctrl+K** opens search across situations, chokepoints, cables, and current headlines.

## Editing content

All editable content lives in clearly labeled constants inside `index.html`:

| What you want to change | Where it lives |
|---|---|
| A situation's name, priority, map position, brief, or GDELT query | `const EVENTS` |
| STI score, component bars, assessment rows, outlook probability | same event object in `EVENTS` |
| ACH hypotheses, discriminators, linchpins, SWOT | `const ANALYSIS` |
| Bundled fallback articles per situation | `const SEED` |
| RSS wire outlets | `const WIRES` |
| Wire headline → event routing keywords | `const EVENT_KEYWORDS` |
| Chokepoints and cable corridors | `const CHOKEPOINTS`, `const CABLES` |
| Country search index (name, centroid, linked situations, aliases) | `const COUNTRIES` |
| About page text | the `#view-about` block in the HTML |
| Layer list and refresh cadence | `const LAYERS`, the `setInterval` lines near the end |
| Colors and theme | the `:root` CSS variables at the top |

After editing, commit — GitHub Pages redeploys in about a minute.

Predict · Prepare · Protect
