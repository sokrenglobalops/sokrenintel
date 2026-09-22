# SOKREN Global Operations

## 🔴 Live site: [www.sokren.com](https://www.sokren.com)

Open-source global situational awareness. Live conflict monitoring, priority-tiered
events, structured analytic assessments (ACH / linchpin / SWOT), and source-linked
coverage aggregated from GDELT and primary wire feeds.

*This repository hosts the deployed application. To use the platform, visit
**[www.sokren.com](https://www.sokren.com)** — this page is just the engine room.*

## Navigation

- **Monitor** (home): the heat map, a Filter dropdown (situation categories), a Layers dropdown, and three
  intelligence columns: Active Conflicts, Emerging Flashpoints, Analytic Outlook.
- **Feed**: wire ticker, live coverage with category/priority filters, news sources, and live-search results.
- **Situations**: all tracked situations as cards, grouped (active / threat activity / emerging), with a filter box.
- **About**: what the platform is, how to read it, the STI key, methods, data sources, limits.
- Selecting a situation anywhere opens a **slide-in panel** with the brief, STI, outlook, live signals, the full
  ACH / linchpin / SWOT assessment, and linked coverage. Esc or ✕ closes it.
- **Search** (header box, ⌘K / Ctrl+K): countries (focuses the map and opens the linked situation), situations,
  chokepoints, cables, current headlines, and a **live coverage search** on any topic via GDELT.

## Map layers

Toggle from the **Layers** dropdown on the map bar (choices are remembered per browser):

| Layer | Source | Refresh |
|---|---|---|
| Chokepoints | curated (12 maritime chokepoints, linked to situations) | static |
| Cables | `cables.json` in this repo (TeleGeography Submarine Cable Map geometry, CC BY-NC-SA); falls back to TeleGeography's live API, then to curated corridors | on toggle |
| Air Tracker | military aircraft worldwide (airplanes.live, adsb.lol) plus all traffic within 250 nm of the selected situation; OpenSky Network as fallback (military by ICAO hex allocation, refreshed every 20 min to respect its anonymous limit) | 60 s |
| Ships (AIS) | AISStream.io live AIS via WebSocket (free key, ⚙ on the chip) — waters around every chokepoint plus the selected situation | live |

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
