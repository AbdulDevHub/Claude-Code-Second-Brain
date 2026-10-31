# UI Tokens

Design values for the v2 warm look. CSS tokens live on `:root` in `css/style.css`; canvas colors live in `COLORS` (`js/app.js`) and in `layouts.js`/`renderer.js`.
Use these instead of new ad-hoc colors. Update this file when a token changes in code.

## Color
| Token | Value | Use |
|---|---|---|
| `--bg` | `#000` | page and canvas background |
| `--orange` | `#ff6a2b` | primary accent, view name, memory nodes |
| `--orange-soft` | `#ff8a3d` | projects, bead-ring dust (`RING` in layouts.js) |
| `--red` | `#ff3b30` | notes |
| `--amber` | `#ffb347` | skills, parked status text |
| `--blue` | `#3aa0ff` | MCP servers, app-ring dust |
| `--text` / `--muted` / `--dim` | `#f4ece6` / `#9a8b80` / `#5c4f46` | text levels |
| `--line` | `rgba(255,255,255,.1)` | borders on pills, cards, panels |
| node-only | mod `#4fd8ff`, agent `#9d8cff`, reference `#ffd166`, section `#ffe8d6`, core `#ffffff` | category colors in `COLORS` |
| status | active `#5dff9b`, parked = amber | data sheet, decks |

Hub nodes take the color of the category they head (`HUB_COLOR` in app.js).

## Type
- UI: Outfit (300 for the light half of titles, 500–600 for pills, 800 for the bold half of the brand). Tracked caps for labels: 0.24–0.3em.
- Data and metadata: JetBrains Mono at 9.5–11.5px, with 0.12–0.22em tracking.

## Shape and spacing
- `--radius` 8px for pills and inputs, 10px for cards, 12–14px for the panel and modal. Pills are 34px tall (tab buttons 30px inside a 3px-padded group).
- Gutters: 22px on desktop, 12px on phones.

## Canvas
- Dust levels: alpha `[0.42, 0.72, 0.95, 1]`, size `[1.3, 1.8, 2.4, 3.1]` px, scaled by perspective.
- Badges: hex (apps) or circle (skills, groups), dark fill, glowing category rim, white 24×24 icon. Parked badges get a dashed, unglowing rim.
- Labels: Outfit, uppercase with 3px tracking for hubs; skills are labelled only on focus.
