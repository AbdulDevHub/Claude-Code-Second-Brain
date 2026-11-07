# Progress Tracker

Where the project stands, so a new session can pick up without rediscovering it.
Update "Current state", "In progress" and "Next steps" after meaningful changes, and add a dated entry to the session log (newest first).
When old log entries stop being useful, fold them into the "Earlier history" paragraph instead of deleting them.

## Current state
- Build pipeline: scans `~/.claude` (CLAUDE.md, memory, notes, skills incl. parked/claude.ai, mods, plugins, agents, MCP, reference) into `data.js`, with redaction and a leak check that fails the build.
- v2 look (warm orange on black, after the `V2 Upgrade/` reference): tabs for 3D orbs (Orb, Neural), 2D map (Force, Circle, Hex, Rings), Timeline, Skills deck and Applications deck.
- Decorative dust (6,500 points on desktop, 4,000 on phones) morphs between layouts. Tools are drawn as hex badges or bead badges with line icons.
- Old HUD panels (telemetry, channels, activity, event log, runtime) live in the Menu drawer. The last view is saved in localStorage.
- 25 tests pass (`npm test`). README screenshots were refreshed for v2.

## In progress
- Nothing active.

## Next steps
- Measure FPS on a real GPU browser. The headless test browser ran at 30–40 fps with 6,500 dust points; lower `DUST_COUNT` in `app.js` if needed.
- Decide whether the Skills and Applications decks should respect the Menu channel filters (right now they ignore them).
- Possible Routines tab if scheduled-task data is ever scanned (the reference has one; skipped for lack of data).
- Panning a 2D view while a node is selected snaps back to the node on release; consider clearing the follow on pan.
- Publish: create the public GitHub repo, enable Pages (main, root), set the About description, topics and social preview image.

## Session log
### 2026-11-06 — social preview image
- Added a 1200×630 share card `docs/og-image.png` (brand, headline, orb crop from `screenshots/hero.png`); its source is `docs/og-template.html`. `og:image`/`twitter:image` now point to it.
- Still to do by hand: upload it as the GitHub repo's social preview (Settings → General).

### 2026-11-06 — issue #1 fixes
- `CLAUDE_CODE_PLUGIN_DIRS` now splits on `:` on POSIX (only `;` when a drive letter or `;` appears) via `splitPluginDirs()`; before, multi-dir lists on macOS/Linux marked no mods as on.
- Frontmatter: a blank `key:` is `''` unless indented keys follow, so `name:` alone no longer crashes the build.
- Weighed Vite/React: declined for now (see chat); the canvas core would not benefit and `file://` opening would break.

### 2026-10-30 — public release prep
- Added SEO metadata to `index.html` (keywords, canonical, Open Graph, Twitter card, JSON-LD), keyword-rich README title, badges, live-demo link and FAQ, `package.json` repo fields and keywords, a CI test workflow and `.nojekyll`. `V2 Upgrade/` is now git-ignored.

### 2026-10-29 — v2 visual upgrade
- Rebuilt the look from the `V2 Upgrade/` screenshots after a grilling session. Decisions: decorative dust only (no extra scanning), warm palette, all graph views, minimal chrome with a Menu drawer, hand-drawn SVG glyphs, keep own branding.
- Added `js/layouts.js`, `js/glyphs.js` and `test/layouts.test.mjs`. Rewrote `renderer.js`, `app.js`, `index.html` and `style.css`, and gave `engine.js` a `flat` flag.
- Reviewer fixes: Neural after a flat layout stayed flat (now adds z jitter), dust jumped mid-morph (eased progress), core snap, decks no longer pass clicks to the canvas, malformed saved prefs no longer crash startup.
- Added agent context files (`context/`).

## Earlier history
v1 shipped a cyan sci-fi HUD around a 3D force-directed graph, with a boot sequence, data sheets, a System screen, parked-tool scanning via the Toolbox mod's state, and privacy-by-construction redaction.
