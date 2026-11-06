# Second Brain — agent guide

Read by AI coding agents before working here. Terse, project-specific rules only; the plain-language tour lives in README.md.
After any meaningful change to this project, update this file, `context/PROGRESS_TRACKER.md`, and the "Project Overview" section of `README.md` to reflect the current state — do this proactively, without being asked.

Verify: npm test

## Overview
A static site that draws Claude Code's memory (`~/.claude`) as a dotted 3D orb, 2D maps and a timeline. A Node build step scans `~/.claude` into `data.js`; the page renders it with hand-written layouts, physics and a Canvas 2D renderer.

## Stack
Vanilla JS (ES2022), Canvas 2D, Node 18.3+ (no npm dependencies). Browser loads only marked + DOMPurify from cdnjs (pinned, SRI). Fonts: Outfit, JetBrains Mono.

## Commands
- `npm run build` — scan your `~/.claude` into `data.js` · `npm run build:demo` — rebuild `demo/data.js`
- `npm run open` — build, then open `index.html` · `npm test` — node:test suites (25 tests)
- Playwright can't open `file://`; serve the folder over http (e.g. `npm run serve`, port 4173) to screenshot.

## Code map
- `scripts/build.mjs` uses `scripts/lib/`: `sources.mjs` (one scanner per source, incl. parked tools), `graph.mjs` (nodes, links, cross-links), `redact.mjs` (scrub + leak check), `text.mjs`. Writes `data.js` (`window.BRAIN`).
- Browser scripts are classic (no modules) so the page opens from `file://`: `engine.js` (physics + camera, `flat` mode), `layouts.js` (targets + dust per layout), `glyphs.js` (badge icons), `renderer.js`, `app.js` (HUD, views, decks, drawer). `window.__brain` is a devtools handle.
- Details: `context/ARCHITECTURE.md`; look and UI rules: `context/UI_RULES.md`, `context/UI_TOKENS.md`.

## Conventions
- Keep node/link objects to one fixed shape: every field is set in the initializer in `app.js` (adding fields later made physics ~7x slower).
- Every layout must write exactly `count` dust points so the renderer can morph between them; layouts are seeded, never `Math.random`.
- No per-frame gradients (pre-render sprites instead) and no `backdrop-filter` over the canvas.
- Plain JavaScript, no TypeScript. UI: click-first, pill/tab toggles, no keyboard-shortcut labels.
- Escape every node-derived string with `esc()` before it goes into HTML.

## Boundaries
- Never emit MCP headers, env or args. `mcpEndpoint()` returns only a host or package name; tests check the demo's fake secrets never reach the output.
- `data.js` and `redact.local.txt` are the user's private data (git-ignored). Don't commit or publish them.
- `V2 Upgrade/` (git-ignored, may be absent) was third-party design reference. Never ship it or copy its "RUBRIC" branding.
- Public repo: `AbdulDevHub/Claude-Code-Second-Brain`, demo on GitHub Pages (serves `demo/data.js` since `data.js` is absent). Keep the canonical/OG URLs in `index.html` and `package.json` in sync if the repo is renamed. CI runs `npm test` (`.github/workflows/test.yml`).

## More
`README.md` (overview, views, how it works) and `context/` (progress tracker, architecture, UI rules and tokens).
