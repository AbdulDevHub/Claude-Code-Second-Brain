import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { checkHealth, STALE_DAYS } from '../scripts/lib/health.mjs';
import { BrainGraph, stripCode } from '../scripts/lib/graph.mjs';

const DEMO_HOME = fileURLToPath(new URL('../demo/ada', import.meta.url));
const kinds = (health, id) => health.filter((h) => h.id === id).map((h) => h.kind).sort();

test('demo build flags the untidy memory and lists parked tools', () => {
  const { health, stats } = JSON.parse(build({ home: DEMO_HOME }).json);
  assert.deepEqual(kinds(health, 'memory:Code-weather-app/offline-mode'), ['missing-link', 'no-description', 'orphan', 'unindexed']);
  assert.equal(kinds(health, 'memory:Code-weather-app/units-preference').length, 0, 'indexed, described and linked');
  assert.equal(health.filter((h) => h.kind === 'parked').length, stats.skills.total - stats.skills.active + stats.mods.total - stats.mods.active + stats.mcp.total - stats.mcp.active);
  assert.equal(stats.health.flagged, 2, 'offline-mode memory + the hook whose script is missing');
  assert.equal(stats.health.clean, stats.health.checked - 2);
});

test('unindexed only applies inside a project that has its own MEMORY.md; real files are not broken links', () => {
  const g = new BrainGraph({ redact: (s) => s });
  // Two projects with the same label: only the first has an index.
  const p1 = g.addNode('project:a', { label: 'Same', type: 'project', body: '- [x](x.md)' });
  const p2 = g.addNode('project:b', { label: 'Same', type: 'project', body: '' });
  const m1 = g.addNode('memory:a/y', { label: 'Y', type: 'memory', project: 'Same', desc: 'd' });
  const m2 = g.addNode('memory:b/z', { label: 'Z', type: 'memory', project: 'Same', desc: 'd' });
  g.link(p1, m1); g.link(p2, m2);
  g.register(m2, { text: 'See [readme](../../package.json.md) and [real](../README.md).', dir: fileURLToPath(new URL('.', import.meta.url)) });
  g.resolveCrossLinks();
  const items = checkHealth(g).items;
  assert.deepEqual(items.filter((h) => h.kind === 'unindexed').map((h) => h.id), ['memory:a/y']);
  assert.deepEqual(items.filter((h) => h.kind === 'missing-link').map((h) => h.detail), ['points to "../../package.json.md", which doesn\'t exist yet']);
});

test('stale uses the build clock', () => {
  const later = Date.now() + (STALE_DAYS + 5) * 86_400_000;
  const { health } = JSON.parse(build({ home: DEMO_HOME, now: later }).json);
  assert.ok(health.some((h) => h.kind === 'stale' && h.id.startsWith('memory:')));
  const { health: fresh } = JSON.parse(build({ home: DEMO_HOME }).json);
  assert.ok(!fresh.some((h) => h.kind === 'stale'));
});

test('public builds keep health and leak nothing', () => {
  const { json } = build({ home: DEMO_HOME, omitBodies: true });
  const { health } = JSON.parse(json);
  assert.ok(health.some((h) => h.kind === 'missing-link'), 'checks run before bodies are dropped');
  for (const secret of ['demo-secret-token-123', 'hunter2', 'Authorization']) assert.ok(!json.includes(secret));
});

test('links inside code are documentation, not broken links', () => {
  assert.equal(stripCode('see `[[example]]` and\n```\n[[also]]\n```\n~~~sh\n[[ -f x ]]\n~~~\n    [[indented]]\n[[real]]').match(/\[\[(\w+)/g).join(), '[[real');
  const g = new BrainGraph({ redact: (s) => s });
  const id = g.addNode('memory:a', { label: 'A', type: 'memory', desc: 'x' });
  g.register(id, { slugs: ['a'], text: 'Template: `[[name]]`. Real: [[ghost]].' });
  g.resolveCrossLinks();
  assert.deepEqual(checkHealth(g).items.filter((h) => h.kind === 'missing-link').map((h) => h.detail), ['points to "ghost", which doesn\'t exist yet']);
});
