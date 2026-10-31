// Canvas renderer for the brain: a dim starfield, the decorative dust cloud (thousands of points that morph between
// layouts), synapses with travelling pulses, glowing knowledge nodes, hex/bead badges for tools, a white sparkle
// core, captions, labels and HUD reticles. Exposes window.NeuralRenderer.create(canvas, state).
(() => {
  const TAU = Math.PI * 2;

  const hexToRgb = (hex) => {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const BADGE = { skill: 'circle', group: 'circle', mod: 'hex', mcp: 'hex', agent: 'hex' };

  // One soft radial glow per color, drawn once and stamped with drawImage (much cheaper than per-frame gradients).
  const spriteCache = new Map();
  function glowSprite(hex) {
    if (spriteCache.has(hex)) return spriteCache.get(hex);
    const size = 128, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), rgb = hexToRgb(hex);
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, rgba(rgb, 1));
    grad.addColorStop(0.07, rgba(rgb, 0.85));
    grad.addColorStop(0.22, rgba(rgb, 0.32));
    grad.addColorStop(0.5, rgba(rgb, 0.08));
    grad.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    spriteCache.set(hex, c);
    return c;
  }

  // A bright point: white-hot center fading into the color, also drawn once per color.
  const bodyCache = new Map();
  function bodySprite(hex) {
    if (bodyCache.has(hex)) return bodyCache.get(hex);
    const size = 96, r = size / 2, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), rgb = hexToRgb(hex);
    const grad = g.createRadialGradient(r * 0.8, r * 0.8, r * 0.05, r, r, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, rgba(rgb.map((v) => Math.min(255, v + 50)), 1));
    grad.addColorStop(1, rgba(rgb.map((v) => v * 0.45), 1));
    g.fillStyle = grad;
    g.beginPath(); g.arc(r, r, r, 0, TAU); g.fill();
    bodyCache.set(hex, c);
    return c;
  }

  // The core: a white glow crossed by thin diffraction rays.
  let spark = null;
  function sparkSprite() {
    if (spark) return spark;
    const size = 256, m = size / 2, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const glow = g.createRadialGradient(m, m, 0, m, m, m * 0.6);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.12, 'rgba(255,244,230,0.85)');
    glow.addColorStop(0.4, 'rgba(255,170,110,0.18)');
    glow.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, size, size);
    for (const [w, len] of [[2.4, m], [1.4, m * 0.55]]) {
      for (let k = 0; k < 2; k++) {
        g.save();
        g.translate(m, m);
        g.rotate(len === m ? (k * Math.PI) / 2 : Math.PI / 4 + (k * Math.PI) / 2);
        const ray = g.createLinearGradient(-len, 0, len, 0);
        ray.addColorStop(0, 'rgba(255,255,255,0)');
        ray.addColorStop(0.5, 'rgba(255,255,255,0.95)');
        ray.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = ray;
        g.fillRect(-len, -w / 2, len * 2, w);
        g.restore();
      }
    }
    return (spark = c);
  }

  // Tool badge: a dark hexagon or circle with a glowing rim and a white line icon. Parked tools get a dashed rim.
  const badgeCache = new Map();
  function badgeSprite(shape, glyph, hex, parked) {
    const key = `${shape}|${glyph}|${hex}|${parked}`;
    if (badgeCache.has(key)) return badgeCache.get(key);
    const size = 112, m = size / 2, r = 40, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), rgb = hexToRgb(hex);
    g.beginPath();
    if (shape === 'hex') {
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 6;
        i ? g.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r) : g.moveTo(m + Math.cos(a) * r, m + Math.sin(a) * r);
      }
      g.closePath();
    } else g.arc(m, m, r * 0.9, 0, TAU);
    g.fillStyle = parked ? 'rgba(16,13,12,0.92)' : shape === 'hex' ? 'rgba(8,16,28,0.95)' : 'rgba(26,12,5,0.95)';
    g.fill();
    if (!parked) { g.shadowColor = rgba(rgb, 0.95); g.shadowBlur = 16; }
    else g.setLineDash([7, 6]);
    g.strokeStyle = rgba(rgb, parked ? 0.5 : 0.95);
    g.lineWidth = 3.5;
    g.stroke();
    g.shadowBlur = 0; g.setLineDash([]);
    const path = window.NeuralGlyphs && window.NeuralGlyphs.PATHS[glyph];
    if (path && typeof Path2D === 'function') {
      const k = shape === 'hex' ? 1.7 : 1.5;
      g.save();
      g.translate(m - 12 * k, m - 12 * k);
      g.scale(k, k);
      g.lineWidth = 3.2 / k;
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = parked ? 'rgba(170,155,145,0.75)' : '#ffffff';
      g.stroke(new Path2D(path));
      g.restore();
    }
    badgeCache.set(key, c);
    return c;
  }

  function create(canvas, state) {
    const ctx = canvas.getContext('2d');
    const { cam } = state;
    let W = 0, H = 0, DPR = 1;
    const tmp = { x: 0, y: 0, z: 0, s: 0, depth: 0, visible: true };

    // Stars live on a unit sphere and only rotate with the camera, so they read as infinitely far away.
    const stars = Array.from({ length: 420 }, () => {
      const u = Math.random() * 2 - 1, th = Math.random() * TAU, r = Math.sqrt(1 - u * u);
      return { x: r * Math.cos(th), y: u, z: r * Math.sin(th), m: Math.random() ** 3 * 1.4 + 0.3, p: Math.random() * TAU, tw: 0.5 + Math.random() * 2 };
    });

    for (const n of state.nodes) {
      n.p = { x: 0, y: 0, s: 0, depth: 0, visible: false };
      n.rgb = hexToRgb(n.color);
      n.rgbDark = n.rgb.map((c) => c * 0.35);
      n.rgbLight = n.rgb.map((c) => Math.min(255, c + 60));
      n.sprite = glowSprite(n.color);
      n.bodySprite = n.type === 'core' ? sparkSprite() : bodySprite(n.color);
      n.badge = BADGE[n.type] && window.NeuralGlyphs
        ? badgeSprite(BADGE[n.type], window.NeuralGlyphs.glyphFor(n), n.color, n.active === false)
        : null;
      n.edgeStyle = `rgb(${n.rgb.join(',')})`;
    }
    const labelWidths = new Map(); // font|text -> px, so measureText runs once per label
    document.fonts?.addEventListener?.('loadingdone', () => labelWidths.clear()); // web fonts change the metrics
    const order = [];
    for (const l of state.links) l.phase = Math.random();

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    }

    const fogAt = (depth) => (state.flat ? 1 : clamp(1.3 - (depth / cam.dist) * 0.62, 0.12, 1));

    // ---------- layers ----------
    // Stars are batched into a few brightness levels: one fill per level instead of one per star.
    const STAR_LEVELS = 4;
    const starBuckets = Array.from({ length: STAR_LEVELS }, () => []);
    const STAR_STYLES = Array.from({ length: STAR_LEVELS }, (_, k) => `rgba(255,236,220,${(0.08 + (k / (STAR_LEVELS - 1)) * 0.4).toFixed(2)})`);
    function drawStars(t) {
      const f = Math.min(W, H) * 0.45;
      for (const b of starBuckets) b.length = 0;
      for (const s of stars) {
        cam.rotate(s.x, s.y, s.z, tmp);
        if (tmp.z < 0.08) continue;
        const x = W / 2 + (tmp.x / tmp.z) * f, y = H / 2 + (tmp.y / tmp.z) * f;
        if (x < 0 || y < 0 || x > W || y > H) continue;
        const a = (state.reduceMotion ? 0.55 : 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.tw + s.p))) * Math.min(1, s.m);
        starBuckets[Math.min(STAR_LEVELS - 1, Math.floor(a * STAR_LEVELS))].push(x, y, s.m);
      }
      starBuckets.forEach((pts, k) => {
        if (!pts.length) return;
        ctx.fillStyle = STAR_STYLES[k];
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 3) ctx.rect(pts[i], pts[i + 1], pts[i + 2], pts[i + 2]);
        ctx.fill();
      });
    }

    // ---------- dust ----------
    // Positions morph from the previous layout's cloud to the next one over MORPH seconds. Points are bucketed by
    // color and brightness so the whole cloud costs a few dozen fills per frame.
    const MORPH = 1.4, DUST_ALPHA = [0.42, 0.72, 0.95, 1], DUST_SIZE = [1.3, 1.8, 2.4, 3.1], STEPS = 5;
    const dust = { from: null, to: null, col: null, lvl: null, colFrom: null, lvlFrom: null, count: 0, t0: -1e9, palette: [], styles: [], buckets: [] };
    function setDust(d, palette, now) {
      const k = ease(dustProgress(now)); // same eased progress drawDust uses, so a mid-morph switch doesn't jump
      if (dust.to && dust.count === d.count) {
        const cur = new Float32Array(d.count * 3);
        for (let i = 0; i < cur.length; i++) cur[i] = dust.from[i] + (dust.to[i] - dust.from[i]) * k;
        dust.from = cur;
        dust.colFrom = k < 0.5 ? dust.colFrom : dust.col;
        dust.lvlFrom = k < 0.5 ? dust.lvlFrom : dust.lvl;
      } else {
        // First cloud: burst out of the core.
        dust.from = new Float32Array(d.count * 3);
        dust.colFrom = d.col; dust.lvlFrom = d.lvl;
      }
      dust.to = d.pos; dust.col = d.col; dust.lvl = d.lvl; dust.count = d.count;
      dust.t0 = now;
      if (palette.length !== dust.palette.length || palette.some((c, i) => c !== dust.palette[i])) {
        dust.palette = palette.slice();
        dust.styles = [];
        for (const hex of dust.palette) {
          const rgb = hexToRgb(hex);
          for (let s = 0; s < STEPS; s++) dust.styles.push(rgba(rgb, ((s + 1) / STEPS).toFixed(2)));
        }
        dust.buckets = dust.styles.map(() => []);
      }
    }
    // Collapse the cloud into the core and let it expand again (used when the boot screen lifts).
    function burst(now) {
      if (!dust.to) return;
      dust.from = new Float32Array(dust.count * 3);
      dust.colFrom = dust.col; dust.lvlFrom = dust.lvl;
      dust.t0 = now;
    }
    const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    function dustProgress(now) { return state.reduceMotion ? 1 : clamp((now - dust.t0) / MORPH, 0, 1); }

    function drawDust(t) {
      if (!dust.to) return;
      const k = ease(dustProgress(t));
      const { cyaw, syaw, cpit, spit, tx, ty, tz, dist, focal, cx, cy } = cam;
      const from = dust.from, to = dust.to, col = k < 0.5 ? dust.colFrom : dust.col, lvl = k < 0.5 ? dust.lvlFrom : dust.lvl;
      const buckets = dust.buckets, flat = state.flat, twinkle = !state.reduceMotion;
      for (const b of buckets) b.length = 0;
      for (let i = 0, j = 0; i < dust.count; i++, j += 3) {
        const x = (k === 1 ? to[j] : from[j] + (to[j] - from[j]) * k) - tx;
        const y = (k === 1 ? to[j + 1] : from[j + 1] + (to[j + 1] - from[j + 1]) * k) - ty;
        const z = (k === 1 ? to[j + 2] : from[j + 2] + (to[j + 2] - from[j + 2]) * k) - tz;
        const x1 = x * cyaw - z * syaw, z1 = x * syaw + z * cyaw;
        const y2 = y * cpit - z1 * spit, depth = y * spit + z1 * cpit + dist;
        if (depth < 40) continue;
        const s = focal / depth, sx = cx + x1 * s, sy = cy + y2 * s;
        if (sx < -4 || sy < -4 || sx > W + 4 || sy > H + 4) continue;
        const l = lvl[i];
        let a = DUST_ALPHA[l] * (flat ? 0.85 : clamp(1.35 - (depth / dist) * 0.75, 0.1, 1));
        if (twinkle && (i & 7) === 0) a *= 0.55 + 0.45 * Math.sin(t * 1.7 + i * 0.37);
        if (a < 0.04) continue;
        const size = DUST_SIZE[l] * clamp(s, 0.55, 1.7);
        buckets[col[i] * STEPS + Math.min(STEPS - 1, (a * STEPS) | 0)].push(sx - size / 2, sy - size / 2, size);
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let b = 0; b < buckets.length; b++) {
        const pts = buckets[b];
        if (!pts.length) continue;
        ctx.fillStyle = dust.styles[b];
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 3) ctx.rect(pts[i], pts[i + 1], pts[i + 2], pts[i + 2]);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawCaptions() {
      if (!state.captions || !state.captions.length) return;
      ctx.font = "500 10px 'JetBrains Mono', monospace";
      if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const c of state.captions) {
        cam.project(c.x, c.y, c.z, tmp);
        if (!tmp.visible) continue;
        ctx.fillStyle = c.color;
        ctx.fillText(c.text, tmp.x, tmp.y);
        if (c.kind === 'tick') { ctx.fillRect(tmp.x - 0.5, tmp.y - 16, 1, 6); }
      }
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }

    function drawLinks(t, focus, focal) {
      const scale = state.linkScale;
      for (const l of state.links) {
        const s = l.source, d = l.target;
        if (!s.visibleNow || !d.visibleNow || !s.p.visible || !d.p.visible) continue;
        const lit = !focus ? null : focal ? s === focal || d === focal : focus.has(s.id) && focus.has(d.id);
        if (lit === null && scale === 0) continue;
        const fog = fogAt((s.p.depth + d.p.depth) / 2);
        const parked = s.active === false || d.active === false;
        const base = (l.kind === 'structure' ? 0.36 : 0.22) * (parked ? 0.5 : 1) * scale;
        const alpha = (lit === null ? base : lit ? 0.9 : 0.025 * scale) * fog;
        if (alpha < 0.01) continue;
        // Two-tone gradients only for highlighted synapses; the rest use the target's color via globalAlpha.
        if (lit) {
          const g = ctx.createLinearGradient(s.p.x, s.p.y, d.p.x, d.p.y);
          g.addColorStop(0, s.edgeStyle); g.addColorStop(1, d.edgeStyle);
          ctx.strokeStyle = g;
        } else ctx.strokeStyle = d.edgeStyle;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = lit ? 1.6 : 0.8;
        const dashed = l.kind === 'mention' || parked;
        if (dashed) ctx.setLineDash(parked ? [2, 4] : [3, 5]);
        ctx.beginPath(); ctx.moveTo(s.p.x, s.p.y); ctx.lineTo(d.p.x, d.p.y); ctx.stroke();
        ctx.globalAlpha = 1;
        if (dashed) ctx.setLineDash([]);

        // Signal pulses (two per lit synapse, one otherwise). Parked tools carry no signal.
        if (state.reduceMotion || lit === false || parked || (lit === null && scale < 0.5)) continue;
        const pulses = lit ? 2 : 1, speed = (lit ? 0.55 : l.kind === 'structure' ? 0.22 : 0.12) * state.motion;
        for (let k = 0; k < pulses; k++) {
          const ph = (t * speed + l.phase + k / pulses) % 1;
          const x = s.p.x + (d.p.x - s.p.x) * ph, y = s.p.y + (d.p.y - s.p.y) * ph;
          const size = (lit ? 16 : 10) * clamp((s.p.s + d.p.s) / 2, 0.4, 1.6);
          ctx.globalAlpha = (lit ? 1 : 0.7) * fog * Math.sin(ph * Math.PI);
          ctx.drawImage(d.sprite, x - size / 2, y - size / 2, size, size);
          ctx.globalAlpha = 1;
        }
      }
    }

    function drawNodes(t, focus) {
      order.length = 0; // reused every frame
      for (const n of state.nodes) if (n.visibleNow && n.p.visible) order.push(n);
      order.sort((a, b) => b.p.depth - a.p.depth);
      for (const n of order) {
        const { x, y, s, depth } = n.p;
        const dim = focus && !focus.has(n.id);
        const fog = fogAt(depth) * (dim ? 0.2 : 1);
        const pulse = state.reduceMotion ? 1 : 1 + Math.sin(t * 1.8 + n.seed) * 0.07;
        const R = Math.max(1.4, n.r * s);
        const dormant = n.active === false;

        ctx.globalCompositeOperation = 'lighter';
        if (n.type === 'core') {
          ctx.globalAlpha = fog;
          const G = R * 9 * pulse;
          ctx.drawImage(n.sprite, x - G / 2, y - G / 2, G, G);
          const S = R * 7;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(state.reduceMotion ? 0 : t * 0.05 * state.motion);
          ctx.drawImage(n.bodySprite, -S / 2, -S / 2, S, S);
          ctx.restore();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          continue;
        }
        ctx.globalAlpha = fog * (dormant ? 0.18 : n.badge ? 0.45 : 0.9);
        const G = R * (n.badge ? 4.2 : 6.5) * pulse;
        ctx.drawImage(n.sprite, x - G / 2, y - G / 2, G, G);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        if (n.badge) {
          const B = R * 3.2;
          ctx.globalAlpha = fog * (dormant ? 0.7 : 1);
          ctx.drawImage(n.badge, x - B / 2, y - B / 2, B, B);
          ctx.globalAlpha = 1;
          continue;
        }

        // Knowledge reads as a bright star; hubs get a larger body and a thin orbit ring.
        const hubLike = n.type === 'hub' || n.type === 'project';
        const Rb = hubLike ? R : R * 0.75;
        ctx.globalAlpha = fog;
        ctx.drawImage(n.bodySprite, x - Rb, y - Rb, Rb * 2, Rb * 2);
        ctx.globalAlpha = 1;
        if (hubLike) {
          ctx.strokeStyle = rgba(n.rgb, 0.5 * fog);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(x, y, R * 1.9, 0, TAU); ctx.stroke();
        }
      }
      return order;
    }

    // Labels are placed greedily by priority (selection > focus > hubs > nearest) and skipped when they would overlap.
    const RANK = { core: 0, hub: 1, project: 2, group: 2 };
    function drawLabels(order, focus) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const placed = [];
      const candidates = order.filter((n) => {
        const important = n.type in RANK;
        const inFocus = focus && focus.has(n.id);
        if (focus && !inFocus && !important) return false;
        if (important || inFocus) return true;
        if (n.type === "skill" || n.type === "group") return false; // the bead ring would be a wall of text
        return n.r * n.p.s >= (n.badge ? 10 : 6.5);
      }).sort((a, b) => {
        const pa = a === state.selected ? -2 : a === state.hovered ? -1 : RANK[a.type] ?? 3;
        const pb = b === state.selected ? -2 : b === state.hovered ? -1 : RANK[b.type] ?? 3;
        return pa - pb || a.p.depth - b.p.depth;
      });
      for (const n of candidates) {
        const important = n.type in RANK;
        const inFocus = focus && focus.has(n.id);
        const R = n.r * n.p.s;
        const fog = fogAt(n.p.depth) * (focus && !inFocus ? 0.35 : 1);
        if (fog < 0.15) continue;
        const text = important ? n.label.toUpperCase() : n.label;
        ctx.font = n.type === 'core' ? "700 13px 'Outfit', sans-serif" : important ? "600 11px 'Outfit', sans-serif" : "500 11px 'Outfit', sans-serif";
        if ('letterSpacing' in ctx) ctx.letterSpacing = important ? '3px' : '0.3px';
        const y = n.p.y + R * (n.type === 'core' ? 3.4 : n.badge ? 1.5 : important ? 2.3 : 1.6) + 5;
        const wKey = ctx.font + '|' + text;
        let w = labelWidths.get(wKey);
        if (w === undefined) { w = ctx.measureText(text).width; labelWidths.set(wKey, w); }
        const box = { x0: n.p.x - w / 2 - 5, y0: y - 2, x1: n.p.x + w / 2 + 5, y1: y + 14 };
        if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
        placed.push(box);
        ctx.fillStyle = `rgba(0,0,0,${0.55 * fog})`;
        ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, 16);
        ctx.fillStyle = important ? rgba(n.rgbLight, fog) : n.active === false ? `rgba(165,150,140,${0.8 * fog})` : `rgba(255,244,234,${0.92 * fog})`;
        ctx.fillText(text, n.p.x, y);
      }
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }

    function bracket(x, y, r, len, style) {
      ctx.strokeStyle = style;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(x + sx * r, y + sy * (r - len)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - len), y + sy * r);
      }
      ctx.stroke();
    }

    function drawReticles(t) {
      const sel = state.selected, hov = state.hovered;
      if (hov && hov !== sel && hov.p.visible) {
        const R = Math.max(10, hov.r * hov.p.s * 1.6);
        ctx.lineWidth = 1;
        bracket(hov.p.x, hov.p.y, R + 4, 6, rgba(hov.rgb, 0.9));
        // leader line to the tooltip
        if (state.tooltipAt) {
          ctx.strokeStyle = rgba(hov.rgb, 0.7);
          ctx.beginPath();
          ctx.moveTo(hov.p.x + R * 0.7, hov.p.y - R * 0.7);
          ctx.lineTo(state.tooltipAt.x - 14, state.tooltipAt.y);
          ctx.lineTo(state.tooltipAt.x, state.tooltipAt.y);
          ctx.stroke();
        }
      }
      if (sel && sel.p.visible && sel.visibleNow) {
        const R = Math.max(14, sel.r * sel.p.s * 1.9) + 8;
        const spin = state.reduceMotion ? 0 : t * 0.9;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgba(sel.rgb, 0.95);
        for (let i = 0; i < 3; i++) {
          const a = spin + (i * TAU) / 3;
          ctx.beginPath(); ctx.arc(sel.p.x, sel.p.y, R, a, a + 1.2); ctx.stroke();
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(sel.rgb, 0.45);
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.arc(sel.p.x, sel.p.y, R + 9, -spin * 0.6, -spin * 0.6 + TAU); ctx.stroke();
        ctx.setLineDash([]);
        bracket(sel.p.x, sel.p.y, R + 18, 8, 'rgba(255,255,255,0.8)');
        ctx.font = "600 10px 'JetBrains Mono', monospace";
        ctx.textBaseline = 'middle';
        const lock = `◤ LOCK // ${sel.label.toUpperCase().slice(0, 28)}`;
        // Readout to the upper right of the target, nudged left just enough to stay on screen.
        ctx.textAlign = 'left';
        const lx = Math.max(8, Math.min(sel.p.x + R + 24, W - 8 - ctx.measureText(lock).width));
        ctx.fillStyle = rgba(sel.rgb, 0.95);
        ctx.fillText(lock, lx, sel.p.y - R - 10);
        ctx.fillStyle = 'rgba(200,180,165,0.75)';
        ctx.fillText(`D ${Math.round(sel.p.depth)} · ${sel.degree} LINKS`, lx, sel.p.y - R + 4);
      }
    }

    // ---------- frame ----------
    function draw(t) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);

      for (const n of state.nodes) cam.project(n.x, n.y, n.z, n.p);
      const focus = state.focusSet();
      const focal = state.hovered || state.selected;

      drawStars(t);
      drawDust(t);
      drawCaptions();
      ctx.globalCompositeOperation = 'lighter';
      drawLinks(t, focus, focal);
      ctx.globalCompositeOperation = 'source-over';
      const order = drawNodes(t, focus);
      drawLabels(order, focus);
      drawReticles(t);
      return order.length;
    }

    function pick(mx, my) {
      let best = null, bestScore = Infinity;
      for (const n of state.nodes) {
        if (!n.visibleNow || !n.p.visible) continue;
        const R = Math.max(9, n.r * n.p.s * (n.badge ? 1.4 : 1.6));
        const d = Math.hypot(n.p.x - mx, n.p.y - my);
        if (d > R) continue;
        const inside = d <= Math.max(5, n.r * n.p.s); // cursor is on the visible body
        const score = inside ? n.p.depth / 1e6 : 1 + d / R; // bodies first (front-most wins), then nearest halo
        if (score < bestScore) { best = n; bestScore = score; }
      }
      return best;
    }

    resize();
    return { resize, draw, pick, setDust, burst, size: () => ({ W, H }) };
  }

  window.NeuralRenderer = { create };
})();
