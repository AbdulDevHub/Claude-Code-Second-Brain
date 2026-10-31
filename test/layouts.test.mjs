import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// layouts.js, glyphs.js and the demo brain are classic browser scripts; run them in a sandbox with a stub `window`.
// Arrays from the sandbox have their own prototypes, so they are spread into this realm before deep comparisons.
const sandbox = { window: {} };
for (const file of ['../demo/data.js', '../js/layouts.js', '../js/glyphs.js', '../js/engine.js']) {
  vm.runInNewContext(readFileSync(new URL(file, import.meta.url), 'utf8'), sandbox);
}
const { NeuralLayouts: Layouts, NeuralGlyphs: Glyphs, NeuralEngine, BRAIN } = sandbox.window;

function graph() {
  const nodes = [...BRAIN.nodes].map((n, i) => ({ ...n, color: ['#ff6a2b', '#3aa0ff', '#ffb347'][i % 3], tx: NaN, ty: NaN, tz: NaN }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = [...BRAIN.links].map((l) => ({ source: byId.get(l.source), target: byId.get(l.target), kind: l.kind })).filter((l) => l.source && l.target);
  return { nodes, links, ctx: Layouts.prepare(nodes, links) };
}

test('layouts: every structured layout gives every node a finite target', () => {
  const { nodes, ctx } = graph();
  for (const name of Layouts.names) {
    if (Layouts.PHYSICS.has(name)) continue;
    for (const n of nodes) n.tx = n.ty = n.tz = NaN;
    const out = Layouts.build(name, ctx, 2000);
    const bad = nodes.filter((n) => ![n.tx, n.ty, n.tz].every(Number.isFinite)).map((n) => n.id);
    assert.deepEqual(bad, [], name);
    assert.ok(out.extent && out.extent.w > 0 && out.extent.h > 0, `${name} has an extent`);
    if (Layouts.FLAT.has(name)) assert.ok(nodes.every((n) => n.tz === 0), `${name} is flat`);
  }
});

test('layouts: dust is always exactly `count` finite points with valid colors', () => {
  const { ctx } = graph();
  for (const name of Layouts.names) {
    const { dust } = Layouts.build(name, ctx, 3000);
    assert.equal(dust.n, 3000, name);
    assert.equal(dust.pos.length, 9000);
    assert.ok(dust.pos.every(Number.isFinite), `${name} positions`);
    assert.ok(dust.col.every((c) => c < ctx.palette.length), `${name} colors`);
    assert.ok(dust.lvl.every((l) => l <= 3), `${name} levels`);
  }
});

test('layouts: seeded, so the same layout looks the same every time', () => {
  const { ctx } = graph();
  const a = Layouts.build('orb', ctx, 500).dust.pos, b = Layouts.build('orb', ctx, 500).dust.pos;
  assert.deepEqual([...a], [...b]);
});

test('layouts: orb puts knowledge on the sphere and tools on the outer rings', () => {
  const { nodes, ctx } = graph();
  Layouts.build('orb', ctx, 500);
  const r = (n) => Math.hypot(n.tx, n.ty, n.tz);
  const core = nodes.find((n) => n.type === 'core');
  assert.equal(r(core), 0);
  for (const n of nodes.filter((x) => x.type === 'memory' || x.type === 'note')) assert.ok(r(n) <= ctx.R * 1.001, n.id);
  for (const n of nodes.filter((x) => ['skill', 'mod', 'mcp', 'agent'].includes(x.type))) assert.ok(r(n) > ctx.R * 1.2, n.id);
});

test('layouts: rings keep tools outside the knowledge sectors', () => {
  const { nodes, ctx } = graph();
  Layouts.build('rings', ctx, 500);
  const r = (n) => Math.hypot(n.tx, n.ty);
  const inner = Math.max(...nodes.filter((n) => ['memory', 'note', 'reference', 'project'].includes(n.type)).map(r));
  const beads = Math.min(...nodes.filter((n) => n.type === 'skill').map(r));
  const apps = Math.min(...nodes.filter((n) => ['mod', 'mcp', 'agent'].includes(n.type)).map(r));
  assert.ok(inner < beads && beads < apps, `${inner} < ${beads} < ${apps}`);
});

test('layouts: timeline orders dated nodes in a lane by modified time', () => {
  const { nodes, ctx } = graph();
  Layouts.build('timeline', ctx, 500);
  const lane = ctx.branches.find((b) => b.items.filter((n) => n.mtime > 0).length > 2);
  const dated = lane.items.filter((n) => n.mtime > 0).sort((a, b) => a.mtime - b.mtime);
  for (let i = 1; i < dated.length; i++) assert.ok(dated[i].tx >= dated[i - 1].tx - 1e-6);
  assert.ok(nodes.every((n) => Number.isFinite(n.tx)));
});

test('physics: flat mode folds depth to zero', () => {
  const { nodes, links } = graph();
  const p = new NeuralEngine.Physics(nodes, links, { charge: () => 100, linkDistance: () => 60, linkStrength: () => 0.5 });
  p.flat = true;
  for (let i = 0; i < 120; i++) p.tick();
  assert.ok(nodes.every((n) => Math.abs(n.z) < 1e-3));
});

test('glyphs: every tool gets a known icon', () => {
  const { nodes } = graph();
  for (const n of nodes) assert.ok(Glyphs.PATHS[Glyphs.glyphFor(n)], n.id);
  assert.equal(Glyphs.glyphFor({ type: 'mcp', label: 'playwright', id: 'mcp:playwright' }), 'globe');
  assert.equal(Glyphs.glyphFor({ type: 'skill', label: 'gitmoji-commit', id: 'skill:gitmoji-commit' }), 'branch');
  assert.equal(Glyphs.glyphFor({ type: 'skill', label: 'mystery', id: 'skill:mystery' }), 'bolt');
});
