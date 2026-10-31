# UI Rules

Layout and interaction rules for the HUD around the canvas, so new UI matches the v2 look.
Read before adding or moving any on-screen element. Update when a layout rule or breakpoint changes.

## Layout
- Minimal chrome over a full-screen canvas. Top left: brand plus the view name (orange, tracked caps), then Menu and System pills. Top right: Motion pill with a speed slider, the tab group, reset, search, then sub-tabs for the current view.
- Bottom right: zoom group (−, Fit, +). Nothing else sits permanently on the canvas.
- Secondary info (telemetry, channels, activity, event log, runtime) belongs in the left Menu drawer, not floating panels.
- The data sheet slides in from the right (`--panel-w` 470px). `body.panel-open` shifts the top bar, zoom and decks out of its way.
- Decks (Skills, Applications) overlay the dimmed canvas below the header. The canvas gets `pointer-events: none` while a deck is open.

## Interaction
- Click-first: pills and tabs toggle state, and every action is reachable by pointer. No keyboard-shortcut labels (Escape still closes things).
- Clicking a node, card, search result or log row calls `select()`, which opens the data sheet and makes the camera follow.
- Respect `prefers-reduced-motion`: no auto-orbit, no morph, no CSS animations.

## Responsive (≤ 900px)
- The top bar stacks; tabs scroll sideways; the data sheet becomes a bottom sheet (70vh); the drawer is full width.
- The graph frames into the strip below the header (`viewRect` uses y = 265 on phones). Verify there's no horizontal scroll at 390px wide.

## Performance
- No `backdrop-filter` over the live canvas (the modal may blur only while open). Opaque panel backgrounds instead.
- Batch canvas draws by style and pre-render sprites; never build gradients per node per frame.
