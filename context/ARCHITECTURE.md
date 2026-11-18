# Architecture

How data flows from `~/.claude` to pixels, and which file owns which job, so changes land in the right layer.
Read before touching the build, layouts or renderer. Update when a layer, data field or layout is added or removed.

## Pipeline
```
~/.claude ─► scripts/build.mjs ─► redact + leak check ─► data.js (window.BRAIN) ─► app.js ─► layouts.js / engine.js ─► renderer.js
```
- **Build (Node):** `sources.mjs` has one scanner per source (hooks come from `settings.json`, mod `hooks/hooks.json` and project `.claude/settings*.json`: one node per script, with commands never emitted). `graph.mjs` registers nodes and links and resolves `[[wikilinks]]`, relative `.md` links and name mentions. `redact.mjs` scrubs, then refuses to write if anything personal survives. `health.mjs` runs read-only checks on the finished graph (it uses `graph.unresolved` and `graph.refs`). Output: `{ nodes, links, stats, health }`, with the summary in `stats.health`.
- **Node fields from the build:** `id, type, label, desc, body, file, mtime, size, sub, project, version, model, active`. Types are `core, section, hub, project, memory, note, skill, mod, mcp, agent, reference, group`. `active === false` means parked.
- **Links:** `kind` is `structure` (source = parent; core → hub → group/project → item), `wikilink` or `mention`.

## Browser layers
- **app.js:** turns BRAIN into fixed-shape node and link objects (adds `x/y/z`, `tx/ty/tz` targets, physics fields and sprite slots). It owns the view state (`VIEWS`, `setView`, `setLayout`), the camera framing (`viewRect`, `fitDist` from the layout `extent`), pointer input, data sheet (with copy pills), decks (Skills, Applications, Health), drawer, search, filters and the boot sequence.
- **layouts.js:** `prepare(nodes, links)` builds branches (one per hub, DFS order), angular sectors, a palette and the base radius `R`. `build(name, ctx, count)` writes targets onto nodes and returns `{ extent, captions, dust }`.
  - Structured layouts: `orb` (every item as a uniform dot on an even lattice over the shell, labelled on hover via `state.shell`; category hubs as hex badges on one ring via `state.ring`), `circle`, `hex`, `rings`, `timeline`. Nodes ease toward their targets each frame.
  - Physics layouts: `neural` (3D), `force` (2D, `physics.flat = true`). `PHYSICS` and `FLAT` sets say which is which.
  - Branch kinds: `inner` (knowledge hubs), `bead` (skills, hooks), `app` (mods, MCP, agents, models). Kinds only weight sectors in Circle/Hex now; Orb and Rings treat every branch alike (hubs on one ring by `hubAngles`, marked by `markDotsAndRing`). Orb deals items into wedges with `dealWedges`; Rings sizes wedges by item count, builds one row lattice per wedge and gives items evenly spread slots of it, the dust taking the rest.
- **engine.js:** `Physics` (d3-force style in 3D; `flat` decays z) and `OrbitCamera` (goal-easing; `project`, `rotate`, `unprojectDelta`).
- **renderer.js:** draw order is stars → dust → captions → links → nodes → labels → reticles. Dust is stored as typed arrays, morphed from the previous cloud (`setDust`, `burst`) and bucketed by color × brightness. Glow, body, spark and badge sprites are cached once per key.
- **glyphs.js:** `PATHS` (24×24 stroke icons) and `glyphFor(node)` (name regex rules, then a type fallback).

## Camera modes
3D layouts orbit (pitch −0.46, auto-orbit when idle). Flat layouts lock yaw to a multiple of 2π and pitch to 0, and dragging pans. Selecting a node makes the camera follow it.
