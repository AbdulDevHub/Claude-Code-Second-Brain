import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// engine.js is a classic browser script; run it in a sandbox with a stub `window`.
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL('../js/engine.js', import.meta.url), 'utf8'), sandbox);
const { Physics, OrbitCamera } = sandbox.window.NeuralEngine;

test('camera: unprojectDelta inverts a screen-space move at any orientation', () => {
  const cam = new OrbitCamera();
  for (const [yaw, pitch] of [[0, 0], [0.7, -0.4], [2.5, 1.1], [-1.2, 0.3]]) {
    Object.assign(cam, { yaw, pitch, dist: 900, tx: 10, ty: -20, tz: 5, cx: 400, cy: 300 });
    cam._trig(); // refresh the cached sin/cos without easing toward the goal
    const p = { x: 35, y: -60, z: 120 };
    const a = cam.project(p.x, p.y, p.z, {});
    const d = cam.unprojectDelta(12, -7, a.depth);
    const b = cam.project(p.x + d.x, p.y + d.y, p.z + d.z, {});
    assert.ok(Math.abs(b.x - a.x - 12) < 1e-6 && Math.abs(b.y - a.y + 7) < 1e-6, `yaw ${yaw} pitch ${pitch}`);
    assert.ok(Math.abs(b.depth - a.depth) < 1e-6, 'moves stay in the camera plane');
  }
});

test('camera: goals ease in and pitch is clamped', () => {
  const cam = new OrbitCamera();
  cam.orbit(0, 10);
  assert.ok(cam.goal.pitch <= 1.35);
  cam.zoom(1e6);
  assert.equal(cam.goal.dist, cam.maxDist);
  const before = cam.dist;
  cam.update(0.1);
  assert.ok(Math.abs(cam.dist - cam.goal.dist) < Math.abs(before - cam.goal.dist));
});

test('physics: a small graph settles, linked nodes end up closer than strangers', () => {
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: i, r: 6 }));
  const links = nodes.slice(1, 6).map((n) => ({ source: nodes[0], target: n }));
  const sim = new Physics(nodes, links, { charge: () => 200, linkDistance: () => 60, linkStrength: () => 0.7 });
  let ticks = 0;
  while (sim.tick()) ticks++;
  assert.ok(ticks > 50 && ticks < 2000, `settled after ${ticks} ticks`);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const linked = links.reduce((s, l) => s + dist(l.source, l.target), 0) / links.length;
  const strangers = nodes.slice(6).reduce((s, n) => s + dist(nodes[0], n), 0) / 6;
  assert.ok(linked < strangers, `linked ${linked.toFixed(1)} vs strangers ${strangers.toFixed(1)}`);
  assert.ok(nodes.every((n) => Number.isFinite(n.x + n.y + n.z)));
});
