# SOKREN Global Operations

Open-source global situational awareness. Live conflict monitoring, priority-tiered
events, structured analytic assessments (ACH / linchpin / SWOT), and source-linked
coverage aggregated from GDELT and primary wire feeds.

**Live site:** enable GitHub Pages (Settings → Pages → Deploy from branch → main)
and this deploys automatically from `index.html`.

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
| Colors and theme | the `:root` CSS variables at the top |

After editing, commit — GitHub Pages redeploys in about a minute.

Predict · Prepare · Protect
