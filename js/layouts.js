// Layouts: where every node sits in each view (tx, ty, tz targets), plus the decorative dust cloud and the
// world-space captions that go with it. Pure math with no DOM, so the tests can run it. Exposes window.NeuralLayouts.
//
// The dust is thousands of non-interactive points. Every layout writes exactly `count` of them, so the renderer can
// morph one cloud into the next point by point.
(() => {
  const TAU = Math.PI * 2;
  const GOLDEN = 2.399963229728653;
  const BEAD_HUBS = new Set(['hub:skill']);
  const APP_HUBS = new Set(['hub:mod', 'hub:mcp', 'hub:agent']);
  const WHITE = '#fff1e0', RING = '#ff8a3d', BLUE = '#3aa0ff';

  // Small seeded PRNG (mulberry32) so every layout looks the same on every load.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const gauss = (rand) => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(TAU * rand());
  const wrap = (a) => ((a % TAU) + TAU) % TAU;

  // ---------- structure ----------
  // Branches come from "structure" links (source = parent): one per hub, holding all of its descendants in DFS order.
  function prepare(nodes, links) {
    const parent = new Map(), kids = new Map(nodes.map((n) => [n.id, []]));
    for (const l of links) {
      if (l.kind !== 'structure' || parent.has(l.target.id)) continue;
      parent.set(l.target.id, l.source);
      kids.get(l.source.id).push(l.target);
    }
    for (const list of kids.values()) list.sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label));

    const core = nodes.find((n) => n.type === 'core') || null;
    const sections = nodes.filter((n) => n.type === 'section');
    const hubs = nodes.filter((n) => n.type === 'hub');
    const seen = new Set([...(core ? [core.id] : []), ...sections.map((n) => n.id), ...hubs.map((n) => n.id)]);
    const depth = new Map();
    const walk = (n, d, out) => {
      for (const c of kids.get(n.id)) {
        if (seen.has(c.id)) continue;
        seen.add(c.id); depth.set(c.id, d); out.push(c);
        walk(c, d + 1, out);
      }
    };
    const branches = hubs.map((hub) => {
      const items = [];
      walk(hub, 1, items);
      const kind = BEAD_HUBS.has(hub.id) ? 'bead' : APP_HUBS.has(hub.id) ? 'app' : 'inner';
      return { hub, items, kind, color: hub.color, a0: 0, a1: 0, w: 0 };
    });
    const orphans = nodes.filter((n) => !seen.has(n.id));
    if (orphans.length) {
      for (const n of orphans) depth.set(n.id, 1);
      branches.push({ hub: null, items: orphans, kind: 'inner', color: WHITE, a0: 0, a1: 0, w: 0 });
    }

    // Angular sectors, weighted by the square root of size so one big branch doesn't swallow the circle.
    const sectorize = (list) => {
      const total = list.reduce((s, b) => s + (b.w = (2 + Math.sqrt(b.items.length + 1) * 2) * (b.kind === "app" ? 0.4 : 1)), 0);
      let a = -Math.PI / 2;
      for (const b of list) { b.a0 = a; a += (b.w / total) * TAU; b.a1 = a; }
    };
    sectorize(branches);

    const palette = [WHITE, RING, BLUE];
    const colorIndex = (hex) => {
      let i = palette.indexOf(hex);
      if (i < 0) { palette.push(hex); i = palette.length - 1; }
      return i;
    };
    for (const b of branches) colorIndex(b.color);
    const branchOf = new Map();
    for (const b of branches) { if (b.hub) branchOf.set(b.hub.id, b); for (const n of b.items) branchOf.set(n.id, b); }

    const R = 240 + Math.sqrt(nodes.length) * 14;
    return { nodes, core, sections, branches, depth, palette, colorIndex, branchOf, sectorize, R };
  }

  // ---------- dust writer ----------
  function makeDust(count) {
    return { pos: new Float32Array(count * 3), col: new Uint8Array(count), lvl: new Uint8Array(count), n: 0, count };
  }
  function put(d, x, y, z, col, lvl) {
    if (d.n >= d.count) return false;
    const i = d.n++;
    d.pos[i * 3] = x; d.pos[i * 3 + 1] = y; d.pos[i * 3 + 2] = z;
    d.col[i] = col; d.lvl[i] = lvl;
    return true;
  }
  const budget = (d, share) => Math.min(d.count - d.n, Math.round(d.count * share));

  // Rotate a point in the ring plane (y = 0) about the x axis.
  function tiltX(x, y, z, t, out) {
    const c = Math.cos(t), s = Math.sin(t);
    out[0] = x; out[1] = y * c - z * s; out[2] = y * s + z * c;
    return out;
  }
  const at = (n, x, y, z) => { n.tx = x; n.ty = y; n.tz = z; };
  // Branch whose sector holds angle `a`. Sectors in `list` are contiguous, starting at list[0].a0.
  const sectorOf = (list, a) => {
    if (!list.length) return null;
    const base = list[0].a0, w = wrap(a - base);
    for (const b of list) if (w < b.a1 - base) return b;
    return list[list.length - 1];
  };
  function fibSphere(list, r, cx = 0, cy = 0, cz = 0) {
    list.forEach((n, i) => {
      const y = list.length === 1 ? 0 : 1 - ((i + 0.5) / list.length) * 2;
      const q = Math.sqrt(1 - y * y), th = i * GOLDEN;
      at(n, cx + Math.cos(th) * q * r, cy + y * r, cz + Math.sin(th) * q * r);
    });
  }
  function circle(list, r, start = -Math.PI / 2, span = TAU) {
    list.forEach((n, i) => {
      const a = start + ((i + 0.5) / list.length) * span;
      at(n, Math.cos(a) * r, Math.sin(a) * r, 0);
    });
  }
  const runOf = (ctx, kind) => ctx.branches.filter((b) => b.kind === kind).flatMap((b) => (b.hub ? [b.hub, ...b.items] : b.items));

  // ---------- 3D: orb ----------
  // Knowledge on a dotted sphere, instructions in a white cluster at the center, skills as beads on a tilted
  // orbit ring and apps (mods, MCP servers, agents) as hex badges on a wider ring.
  const TA = 0, TB = 0.08; // ring tilts; the camera pitch shows them as ellipses
  function orb(ctx, rand, d, out) {
    const { R, core, sections, branches, palette } = ctx;
    const v = [0, 0, 0];
    ctx.sectorize(branches); // other layouts re-slice the sectors
    if (core) at(core, 0, 0, 0);
    fibSphere(sections, R * 0.16);
    const inner = branches.filter((b) => b.kind === 'inner');
    for (const b of inner) {
      const am = (b.a0 + b.a1) / 2, span = b.a1 - b.a0, pad = Math.min(0.12, span * 0.12);
      if (b.hub) at(b.hub, Math.cos(am) * R * 0.55, 0, Math.sin(am) * R * 0.55);
      b.items.forEach((n, j) => {
        const f = (j + 0.5) / b.items.length;
        const lat = Math.asin(1 - 2 * f) * 0.85;
        const lon = b.a0 + pad + ((j * GOLDEN) / TAU % 1) * (span - 2 * pad);
        const r = R * (ctx.depth.get(n.id) === 1 && b.items.length > 3 ? 0.8 : 1);
        at(n, r * Math.cos(lat) * Math.cos(lon), -r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon));
      });
    }
    const ring = (list, r, t) => list.forEach((n, i) => {
      const a = -Math.PI / 2 + (i / list.length) * TAU;
      tiltX(Math.cos(a) * r, 0, Math.sin(a) * r, t, v);
      at(n, v[0], v[1], v[2]);
    });
    ring(runOf(ctx, 'bead'), R * 1.34, TA);
    ring(runOf(ctx, 'app'), R * 1.6, TB);
    out.extent = { w: R * 1.62 + 24, h: R * 1.22 };

    // dust: latitude rows on the shell, colored by sector
    const all = branches;
    const ci = all.map((b) => ctx.colorIndex(b.color));    const shell = budget(d, 0.58), rows = 44;
    const per = (shell * Math.PI) / (2 * rows);
    for (let k = 0; k < rows; k++) {
      const th = ((k + 0.5) / rows) * Math.PI, m = Math.max(3, Math.round(per * Math.sin(th)));
      for (let j = 0; j < m; j++) {
        const lon = (j / m) * TAU + k * 0.37, r = R * (0.995 + rand() * 0.012);
        const b = sectorOf(all, lon);
        const u = rand();
        put(d, r * Math.sin(th) * Math.cos(lon), r * Math.cos(th), r * Math.sin(th) * Math.sin(lon), ci[all.indexOf(b)], u < 0.04 ? 3 : u < 0.18 ? 2 : 1);
      }
    }
    for (let i = budget(d, 0.13); i > 0; i--) { // interior haze, denser toward the shell
      const r = R * (0.3 + 0.62 * Math.sqrt(rand())), y = rand() * 2 - 1, q = Math.sqrt(1 - y * y), lon = rand() * TAU;
      put(d, r * q * Math.cos(lon), r * y, r * q * Math.sin(lon), ci[all.indexOf(sectorOf(all, lon))], 0);
    }
    for (let i = budget(d, 0.06); i > 0; i--) { // white sparkle cluster around the core
      const r = Math.abs(gauss(rand)) * R * 0.1 + R * 0.02, y = rand() * 2 - 1, q = Math.sqrt(1 - y * y), lon = rand() * TAU;
      put(d, r * q * Math.cos(lon), r * y, r * q * Math.sin(lon), 0, rand() < 0.3 ? 3 : 2);
    }
    const ringIdx = palette.indexOf(RING), blueIdx = palette.indexOf(BLUE);
    for (let i = budget(d, 0.14); i > 0; i--) { // glowing bead ring
      const a = rand() * TAU, r = R * 1.34 + gauss(rand) * 5;
      tiltX(Math.cos(a) * r, gauss(rand) * 2.5, Math.sin(a) * r, TA, v);
      put(d, v[0], v[1], v[2], ringIdx, rand() < 0.3 ? 2 : 1);
    }
    for (let i = budget(d, 0.05); i > 0; i--) { // faint outer app ring
      const a = rand() * TAU, r = R * 1.6 + gauss(rand) * 3;
      tiltX(Math.cos(a) * r, 0, Math.sin(a) * r, TB, v);
      put(d, v[0], v[1], v[2], blueIdx, 0);
    }
    out.haze = (rand2) => { // leftovers land on the shell
      const y = rand2() * 2 - 1, q = Math.sqrt(1 - y * y), lon = rand2() * TAU;
      return [R * q * Math.cos(lon), R * y, R * q * Math.sin(lon), ci[all.indexOf(sectorOf(all, lon))], 0];
    };
  }

  // ---------- 3D: neural (force-directed, physics places the nodes) ----------
  function neural(ctx, rand, d, out) {
    const { R, branches } = ctx;
    const ci = branches.map((b) => ctx.colorIndex(b.color));
    out.extent = null;
    out.haze = (r2) => {
      const r = R * 1.25 * Math.cbrt(r2()), y = r2() * 2 - 1, q = Math.sqrt(1 - y * y), lon = r2() * TAU;
      return [r * q * Math.cos(lon), r * y * 0.8, r * q * Math.sin(lon), r2() < 0.15 ? 0 : ci[(r2() * ci.length) | 0], 0];
    };
  }

  // ---------- 2D: force (physics, flattened) ----------
  function force(ctx, rand, d, out) {
    const { R, branches } = ctx;
    const ci = branches.map((b) => ctx.colorIndex(b.color));
    out.extent = null;
    out.haze = (r2) => {
      const r = R * 1.3 * Math.sqrt(r2()), a = r2() * TAU;
      return [Math.cos(a) * r, Math.sin(a) * r, 0, r2() < 0.15 ? 0 : ci[(r2() * ci.length) | 0], 0];
    };
  }

  // ---------- 2D: circle ----------
  function circleLayout(ctx, rand, d, out) {
    const { R, core, sections, branches } = ctx;
    const Rc = R * 1.1;
    if (core) at(core, 0, 0, 0);
    circle(sections, R * 0.16);
    const slots = branches.reduce((s, b) => s + b.items.length + 1, 0);
    let k = 0;
    const spokes = [];
    for (const b of branches) {
      const first = k;
      for (const n of b.items) {
        const a = -Math.PI / 2 + ((k + 0.5) / slots) * TAU;
        at(n, Math.cos(a) * Rc, Math.sin(a) * Rc, 0);
        k++;
      }
      const am = -Math.PI / 2 + (((first + k) / 2) / slots) * TAU;
      b.a0 = -Math.PI / 2 + (first / slots) * TAU; b.a1 = -Math.PI / 2 + ((k + 1) / slots) * TAU;
      if (b.hub) at(b.hub, Math.cos(am) * R * 0.55, Math.sin(am) * R * 0.55, 0);
      for (const n of b.items) spokes.push([b.hub ? b.hub.tx : 0, b.hub ? b.hub.ty : 0, n.tx, n.ty, ctx.colorIndex(b.color)]);
      k++; // gap between branches
    }
    out.extent = { w: Rc + 40, h: Rc + 40 };

    const ci = (a) => { const b = sectorOf(branches, a); return b ? ctx.colorIndex(b.color) : 0; };
    for (let i = budget(d, 0.34); i > 0; i--) {
      const a = rand() * TAU, r = Rc + gauss(rand) * 3;
      put(d, Math.cos(a) * r, Math.sin(a) * r, 0, ci(a), rand() < 0.25 ? 2 : 1);
    }
    for (let i = budget(d, 0.08); i > 0; i--) {
      const a = rand() * TAU, r = R * 0.55 + gauss(rand) * 2;
      put(d, Math.cos(a) * r, Math.sin(a) * r, 0, ci(a), 0);
    }
    for (let i = budget(d, 0.05); i > 0; i--) {
      const a = rand() * TAU, r = R * 0.16 + gauss(rand) * 2;
      put(d, Math.cos(a) * r, Math.sin(a) * r, 0, 0, 2);
    }
    if (spokes.length) {
      for (let i = budget(d, 0.3); i > 0; i--) {
        const [x0, y0, x1, y1, c] = spokes[(rand() * spokes.length) | 0], t = rand();
        put(d, x0 + (x1 - x0) * t + gauss(rand) * 1.5, y0 + (y1 - y0) * t + gauss(rand) * 1.5, 0, c, 0);
      }
    }
    out.haze = (r2) => { const r = Rc * Math.sqrt(r2()), a = r2() * TAU; return [Math.cos(a) * r, Math.sin(a) * r, 0, ci(a), 0]; };
  }

  // ---------- 2D: hex ----------
  function hexSpiral(count) {
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const cells = [[0, 0]];
    for (let ring = 1; cells.length < count; ring++) {
      let q = -ring, r = ring; // start at direction 4 scaled by ring
      for (let side = 0; side < 6 && cells.length < count; side++) {
        for (let step = 0; step < ring && cells.length < count; step++) {
          cells.push([q, r]);
          q += dirs[side][0]; r += dirs[side][1];
        }
      }
    }
    return cells;
  }
  function hex(ctx, rand, d, out) {
    const { core, sections, branches } = ctx;
    const list = [...(core ? [core] : []), ...sections];
    for (const b of branches) { if (b.hub) list.push(b.hub); list.push(...b.items); }
    const s = 46, cells = hexSpiral(list.length), S3 = Math.sqrt(3);
    let ext = 0;
    list.forEach((n, i) => {
      const [q, r] = cells[i];
      at(n, s * (S3 * q + (S3 / 2) * r), s * 1.5 * r, 0);
      ext = Math.max(ext, Math.abs(n.tx), Math.abs(n.ty));
    });
    out.extent = { w: ext + s, h: ext + s };

    const colOf = (n) => { const b = ctx.branchOf.get(n.id); return b ? ctx.colorIndex(b.color) : 0; };
    const perCell = Math.max(6, Math.floor((d.count * 0.9) / list.length));
    const edge = Math.min(30, Math.floor(perCell * 0.55));
    const hr = s * 0.92; // corner radius of the tile outline
    for (const n of list) {
      const c = colOf(n);
      for (let j = 0; j < edge; j++) { // tile outline
        const side = j % 6, t = (Math.floor(j / 6) + 0.5) / Math.ceil(edge / 6);
        const a0 = -Math.PI / 2 + (side * TAU) / 6, a1 = a0 + TAU / 6;
        put(d, n.tx + hr * (Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * t), n.ty + hr * (Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * t), 0, c, 1);
      }
      for (let j = edge; j < perCell; j++) { // tile fill
        const a = rand() * TAU, r = hr * 0.8 * Math.sqrt(rand());
        put(d, n.tx + Math.cos(a) * r, n.ty + Math.sin(a) * r, 0, c, 0);
      }
    }
    out.haze = (r2) => {
      const n = list[(r2() * list.length) | 0], a = r2() * TAU, r = hr * 0.8 * Math.sqrt(r2());
      return [n.tx + Math.cos(a) * r, n.ty + Math.sin(a) * r, 0, colOf(n), 0];
    };
  }

  // ---------- 2D: rings ----------
  // Instructions in a white ring at the center, knowledge in colored sectors of concentric dotted rows,
  // skills on a bead ring and apps on the outer ring.
  function rings(ctx, rand, d, out) {
    const { R, core, sections, branches } = ctx;
    if (core) at(core, 0, 0, 0);
    circle(sections, R * 0.16);
    const inner = branches.filter((b) => b.kind === 'inner');
    if (inner.length) ctx.sectorize(inner);
    const wmax = Math.max(1, ...inner.map((b) => b.w));
    for (const b of inner) {
      const am = (b.a0 + b.a1) / 2, span = b.a1 - b.a0;
      if (b.hub) at(b.hub, Math.cos(am) * R * 0.3, Math.sin(am) * R * 0.3, 0);
      const byDepth = new Map();
      for (const n of b.items) {
        const k = Math.min(3, ctx.depth.get(n.id) || 1);
        if (!byDepth.has(k)) byDepth.set(k, []);
        byDepth.get(k).push(n);
      }
      const rmax = R * (0.55 + 0.37 * (b.w / wmax));
      for (const [k, list] of byDepth) {
        const r = Math.min(rmax, R * (0.32 + k * 0.17));
        list.forEach((n, i) => {
          const a = b.a0 + span * ((i + 0.5) / list.length) * 0.86 + span * 0.07;
          const rr = r + (list.length > 6 ? ((i % 3) - 1) * R * 0.05 : 0);
          at(n, Math.cos(a) * rr, Math.sin(a) * rr, 0);
        });
      }
      b.rmax = rmax;
    }
    circle(runOf(ctx, 'bead'), R * 1.08, -Math.PI / 2, TAU);
    circle(runOf(ctx, 'app'), R * 1.32, -Math.PI / 2, TAU);
    out.extent = { w: R * 1.32 + 40, h: R * 1.32 + 40 };

    for (let i = budget(d, 0.06); i > 0; i--) { // white center ring
      const a = rand() * TAU, r = R * (0.12 + 0.08 * Math.floor(rand() * 3) / 2);
      put(d, Math.cos(a) * r, Math.sin(a) * r, 0, 0, rand() < 0.4 ? 3 : 2);
    }
    // Colored sectors of concentric rows; step chosen so the rows use their share exactly.
    const rowsN = 24, r0 = R * 0.38, share = budget(d, 0.64);
    let L = 0;
    for (const b of inner) for (let k = 0; k < rowsN; k++) { const r = r0 + (k / (rowsN - 1)) * (R * 0.92 - r0); if (r <= b.rmax) L += r * (b.a1 - b.a0 - 0.04); }
    const step = L / Math.max(1, share);
    for (const b of inner) {
      const c = ctx.colorIndex(b.color);
      for (let k = 0; k < rowsN; k++) {
        const r = r0 + (k / (rowsN - 1)) * (R * 0.92 - r0);
        if (r > b.rmax) break;
        const m = Math.floor((r * (b.a1 - b.a0 - 0.04)) / step);
        const fade = (r - r0) / Math.max(1, b.rmax - r0);
        for (let j = 0; j < m; j++) {
          const a = b.a0 + 0.02 + ((j + 0.5) / m) * (b.a1 - b.a0 - 0.04);
          put(d, Math.cos(a) * r, Math.sin(a) * r, 0, c, fade > 0.8 ? 0 : rand() < 0.2 ? 2 : 1);
        }
      }
    }
    const ringIdx = ctx.palette.indexOf(RING), blueIdx = ctx.palette.indexOf(BLUE);
    for (let i = budget(d, 0.12); i > 0; i--) {
      const a = rand() * TAU, r = R * (rand() < 0.5 ? 1.065 : 1.095);
      put(d, Math.cos(a) * r, Math.sin(a) * r, 0, ringIdx, 1);
    }
    for (let i = budget(d, 0.05); i > 0; i--) {
      const a = rand() * TAU, r = R * 1.32 + gauss(rand) * 2;
      put(d, Math.cos(a) * r, Math.sin(a) * r, 0, blueIdx, 0);
    }
    out.haze = (r2) => { const a = r2() * TAU, r = R * (0.95 + 0.5 * r2()); return [Math.cos(a) * r, Math.sin(a) * r, 0, 0, 0]; };
  }

  // ---------- 2D: timeline ----------
  // One lane per branch, x = last modified. Undated hubs and groups sit at the start of their lane.
  function timeline(ctx, rand, d, out) {
    const { R, core, sections, branches, nodes } = ctx;
    const lanes = [{ head: core, items: sections, color: '#fff1e0' }, ...branches.map((b) => ({ head: b.hub, items: b.items, color: b.color }))];
    const gap = 84, L = R * 1.5, CURVE = 2.2; // recent weeks get more room than old months
    const times = nodes.map((n) => n.mtime).filter((t) => t > 0);
    let t0 = times.length ? Math.min(...times) : Date.now() - 864e5 * 30, t1 = times.length ? Math.max(...times) : Date.now();
    if (t1 - t0 < 864e5) { t0 -= 864e5; t1 += 3600e3; }
    const xOf = (t) => -L + Math.pow(Math.max(0, (t - t0) / (t1 - t0)), CURVE) * 2 * L;
    const tAt = (f) => t0 + (t1 - t0) * Math.pow(f, 1 / CURVE); // inverse of xOf, for evenly spaced ticks
    const laneY = (k) => (k - (lanes.length - 1) / 2) * gap;
    lanes.forEach((lane, k) => {
      const y = laneY(k);
      if (lane.head) at(lane.head, -L - (lane.head.type === "core" ? 190 : 150), y, 0);
      const dated = lane.items.filter((n) => n.mtime > 0).sort((a, b) => a.mtime - b.mtime);
      for (const n of lane.items) if (!(n.mtime > 0)) at(n, -L - 80, y, 0);
      let lastX = -Infinity, stack = 0;
      for (const n of dated) {
        const x = xOf(n.mtime);
        stack = x - lastX < 22 ? stack + 1 : 0;
        if (!stack) lastX = x;
        const off = stack ? (stack % 2 ? 1 : -1) * Math.min(26, Math.ceil(stack / 2) * 13) : 0;
        at(n, x + (stack > 4 ? (stack - 4) * 6 : 0), y + off, 0);
      }
    });
    const top = laneY(0) - gap / 2, bottom = laneY(lanes.length - 1) + gap / 2;
    out.extent = { w: L + 260, h: Math.max(-top, bottom) + 50 };

    const ticks = 6;
    const fmt = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    for (let i = 0; i <= ticks; i++) {
      const t = tAt(i / ticks);
      out.captions.push({ x: xOf(t), y: bottom + 26, z: 0, text: fmt(t), color: '#8a7a6e', kind: 'tick' });
    }
    out.captions.push({ x: -L - 150, y: bottom + 26, z: 0, text: 'LANE', color: '#5c4f46', kind: 'tick' });

    const laneShare = budget(d, 0.52), perLane = Math.floor(laneShare / lanes.length);
    lanes.forEach((lane, k) => {
      const c = ctx.colorIndex(lane.color), y = laneY(k);
      for (let j = 0; j < perLane; j++) put(d, -L + ((j + 0.5) / perLane) * 2 * L, y + gauss(rand) * 1.2, 0, c, 0);
    });
    for (let i = budget(d, 0.14); i > 0; i--) { // tick columns
      const x = xOf(tAt(((rand() * (ticks + 1)) | 0) / ticks));
      put(d, x, top + rand() * (bottom - top), 0, 0, 0);
    }
    const dated = nodes.filter((n) => n.mtime > 0 && n.type !== 'core');
    for (let i = budget(d, 0.24); i > 0 && dated.length; i--) { // heat around each edit
      const n = dated[(rand() * dated.length) | 0], b = ctx.branchOf.get(n.id);
      put(d, n.tx + gauss(rand) * 9, n.ty + gauss(rand) * 6, 0, b ? ctx.colorIndex(b.color) : 0, rand() < 0.3 ? 1 : 0);
    }
    out.haze = (r2) => [-L + r2() * 2 * L, top + r2() * (bottom - top), 0, 0, 0];
  }

  const LAYOUTS = { orb, neural, force, circle: circleLayout, hex, rings, timeline };

  // Compute one layout: writes tx/ty/tz on the nodes (except physics layouts) and returns
  // { extent: {w, h} | null, captions: [], dust: { pos, col, lvl, count } }.
  function build(name, ctx, count, seed = 7) {
    const fn = LAYOUTS[name];
    if (!fn) throw new Error(`unknown layout: ${name}`);
    const rand = rng(seed * 7919 + name.length * 104729 + name.charCodeAt(0));
    const dust = makeDust(count);
    const out = { extent: null, captions: [], dust, haze: null };
    fn(ctx, rand, dust, out);
    while (dust.n < dust.count) {
      const [x, y, z, c, l] = out.haze(rand);
      put(dust, x, y, z, c, l);
    }
    delete out.haze;
    return out;
  }

  window.NeuralLayouts = { prepare, build, names: Object.keys(LAYOUTS), PHYSICS: new Set(['neural', 'force']), FLAT: new Set(['force', 'circle', 'hex', 'rings', 'timeline']) };
})();
