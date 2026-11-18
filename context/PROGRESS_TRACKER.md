# Progress Tracker

Where the project stands, so a new session can pick up without rediscovering it.
Update "Current state", "In progress" and "Next steps" after meaningful changes, and add a dated entry to the session log (newest first).
When old log entries stop being useful, fold them into the "Earlier history" paragraph instead of deleting them.

## Current state
- Build pipeline: scans `~/.claude` (CLAUDE.md, memory, notes, skills incl. parked/claude.ai, mods, plugins, agents incl. subfolders, MCP, hooks, reference, models) into `data.js`, with redaction and a leak check that fails the build.
- v2 look (warm orange on black, after the `V2 Upgrade/` reference): tabs for 3D orbs (Orb, Neural), 2D map (Force, Circle, Hex, Rings), Timeline, Skills deck and Applications deck.
- Decorative dust (6,500 points on desktop, 4,000 on phones) morphs between layouts. Tools are drawn as hex badges or bead badges with line icons.
- Old HUD panels (telemetry, channels, activity, event log, runtime) live in the Menu drawer. The last view is saved in localStorage.
- Health deck (tab) and a HEALTH telemetry row: build-time checks for unindexed memories, broken links, missing descriptions, stale (120+ days), plus info-only orphans and parked tools. Copy buttons in the data sheet.
- 37 tests pass (`npm test`). README screenshots were refreshed for v2.

## In progress
- Nothing active.

## Next steps
- Measure FPS on a real GPU browser. The headless test browser ran at 30–40 fps with 6,500 dust points; lower `DUST_COUNT` in `app.js` if needed.
- Decide whether the Skills and Applications decks should respect the Menu channel filters (right now they ignore them).
- Possible Routines tab if scheduled-task data is ever scanned (the reference has one; skipped for lack of data).
- Panning a 2D view while a node is selected snaps back to the node on release; consider clearing the follow on pan.
- Publish: create the public GitHub repo, enable Pages (main, root), set the About description, topics and social preview image.

## Session log
### 2026-11-17 — Rings lattice and model catalog
- Rings: items no longer sit on a separate Vogel spiral. Wedges are sized by item count; each wedge gets one lattice of 24 concentric rows (0.4–0.92 R), items take evenly spread slots and the dust fills the rest, so real nodes read as the grid's own dots.
- Models: `MODEL_CATALOG` in `text.mjs` (Claude families + Gemini Flash/Pro, Gemma, ChatGPT Luna, GPT, Grok, Llama, DeepSeek, Qwen, Mistral, Kimi, GLM, Nemotron, Laguna). Every entry is a node; active when named (settings, agent/skill `model:`, mentions) or listed in `helpers/config.json` aliases (FreeLLMAPI, `from` set; the key is never read out, tested with a demo fake key). `stats.models` is now `{active,total}`. Drawer says INACTIVE for unused models; the dormant filter is "Parked & unused". ChatGPT Luna is active via a line added to `~/.claude/notes/local-tools-inventory.md`. On your data: 11/18 active.
### 2026-11-17 — Models category and tidy Rings map
- Models: `scanModels` in `sources.mjs` adds `hub:model` and one `model:<family>` node per family (fable, opus, sonnet, haiku) that something names: `settings.model` (sub `default`, linked to the core), an agent's or skill's `model:` (`link`), or a capitalised mention / `claude-<family>` in sections, memories, notes, reference or project indexes (`mention`). `modelFamily` lives in `text.mjs`. Skills now keep `model` from frontmatter. New health kind `unknown-model` (warn). Pink `#ff7ac8`, chip glyph, MODELS telemetry row, Models channel. Demo: `model: opus` in settings and a Haiku line in WORKFLOW.md. On your data: Opus (default, 2 agents), Sonnet (5 agents), Fable and Haiku (mentions).
- Rings (2D) redone like the orb: every item as a uniform dot on a Vogel spiral in the 0.4–0.92 R annulus, dealt into colored wedges; hubs as hex badges on a 1.12 R ring; labels on hover. The orb and rings share `dealWedges`, `hubAngles` and `markDotsAndRing` in `layouts.js`. Force, Circle, Hex and Timeline are unchanged.
### 2026-11-17 — health checks and copy buttons
- Decided against renaming to "Agentic OS": the app only views `~/.claude` and can't run anything. The name stays, and it stays static and read-only.
- Added `scripts/lib/health.mjs`. `graph.mjs` now records `unresolved` and `refs`, and skips `[[links]]` inside code. Added a Health deck, a HEALTH telemetry row and copy pills, plus the demo fixture `offline-mode.md` (untidy on purpose) and `test/health.test.mjs`.
- Routines tab is still skipped: there's no local scheduled-task data.
- Agents are now scanned recursively, like Claude Code loads them: any `.md` under `agents/` that starts with `---` frontmatter, with `sub` set to its folder. This picked up the 3 `studio/` agents. Demo fixture: `agents/design/designer.md`, plus a kit README that must not load.
- Audit of `~/.claude` vs the scan: hooks are missing (see Next steps). `dev-mods/` holds per-session dev copies, so it isn't scanned. `jobs/`, `plans/` and `sessions/` are runtime data, not knowledge.
- Added `docs/screenshots/health.png` to the README.
- Hooks: a new `hook` node type (teal `#2ee6b8`, round beads on the inner ring with skills, a fish-hook glyph, a Hooks channel, a HOOKS telemetry row, a group in the Applications deck). `scanHooks` makes one node per script, merged across events. Inline commands become "<Event> inline". Generic entry points (`helper.mjs`) take their folder's name. Commands are never emitted, and the demo's fake tokens in hook commands are tested. New health kind `missing-script`. Demo has 4 hooks, 1 with a missing script.
- Hooks now also come from each mod's `hooks/hooks.json` (`${CLAUDE_PLUGIN_ROOT}` is resolved, and the mod links to its hooks) and from each project's `.claude/settings*.json`. Project folders are found from the `cwd` near the top of the newest session log, reading the first 64 KB only. Paths outside `~/.claude` are never emitted. With more than one owner, hooks sit under groups (Your hooks, Mod hooks, Project hooks). Nodes carry `from`, shown as a FROM row. Hooks of a parked mod aren't listed as parked again in Health. Local mods' `{ modules: [...] }` hooks.json is skipped: that's mod runtime, not command hooks. On your data, the Vercel mod's 5 hooks show (off, since Vercel is parked); no project defines hooks.
- Labels: each label tries below, above, right, then left of its node, and takes the first spot clear of other labels and node discs (`drawLabels` in `renderer.js`). In 3D it keeps last frame's side (`labelSpot`) so labels don't flip while orbiting. Timeline lane heads prefer the left, group captions are hidden on the Timeline unless focused (`state.layout`), undated items fan out in a small grid, and the lane gap is 96.
- Orb tidy-up (`orb` in `layouts.js`): every item of every branch (knowledge, skills, hooks, mods, MCP servers, agents) takes one point of an even Fibonacci lattice over the whole sphere, dealt out by longitude so each branch owns a wedge (its `a0`/`a1` are reset to the wedge, so the shell dust color matches); as nodes are added the lattice gets denser, slowly replacing the decorative dust. The renderer draws them (`state.shell`) as uniform plain dots (`SHELL_R`, no badge) labelled only when hovered or selected. The 8 category hubs are the only ring nodes (`state.ring`): evenly spaced at 1.42 R in wedge order, the ring turned so each sits near its wedge, drawn as hex badges (`hubBadge`, icon from `HUB_RULES` in `glyphs.js`) over orange ring dust.

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
