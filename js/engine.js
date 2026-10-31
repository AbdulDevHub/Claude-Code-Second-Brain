// Neural engine: a dependency-free 3D force-directed layout and an orbit camera with perspective projection.
// Exposes window.NeuralEngine = { Physics, OrbitCamera }.
(() => {
  // ---------- physics ----------
  // Same model as d3-force, extended to 3D: many-body repulsion (force ∝ 1/d), Hooke springs on links,
  // weak gravity toward the origin and soft collisions, integrated with velocity damping and an alpha cooling schedule.
  class Physics {
    constructor(nodes, links, { charge, linkDistance, linkStrength }) {
      this.nodes = nodes;
      this.links = links;
      this.alpha = 1;
      this.alphaTarget = 0;
      this.alphaMin = 0.001;
      this.alphaDecay = 1 - Math.pow(this.alphaMin, 1 / 400); // ~400 ticks to settle
      this.velocityDecay = 0.42;
      this.charge = charge;
      this.linkDistance = linkDistance;
      this.linkStrength = linkStrength;
      this.flat = false; // 2D mode: depth decays to 0 over a few ticks, so a 3D layout folds flat smoothly

      // Seed on a small Fibonacci sphere so the first frames "burst" outward evenly.
      const n = nodes.length;
      nodes.forEach((d, i) => {
        const y = 1 - (i / Math.max(1, n - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const theta = i * 2.399963; // golden angle
        d.x = Math.cos(theta) * r * 12; d.y = y * 12; d.z = Math.sin(theta) * r * 12;
        d.vx = d.vy = d.vz = 0;
      });

      // Link bias: the lower-degree end moves more, like d3's forceLink.
      const degree = new Map(nodes.map((d) => [d, 0]));
      for (const l of links) { degree.set(l.source, degree.get(l.source) + 1); degree.set(l.target, degree.get(l.target) + 1); }
      for (const l of links) {
        const ds = degree.get(l.source), dt = degree.get(l.target);
        l.bias = ds / (ds + dt);
        l.rest = linkDistance(l);
        l.k = linkStrength(l);
      }
      for (const d of nodes) d.q = charge(d);
    }

    reheat(alpha = 0.3) { this.alpha = Math.max(this.alpha, alpha); }
    get active() { return this.alpha >= this.alphaMin || this.alphaTarget > 0; }

    tick() {
      if (!this.active) return false;
      this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
      const a = this.alpha, N = this.nodes;

      // Springs (use predicted positions, as d3 does, for stability).
      for (const l of this.links) {
        const s = l.source, t = l.target;
        let dx = t.x + t.vx - s.x - s.vx, dy = t.y + t.vy - s.y - s.vy, dz = t.z + t.vz - s.z - s.vz;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const f = ((d - l.rest) / d) * a * l.k;
        dx *= f; dy *= f; dz *= f;
        t.vx -= dx * l.bias; t.vy -= dy * l.bias; t.vz -= dz * l.bias;
        s.vx += dx * (1 - l.bias); s.vy += dy * (1 - l.bias); s.vz += dz * (1 - l.bias);
      }

      // Pairwise repulsion + collisions. O(n^2) is fine for a few hundred nodes.
      for (let i = 0; i < N.length; i++) {
        const p = N[i];
        for (let j = i + 1; j < N.length; j++) {
          const q = N[j];
          const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
          const d2 = dx * dx + dy * dy + dz * dz || 1e-4;
          const f = ((p.q + q.q) * 0.5 * a) / d2;
          p.vx -= dx * f; p.vy -= dy * f; p.vz -= dz * f;
          q.vx += dx * f; q.vy += dy * f; q.vz += dz * f;
          const min = p.r + q.r + 10;
          if (d2 < min * min) {
            const d = Math.sqrt(d2), push = ((min - d) / d) * 0.25;
            p.vx -= dx * push; p.vy -= dy * push; p.vz -= dz * push;
            q.vx += dx * push; q.vy += dy * push; q.vz += dz * push;
          }
        }
      }

      // Gravity + integration.
      const keep = 1 - this.velocityDecay;
      for (const d of N) {
        d.vx -= d.x * 0.012 * a; d.vy -= d.y * 0.012 * a; d.vz -= d.z * 0.012 * a;
        if (d.fx != null) { d.x = d.fx; d.y = d.fy; d.z = d.fz; d.vx = d.vy = d.vz = 0; continue; }
        d.vx *= keep; d.vy *= keep; d.vz *= keep;
        d.x += d.vx; d.y += d.vy; d.z += d.vz;
        if (this.flat) { d.z *= 0.8; d.vz = 0; }
      }
      return true;
    }

    bounds() {
      let r = 0;
      for (const d of this.nodes) r = Math.max(r, Math.hypot(d.x, d.y, d.z));
      return r;
    }
  }

  // ---------- camera ----------
  // Orbits a target point. Every property eases toward its `goal`, so fly-to, zoom and auto-rotate are just goal changes.
  class OrbitCamera {
    constructor() {
      this.yaw = 0.6; this.pitch = -0.42; this.dist = 2600; this.focal = 900;
      this.tx = 0; this.ty = 0; this.tz = 0;
      this.cx = 0; this.cy = 0; // screen-space center of the view
      this.goal = { yaw: 0.6, pitch: -0.42, dist: 1100, tx: 0, ty: 0, tz: 0, cx: 0, cy: 0 };
      this.minDist = 140; this.maxDist = 3200;
    }

    update(dt) {
      const e = 1 - Math.exp(-dt * 4.2);
      for (const k of Object.keys(this.goal)) this[k] += (this.goal[k] - this[k]) * e;
      this._trig();
    }

    _trig() { this.cyaw = Math.cos(this.yaw); this.syaw = Math.sin(this.yaw); this.cpit = Math.cos(this.pitch); this.spit = Math.sin(this.pitch); }

    orbit(dYaw, dPitch) {
      this.goal.yaw += dYaw;
      this.goal.pitch = Math.max(-1.35, Math.min(1.35, this.goal.pitch + dPitch));
    }
    zoom(factor) { this.goal.dist = Math.max(this.minDist, Math.min(this.maxDist, this.goal.dist * factor)); }
    lookAt(x, y, z, dist) { Object.assign(this.goal, { tx: x, ty: y, tz: z }); if (dist) this.goal.dist = dist; }

    // World point -> screen. Writes into `out` to avoid allocations in the render loop.
    project(x, y, z, out) {
      x -= this.tx; y -= this.ty; z -= this.tz;
      const x1 = x * this.cyaw - z * this.syaw;
      const z1 = x * this.syaw + z * this.cyaw;
      const y2 = y * this.cpit - z1 * this.spit;
      const z2 = y * this.spit + z1 * this.cpit;
      const depth = z2 + this.dist;
      out.depth = depth;
      out.visible = depth > 40;
      const s = this.focal / Math.max(depth, 40);
      out.s = s;
      out.x = this.cx + x1 * s;
      out.y = this.cy + y2 * s;
      return out;
    }

    // Rotation only (no translation): for the far-away starfield.
    rotate(x, y, z, out) {
      const x1 = x * this.cyaw - z * this.syaw;
      const z1 = x * this.syaw + z * this.cyaw;
      out.x = x1; out.y = y * this.cpit - z1 * this.spit; out.z = y * this.spit + z1 * this.cpit;
      return out;
    }

    // Screen-space drag delta at a given depth -> world-space delta in the camera plane (for dragging nodes).
    unprojectDelta(dxs, dys, depth) {
      const k = depth / this.focal;
      const x1 = dxs * k, y2 = dys * k, z2 = 0;
      const y = y2 * this.cpit + z2 * this.spit;
      const z1 = -y2 * this.spit + z2 * this.cpit;
      return { x: x1 * this.cyaw + z1 * this.syaw, y, z: -x1 * this.syaw + z1 * this.cyaw };
    }
  }

  window.NeuralEngine = { Physics, OrbitCamera };
})();
