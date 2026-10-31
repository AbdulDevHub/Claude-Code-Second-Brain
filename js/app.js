// Second Brain HUD: wires the data (window.BRAIN), the layouts, the physics engine, the renderer and the interface together.
function startSecondBrain(isDemo) {
  const BRAIN = window.BRAIN;
  const $ = (s) => document.querySelector(s);
  if (!BRAIN || !window.NeuralEngine || !window.NeuralRenderer || !window.NeuralLayouts) {
    $('#boot-log').textContent = 'FATAL: no brain data. Run `npm run build` first.';
    return;
  }
  const { Physics, OrbitCamera } = window.NeuralEngine;
  const Layouts = window.NeuralLayouts;
  const TAU = Math.PI * 2;

  // Warm palette: knowledge in oranges and reds, tools that reach outside (mods, MCP, agents) in cool accents.
  const COLORS = {
    core: '#ffffff', hub: '#ffd9c2', section: '#ffe8d6', project: '#ff8a3d', memory: '#ff6a2b',
    note: '#ff3b30', skill: '#ffb347', mod: '#4fd8ff', agent: '#9d8cff', reference: '#ffd166', mcp: '#3aa0ff',
  };
  const HUB_COLOR = { 'hub:memory': 'memory', 'hub:notes': 'note', 'hub:skill': 'skill', 'hub:mod': 'mod', 'hub:agent': 'agent', 'hub:mcp': 'mcp', 'hub:reference': 'reference' };
  const TYPE_NAMES = {
    core: 'Core', hub: 'Hub', section: 'Instruction', project: 'Project memory', memory: 'Memory',
    note: 'Note', skill: 'Skill', mod: 'Mod', agent: 'Agent', reference: 'Reference', mcp: 'MCP server', group: 'Group',
  };
  // Channels toggle one or more node types. The core and hubs always stay visible.
  const FILTERS = [
    { key: 'memory', label: 'Memories', types: ['memory', 'project'] },
    { key: 'note', label: 'Notes', types: ['note'] },
    { key: 'skill', label: 'Skills', types: ['skill'] },
    { key: 'mod', label: 'Mods', types: ['mod'] },
    { key: 'agent', label: 'Agents', types: ['agent'] },
    { key: 'mcp', label: 'MCP servers', types: ['mcp'] },
    { key: 'reference', label: 'Reference', types: ['reference'] },
    { key: 'section', label: 'Instructions', types: ['section'] },
    { key: 'dormant', label: 'Parked tools', dormant: true },
  ];
  const VIEWS = [
    { key: 'orbs', label: '3D orbs', title: '3D ORBS', subs: [['orb', 'Orb'], ['neural', 'Neural']] },
    { key: 'map', label: '2D map', title: '2D MAP', subs: [['force', 'Force'], ['circle', 'Circle'], ['hex', 'Hex'], ['rings', 'Rings']] },
    { key: 'timeline', label: 'Timeline', title: 'TIMELINE', layout: 'timeline' },
    { key: 'skills', label: 'Skills', title: 'SKILLS DECK', deck: true },
    { key: 'apps', label: 'Applications', title: 'APPLICATIONS', deck: true },
  ];
  const BASE_R = { core: 22, hub: 9.5, project: 8, group: 9, section: 5, memory: 5.5, note: 5.5, skill: 9, mod: 12, agent: 12, mcp: 12, reference: 5.5 };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isPhone = () => window.innerWidth <= 900;
  const DUST_COUNT = window.innerWidth <= 900 ? 4000 : 6500;

  if (window.DOMPurify) {
    // Links inside notes open in a new tab instead of navigating away from the graph.
    DOMPurify.addHook('afterSanitizeAttributes', (el) => {
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
    });
  }

  // ---------- graph data ----------
  const channelOf = (n) => (n.type === 'group' ? (n.id.includes('skill') ? 'skill' : 'mod') : n.type);
  const colorOf = (n) => COLORS[n.type === 'hub' ? HUB_COLOR[n.id] || 'hub' : channelOf(n)] || '#ffffff';
  // Every node and link gets the same fixed set of fields up front. Objects with one shape keep V8's
  // property access fast in the physics and render loops; adding fields later made physics ~7x slower.
  const nodes = BRAIN.nodes.map((n, i) => ({
    id: n.id, type: n.type, label: n.label, desc: n.desc || '', body: n.body || '', file: n.file, mtime: n.mtime, size: n.size || 0,
    sub: n.sub, project: n.project, version: n.version, model: n.model, active: n.active,
    channel: channelOf(n), color: colorOf(n), seed: i * 1.37, visibleNow: true,
    degree: 0, r: 0, q: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: null, fy: null, fz: null, tx: 0, ty: 0, tz: 0,
    p: null, rgb: null, rgbDark: null, rgbLight: null, sprite: null, bodySprite: null, badge: null, edgeStyle: '',
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = BRAIN.links
    .map((l) => ({ source: byId.get(l.source), target: byId.get(l.target), kind: l.kind, bias: 0, rest: 0, k: 0, phase: 0 }))
    .filter((l) => l.source && l.target);
  const neighbors = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const l of links) { neighbors.get(l.source.id).add(l.target.id); neighbors.get(l.target.id).add(l.source.id); }
  for (const n of nodes) { n.degree = neighbors.get(n.id).size; n.r = (BASE_R[n.type] || 6) + Math.min(6, Math.sqrt(n.degree) * 1.3); }

  const hidden = new Set();
  const isVisible = (n) => !FILTERS.some((f) => hidden.has(f.key) && (f.dormant ? n.active === false : f.types.includes(n.channel)));
  const refreshVisibility = () => { for (const n of nodes) n.visibleNow = isVisible(n); };

  const physics = new Physics(nodes, links, {
    charge: (d) => ({ core: 900, hub: 460, project: 260 })[d.type] || 130,
    linkDistance: (l) => {
      if (l.kind !== 'structure') return 190;
      if (l.source.type === 'core') return l.target.type === 'hub' ? 150 : 105;
      return l.source.type === 'hub' ? 78 : 52;
    },
    linkStrength: (l) => (l.kind === 'structure' ? 0.7 : 0.04),
  });
  const core = byId.get('core');
  if (core) { core.fx = core.fy = core.fz = 0; }
  const layoutCtx = Layouts.prepare(nodes, links);

  const cam = new OrbitCamera();
  const state = {
    nodes, links, cam, reduceMotion, radius: 60, motion: 1, flat: false, structured: true, linkScale: 0.3, captions: [],
    selected: null, hovered: null, highlight: null, searchHits: null, tooltipAt: null,
    focusSet() {
      const f = this.hovered || this.selected;
      if (f) return new Set([f.id, ...neighbors.get(f.id)]);
      return this.highlight || this.searchHits;
    },
  };
  const canvas = $('#graph');
  const renderer = window.NeuralRenderer.create(canvas, state);
  window.__brain = { state, physics, cam, renderer, layoutCtx }; // devtools handle

  // ---------- camera framing ----------
  const panelOpen = () => document.body.classList.contains('panel-open');
  function viewRect() {
    const { W, H } = renderer.size();
    if (isPhone()) {
      if (panelOpen()) return { x: 0, y: 0, w: W, h: H * 0.3 }; // strip above the bottom sheet
      return { x: 0, y: 265, w: W, h: H - 265 - 64 };
    }
    const right = panelOpen() ? 470 + 44 : 0;
    return { x: 0, y: 130, w: W - right, h: H - 130 - 40 };
  }
  function frameView(snap = false) {
    const v = viewRect();
    cam.goal.cx = v.x + v.w / 2;
    cam.goal.cy = v.y + v.h / 2;
    if (snap) { cam.cx = cam.goal.cx; cam.cy = cam.goal.cy; }
  }
  let extent = null; // fixed half-size of a structured layout; physics layouts measure themselves
  const fitDist = () => {
    const v = viewRect();
    const w = extent ? extent.w : state.radius + 30, h = extent ? extent.h : state.radius + 30;
    const d = cam.focal * Math.max(w / Math.max(60, v.w * 0.47), h / Math.max(60, v.h * 0.47));
    return Math.max(cam.minDist, Math.min(cam.maxDist, d));
  };
  let fitting = true; // keep re-fitting while the graph is still expanding
  let fitTimer = null;
  function recenter() {
    fitting = true;
    cam.lookAt(0, 0, 0, fitDist());
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => { fitting = false; }, 2500);
  }

  // ---------- views and layouts ----------
  const PREF_KEY = 'second-brain:view';
  const prefs = { view: 'orbs', sub: { orbs: 'orb', map: 'rings' } };
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    if (typeof saved.view === 'string') prefs.view = saved.view;
    if (saved.sub && typeof saved.sub === 'object') for (const k of ['orbs', 'map']) if (typeof saved.sub[k] === 'string') prefs.sub[k] = saved.sub[k];
  } catch { /* storage blocked or malformed */ }
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ } };
  let view = VIEWS[0], layout = null;

  function setLayout(name) {
    if (name === layout || !Layouts.names.includes(name)) return;
    const wasFlat = state.flat, first = layout === null;
    layout = name;
    const res = Layouts.build(name, layoutCtx, DUST_COUNT);
    extent = res.extent;
    state.captions = res.captions;
    state.structured = !Layouts.PHYSICS.has(name);
    state.flat = Layouts.FLAT.has(name);
    state.linkScale = state.structured ? 0.14 : 1;
    physics.flat = state.flat;
    renderer.setDust(res.dust, layoutCtx.palette, performance.now() / 1000);
    if (!state.structured) {
      for (const n of nodes) if (n !== core) n.fx = n.fy = n.fz = null;
      if (core) { core.x = core.y = core.z = 0; } // pinned at the origin; don't let it snap there mid-frame
      // Coming from a flat layout, depth is all zero and the 3D forces would never lift it: add a little jitter.
      if (!state.flat && wasFlat) for (const n of nodes) if (n !== core) n.z += (Math.random() - 0.5) * 80;
      if (!first) physics.reheat(1);
    }
    if (state.flat) { cam.goal.yaw = Math.round(cam.goal.yaw / TAU) * TAU; cam.goal.pitch = 0; }
    else if (wasFlat || first) cam.goal.pitch = -0.46;
    if (!state.selected) recenter();
  }

  function setView(key, sub) {
    view = VIEWS.find((v) => v.key === key) || VIEWS[0];
    if (sub && view.subs) prefs.sub[view.key] = sub;
    if (view.subs && !view.subs.some((s) => s[0] === prefs.sub[view.key])) prefs.sub[view.key] = view.subs[0][0];
    prefs.view = view.key;
    if (!view.deck) setLayout(view.subs ? prefs.sub[view.key] : view.layout);
    else if (!layout) setLayout('orb');
    renderTabs();
    renderDeck();
    savePrefs();
  }

  const tabsEl = $('#tabs'), subtabsEl = $('#subtabs');
  function renderTabs() {
    tabsEl.innerHTML = VIEWS.map((v) => `<button class="tab ${v === view ? 'on' : ''}" data-view="${v.key}" aria-pressed="${v === view}">${v.label}</button>`).join('');
    subtabsEl.innerHTML = view.subs ? view.subs.map(([k, l]) => `<button class="tab ${prefs.sub[view.key] === k ? 'on' : ''}" data-sub="${k}" aria-pressed="${prefs.sub[view.key] === k}">${l}</button>`).join('') : '';
    subtabsEl.hidden = !view.subs;
    const sub = view.subs && view.subs.find((s) => s[0] === prefs.sub[view.key]);
    $('#view-name').textContent = view.title + (sub ? ` · ${sub[1].toUpperCase()}` : '');
  }
  tabsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
  subtabsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-sub]'); if (b) setView(view.key, b.dataset.sub); });

  // ---------- skills and applications decks ----------
  const deck = $('#deck');
  const { PATHS, glyphFor } = window.NeuralGlyphs || { PATHS: {}, glyphFor: () => '' };
  const icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[glyphFor(n)] || ''}"/></svg>`;
  const tokens = (n) => Math.round((n.size || 0) / 4);
  const fmtTok = (t) => (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t));
  let deckFilter = 'all';
  function renderDeck() {
    document.body.classList.toggle('deck-open', !!view.deck);
    deck.hidden = !view.deck;
    if (!view.deck) { deck.innerHTML = ''; return; }
    deck.innerHTML = view.key === 'skills' ? skillsDeck() : appsDeck();
  }
  function skillsDeck() {
    const skills = nodes.filter((n) => n.type === 'skill');
    const active = skills.filter((n) => n.active !== false).length;
    const total = skills.reduce((s, n) => s + tokens(n), 0), max = Math.max(1, ...skills.map(tokens));
    const list = skills
      .filter((n) => deckFilter === 'all' || (deckFilter === 'active' ? n.active !== false : n.active === false))
      .sort((a, b) => tokens(b) - tokens(a) || a.label.localeCompare(b.label));
    const seg = [['all', 'All'], ['active', 'Active'], ['parked', 'Parked']]
      .map(([k, l]) => `<button class="tab ${deckFilter === k ? 'on' : ''}" data-filter="${k}" aria-pressed="${deckFilter === k}">${l}</button>`).join('');
    return `
      <div class="deck-head">
        <div><div class="eyebrow">SKILLS DECK · RANKED BY SIZE</div><h2>${skills.length} skills <small>${active} active · ~${fmtTok(total)} tokens if all loaded</small></h2></div>
        <div class="seg">${seg}</div>
      </div>
      <div class="cards">${list.map((n) => `
        <button class="card ${n.active === false ? 'parked' : ''}" data-id="${esc(n.id)}" style="--c:${n.color}">
          <span class="ico">${icon(n)}</span>
          <span class="name">/${esc(n.label)}</span>
          <span class="cmeta">${esc((n.sub || 'skill').toUpperCase())}${n.model ? ` · ${esc(String(n.model).toUpperCase())}` : ''} · <b>${n.active === false ? 'PARKED' : 'ACTIVE'}</b></span>
          ${n.desc ? `<span class="desc">${esc(truncate(n.desc, 96))}</span>` : ''}
          <span class="bar"><i style="width:${Math.max(2, (tokens(n) / max) * 100).toFixed(1)}%"></i></span>
          <span class="tok">~${fmtTok(tokens(n))} tokens</span>
        </button>`).join('') || '<div class="empty">Nothing here.</div>'}
      </div>`;
  }
  function appsDeck() {
    const groups = [['MCP SERVERS', 'mcp'], ['MODS & PLUGINS', 'mod'], ['AGENTS', 'agent']];
    return `
      <div class="deck-head"><div><div class="eyebrow">APPLICATIONS · WHAT CLAUDE CAN REACH</div><h2>${nodes.filter((n) => ['mcp', 'mod', 'agent'].includes(n.type)).length} connected tools</h2></div></div>
      ${groups.map(([title, type]) => {
        const list = nodes.filter((n) => n.type === type).sort((a, b) => (a.active === false) - (b.active === false) || a.label.localeCompare(b.label));
        if (!list.length) return '';
        return `
        <section class="app-group">
          <h3>${title} <span>${list.filter((n) => n.active !== false).length}/${list.length} ACTIVE</span></h3>
          <div class="apps">${list.map((n) => `
            <button class="app ${n.active === false ? 'parked' : ''}" data-id="${esc(n.id)}" style="--c:${n.color}">
              <span class="hexi">${icon(n)}</span>
              <span class="name">${esc(n.label)}</span>
              <span class="cmeta">${esc(String(n.sub || TYPE_NAMES[n.type]).toUpperCase())} · ${n.active === false ? 'PARKED' : 'ACTIVE'}</span>
            </button>`).join('')}
          </div>
        </section>`;
      }).join('')}`;
  }
  deck.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { deckFilter = f.dataset.filter; renderDeck(); return; }
    const b = e.target.closest('[data-id]');
    if (b) select(byId.get(b.dataset.id));
  });

  // ---------- pointer: orbit or pan, drag nodes, pinch, wheel ----------
  const mouse = { x: 0, y: 0, in: false };
  const pointer = { down: false, moved: false, x: 0, y: 0, sx: 0, sy: 0, node: null, pts: new Map(), pinch: 0 };
  let lastInteract = 0, autoOrbit = !reduceMotion;
  const tooltip = $('#tooltip');

  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    pointer.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteract = performance.now();
    if (pointer.pts.size === 2) {
      const [a, b] = [...pointer.pts.values()];
      pointer.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      releaseNode();
      pointer.moved = true;
      return;
    }
    // Nodes can only be dragged in the physics layouts; structured layouts hold their shape.
    const node = state.structured ? null : renderer.pick(e.clientX, e.clientY);
    Object.assign(pointer, { down: true, moved: false, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, node });
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointer.pts.has(e.pointerId)) pointer.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointer.pts.size === 2) {
      const [a, b] = [...pointer.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pointer.pinch) cam.zoom(pointer.pinch / d);
      pointer.pinch = d; fitting = false;
      return;
    }
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true;
    if (!pointer.down) { hover(e.clientX, e.clientY); return; }
    const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    pointer.x = e.clientX; pointer.y = e.clientY;
    if (!pointer.moved && Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) < 4) return;
    pointer.moved = true;
    lastInteract = performance.now();
    canvas.classList.add('dragging');
    setHover(null);
    const n = pointer.node;
    if (n && n !== core) {
      if (n.fx == null) { n.fx = n.x; n.fy = n.y; n.fz = n.z; }
      const d = cam.unprojectDelta(dx, dy, n.p.depth);
      n.fx += d.x; n.fy += d.y; n.fz += d.z;
      physics.alphaTarget = 0.2; physics.reheat(0.2);
    } else if (state.flat) { // 2D views pan instead of orbiting
      const d = cam.unprojectDelta(dx, dy, cam.dist);
      cam.goal.tx -= d.x; cam.goal.ty -= d.y; cam.goal.tz -= d.z;
      fitting = false;
    } else {
      cam.orbit(dx * 0.0055, dy * 0.0045);
    }
  });

  function releaseNode() {
    const n = pointer.node;
    if (n && n !== core && n.fx != null) { n.fx = n.fy = n.fz = null; }
    pointer.node = null;
    physics.alphaTarget = 0;
  }
  function endPointer(e) {
    pointer.pts.delete(e.pointerId);
    if (pointer.pts.size < 2) pointer.pinch = 0;
    if (pointer.pts.size === 1) { // one finger lifted mid-pinch: keep orbiting from the other one without a jump
      const [rest] = pointer.pts.values();
      pointer.x = rest.x; pointer.y = rest.y;
      return;
    }
    if (!pointer.down) return;
    pointer.down = false;
    canvas.classList.remove('dragging');
    releaseNode();
    if (!pointer.moved && e.type === 'pointerup') {
      const hit = renderer.pick(e.clientX, e.clientY);
      if (hit) select(hit); else closePanel();
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { mouse.in = false; if (!pointer.down) setHover(null); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    fitting = false;
    lastInteract = performance.now();
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    cam.zoom(Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0011));
  }, { passive: false });

  function hover(x, y) {
    const n = renderer.pick(x, y);
    setHover(n);
    canvas.classList.toggle('pointer', !!n);
  }
  function setHover(n) {
    if (state.hovered === n) return;
    state.hovered = n;
    if (!n || isPhone()) { tooltip.hidden = true; state.tooltipAt = null; return; }
    tooltip.style.setProperty('--c', n.color);
    tooltip.innerHTML = `<div class="t">${esc(TYPE_NAMES[n.type]).toUpperCase()}${n.sub && n.sub !== 'memory' ? ' · ' + esc(n.sub).toUpperCase() : ''}</div><strong>${esc(n.label)}</strong>${n.desc ? `<span>${esc(truncate(n.desc, 110))}</span>` : ''}`;
    tooltip.hidden = false;
  }
  function placeTooltip() {
    const n = state.hovered;
    if (!n || tooltip.hidden) return;
    const R = Math.max(10, n.r * n.p.s * 1.8);
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    let x = n.p.x + R + 44, y = n.p.y - R - 30 - h / 2;
    const flip = x + w > window.innerWidth - 16;
    if (flip) x = n.p.x - R - 44 - w;
    y = Math.max(16, Math.min(window.innerHeight - h - 16, y));
    tooltip.style.transform = `translate(${x}px, ${y}px)`;
    tooltip.style.left = '0px'; tooltip.style.top = '0px';
    state.tooltipAt = { x: flip ? x + w : x, y: y + 14 };
  }

  // ---------- data sheet ----------
  const panel = $('#panel'), panelHead = $('#panel-head'), panelBody = $('#panel-body');
  $('#close').addEventListener('click', closePanel);
  // Links between brain files (e.g. a MEMORY.md index entry) jump to that node instead of opening a dead tab.
  panelBody.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = decodeURIComponent(a.getAttribute('href')).split('#')[0];
    if (!/.md$/i.test(href)) return;
    const name = href.split('/').pop().toLowerCase();
    const dir = (state.selected?.file || '').replace(/[^/]*$/, '');
    const target = nodes.find((n) => n.file && n.file.toLowerCase() === (dir + name).toLowerCase())
      || nodes.find((n) => n.file && n.file.toLowerCase().endsWith('/' + name));
    if (target) { e.preventDefault(); select(target); }
  });

  function select(n) {
    if (!n) return;
    if (!n.visibleNow) { for (const f of FILTERS) if (f.dormant ? n.active === false : f.types.includes(n.channel)) hidden.delete(f.key); refreshVisibility(); renderFilters(); }
    state.selected = n;
    setHover(null);
    fitting = false;
    document.body.classList.add('panel-open');
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    panel.style.setProperty('--c', n.color);
    cam.goal.dist = n.type === 'core' ? 520 : n.type === 'hub' || n.type === 'project' ? 420 : 320;
    lastInteract = performance.now();

    const linked = [...neighbors.get(n.id)].map((id) => byId.get(id))
      .sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label));
    const meta = [
      ['TYPE', TYPE_NAMES[n.type], true],
      n.active != null ? ['STATUS', n.active ? 'ACTIVE' : 'PARKED · switched off in Toolbox', n.active ? 'ok' : 'warn'] : null,
      n.sub && n.sub !== 'memory' ? ['CLASS', n.sub] : null,
      n.project ? ['PROJECT', n.project] : null,
      n.version ? ['VERSION', 'v' + n.version] : null,
      n.model ? ['MODEL', n.model] : null,
      n.file ? ['SOURCE', n.file] : null,
      n.mtime ? ['MODIFIED', `${stamp(n.mtime)} · ${ago(n.mtime)}`] : null,
      n.size ? ['SIZE', `${bytes(n.size)} · ~${fmtTok(tokens(n))} tokens`] : null,
      ['SYNAPSES', String(n.degree)],
    ].filter(Boolean);

    panelHead.innerHTML = `
      <div class="sheet-id">NODE ${hash(n.id)} <span>// DATA SHEET</span></div>
      <h2 id="sheet-title"></h2>
      ${n.desc ? `<p class="desc">${esc(n.desc)}</p>` : ''}`;
    scramble($('#sheet-title'), n.label);

    const body = n.body && window.marked && window.DOMPurify
      ? DOMPurify.sanitize(marked.parse(n.body), { FORBID_TAGS: ['style', 'form', 'input', 'button', 'img', 'svg', 'iframe'] })
      : `<p>${n.body ? esc(n.body) : 'A hub that routes every node below it into the core.'}</p>`;
    const payload = !n.body && n.size && S.public ? '<p class="withheld">Contents withheld in this public build. Titles, links and descriptions only.</p>' : body;
    panelBody.innerHTML = `
      <dl class="meta">${meta.map(([k, v, hl]) => `<dt>${k}</dt><dd class="${hl === true ? 'hl' : hl || ''}">${esc(v)}</dd>`).join('')}</dl>
      <div class="sec">SYNAPSES · ${linked.length}</div>
      <div class="links">${linked.map((m) => `<button data-id="${esc(m.id)}" style="--c:${m.color}"><span class="lbl">${esc(m.label)}</span><span class="ty">${esc(TYPE_NAMES[m.type])}</span></button>`).join('')}</div>
      <div class="sec">PAYLOAD</div>
      <div class="md">${payload}</div>`;
    panelBody.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => select(byId.get(b.dataset.id))));
    panelBody.scrollTop = 0;
    frameView();
  }

  function closePanel() {
    if (!state.selected) return;
    state.selected = null;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('panel-open');
    frameView();
    recenter();
  }

  // Decrypt-style reveal: random glyphs settle into the real title left to right.
  function scramble(el, text) {
    const glyphs = '▓▒░<>/\\|=+*#%01ABCDEF';
    if (reduceMotion) { el.textContent = text; return; }
    const start = performance.now(), dur = 520;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const settled = Math.floor(text.length * p);
      el.textContent = text.slice(0, settled) + [...text.slice(settled)].map((c) => (c === ' ' ? ' ' : glyphs[(Math.random() * glyphs.length) | 0])).join('');
      if (p < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---------- telemetry ----------
  const S = { memories: 0, notes: 0, skills: 0, mods: 0, mcp: 0, agents: 0, connections: links.length, builtAt: Date.now(), files: 0, bytes: 0, buildMs: 0, ...BRAIN.stats };
  // Tool counts are { active, total }; older data.js files stored a plain number.
  const pair = (v) => (v && typeof v === 'object' ? v : { active: Number(v) || 0, total: Number(v) || 0 });
  const STAT_ITEMS = [
    ['MEMORIES', pair(S.memories), COLORS.memory], ['NOTES', pair(S.notes), COLORS.note], ['SKILLS', pair(S.skills), COLORS.skill],
    ['MODS', pair(S.mods), COLORS.mod], ['MCP', pair(S.mcp), COLORS.mcp], ['AGENTS', pair(S.agents), COLORS.agent],
    ['SYNAPSES', pair(S.connections), COLORS.hub],
  ];
  const statMax = Math.max(...STAT_ITEMS.slice(0, -1).map((s) => s[1].total), 1);
  $('#stats').innerHTML = STAT_ITEMS.map(([k, v, c], i) => {
    const split = v.active !== v.total;
    const scale = i === STAT_ITEMS.length - 1 ? 100 / Math.max(1, v.total) : 100 / statMax;
    return `
    <div class="stat" style="--c:${c}">
      <span class="k">${k}</span>
      <span class="v"><span data-to="${esc(v.active)}">00</span>${split ? `<small>/<span data-to="${esc(v.total)}">00</span></small>` : ''}</span>
      <span class="bar"><i class="all" data-w="${v.total * scale}"></i><i data-w="${v.active * scale}"></i></span>
    </div>`;
  }).join('');
  $('#node-count').textContent = `${nodes.length} NODES`;
  $('#search').placeholder = `Search ${nodes.length} nodes…`;
  function countUp() {
    const els = [...document.querySelectorAll('#stats [data-to]')], t0 = performance.now();
    document.querySelectorAll('#stats .bar i').forEach((b) => { b.style.width = `${b.dataset.w}%`; });
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 1500), e = 1 - Math.pow(1 - p, 3);
      for (const el of els) el.textContent = String(Math.round(e * Number(el.dataset.to))).padStart(2, '0');
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- channels ----------
  const filtersEl = $('#filters');
  function renderFilters() {
    filtersEl.innerHTML = FILTERS.map((f) => {
      const count = nodes.filter((x) => (f.dormant ? x.active === false : f.types.includes(x.type))).length;
      if (!count) return '';
      return `<button class="channel ${f.dormant ? 'dormant' : ''} ${hidden.has(f.key) ? '' : 'on'}" data-key="${f.key}" style="--c:${f.dormant ? '#a8988c' : COLORS[f.types[0]]}" aria-pressed="${!hidden.has(f.key)}"><span class="dot"></span>${f.label}<span class="n">${String(count).padStart(2, '0')}</span></button>`;
    }).join('');
  }
  filtersEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    hidden.has(b.dataset.key) ? hidden.delete(b.dataset.key) : hidden.add(b.dataset.key);
    refreshVisibility();
    if (state.selected && !state.selected.visibleNow) closePanel();
    physics.reheat(0.15);
    renderFilters();
  });
  renderFilters();

  // ---------- search ----------
  const input = $('#search'), results = $('#results');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { state.searchHits = null; results.hidden = true; return; }
    const wordStart = new RegExp(`(^|[^\\w])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    const hits = nodes
      .map((n) => ({ n, score: n.label.toLowerCase().includes(q) ? 2 : wordStart.test(`${n.desc || ''} ${n.body || ''}`) ? 1 : 0 }))
      .filter((h) => h.score)
      .sort((a, b) => b.score - a.score || a.n.label.localeCompare(b.n.label));
    state.searchHits = new Set(hits.map((h) => h.n.id));
    results.hidden = false;
    results.innerHTML = hits.length
      ? hits.slice(0, 10).map(({ n }) => `<button data-id="${esc(n.id)}" style="--c:${n.color}"><span class="dot"></span>${esc(n.label)}<span class="type">${TYPE_NAMES[n.type]}</span></button>`).join('')
      : '<div class="empty">No matches yet.</div>';
  });
  results.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus so blur doesn't close it first
  results.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    select(byId.get(b.dataset.id));
    results.hidden = true;
  });
  input.addEventListener('blur', () => { results.hidden = true; });
  input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); });

  // ---------- activity (files edited per day, last 30 days) ----------
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today0); d.setDate(d.getDate() - (29 - i));
    return { start: d.getTime(), ids: [] };
  });
  for (const n of nodes) {
    if (!n.mtime || n.type === 'section') continue;
    for (let i = 29; i >= 0; i--) if (n.mtime >= days[i].start) { days[i].ids.push(n.id); break; }
  }
  const maxDay = Math.max(1, ...days.map((d) => d.ids.length));
  let activeDay = null;
  function renderActivity() {
    const bw = 300 / 30;
    $('#activity').innerHTML = `
      <svg viewBox="0 0 300 64" preserveAspectRatio="none" role="img" aria-label="Files edited per day">
        <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#ff3b30" stop-opacity=".25"/></linearGradient></defs>
        <line x1="0" y1="63.5" x2="300" y2="63.5" stroke="rgba(255,106,43,.25)"/>
        ${days.map((d, i) => {
          const h = d.ids.length ? 6 + (d.ids.length / maxDay) * 54 : 1.5;
          const on = activeDay === i;
          return `<rect class="b" data-i="${i}" x="${i * bw + 1.5}" y="${64 - h}" width="${bw - 3}" height="${h}" fill="${d.ids.length ? (on ? '#ffffff' : 'url(#ag)') : 'rgba(255,106,43,.18)'}"><title>${new Date(d.start).toLocaleDateString()} · ${d.ids.length} edits</title></rect>`;
        }).join('')}
      </svg>
      <div class="axis"><span>-30D</span><span>-15D</span><span>TODAY</span></div>`;
    $('#activity-note').textContent = activeDay == null ? `${days.reduce((s, d) => s + d.ids.length, 0)} EDITS` : `${days[activeDay].ids.length} ON ${stamp(days[activeDay].start).slice(0, 5)}`;
  }
  $('#activity').addEventListener('click', (e) => {
    const r = e.target.closest('rect.b');
    if (!r) return;
    const i = Number(r.dataset.i);
    activeDay = activeDay === i || !days[i].ids.length ? null : i;
    state.highlight = activeDay == null ? null : new Set(days[i].ids);
    renderActivity();
  });
  renderActivity();

  // ---------- event log ----------
  const recent = nodes.filter((n) => n.mtime && !['core', 'section', 'hub'].includes(n.type)).sort((a, b) => b.mtime - a.mtime).slice(0, 8);
  $('#log').innerHTML = recent.map((n, i) => `
    <button class="log-row" data-id="${esc(n.id)}" style="--c:${n.color};animation-delay:${i * 60}ms">
      <span>${stamp(n.mtime)}</span><span class="tag">+${esc(TYPE_NAMES[n.type].split(' ')[0].toUpperCase())}</span><span class="msg">${esc(n.label)}${n.desc ? `<span class="d"> — ${esc(n.desc)}</span>` : ''}</span>
    </button>`).join('');
  $('#log').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) select(byId.get(b.dataset.id)); });

  // ---------- runtime readout ----------
  const runtimeEl = $('#runtime');
  function renderRuntime(fps, rendered) {
    const deg = (r) => ((((r * 180) / Math.PI) % 360) + 360) % 360;
    const engine = state.structured ? `LAYOUT · ${String(layout).toUpperCase()}` : physics.active ? 'SIMULATING' : 'AT REST';
    runtimeEl.innerHTML = [
      ['FPS', fps, fps >= 50 ? 'good' : ''],
      ['RENDER', `${rendered}/${nodes.length} · ${DUST_COUNT} dust`],
      ['ORBIT', `${deg(cam.yaw).toFixed(0).padStart(3, '0')}° / ${(-(cam.pitch * 180) / Math.PI).toFixed(0)}°`],
      ['RANGE', `${Math.round(cam.dist)}u`],
      ['ENGINE', engine, !state.structured && !physics.active ? 'good' : ''],
      ['BUILD', `${S.buildMs ?? '–'}ms · ${S.files ?? '–'} files`],
    ].map(([k, v, c]) => `<dt>${k}</dt><dd class="${c || ''}">${esc(v)}</dd>`).join('');
  }
  $('#synced').textContent = isDemo ? 'DEMO DATA' : `SYNCED ${ago(S.builtAt).toUpperCase()}${S.public ? ' · PUBLIC BUILD' : ''}`;
  const clock = $('#clock');
  const tickClock = () => { clock.textContent = new Date().toLocaleTimeString([], { hour12: false }); };
  tickClock(); setInterval(tickClock, 1000);

  // ---------- buttons, drawer, modal, keys ----------
  const orbitBtn = $('#orbit'), speed = $('#speed');
  const syncOrbitBtn = () => { orbitBtn.classList.toggle('on', autoOrbit); orbitBtn.setAttribute('aria-pressed', String(autoOrbit)); };
  orbitBtn.addEventListener('click', () => { autoOrbit = !autoOrbit; lastInteract = 0; syncOrbitBtn(); });
  syncOrbitBtn();
  speed.addEventListener('input', () => { state.motion = Number(speed.value) / 100; });
  $('#recenter').addEventListener('click', () => {
    if (state.selected) closePanel(); else recenter();
    cam.goal.pitch = state.flat ? 0 : -0.46;
    state.highlight = null; activeDay = null; renderActivity();
    input.value = ''; state.searchHits = null; results.hidden = true;
  });
  document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    lastInteract = performance.now();
    if (b.dataset.zoom === 'fit') { if (state.selected) closePanel(); else recenter(); return; }
    fitting = false;
    cam.zoom(b.dataset.zoom === 'in' ? 0.8 : 1.25);
  }));

  const drawer = $('#drawer'), menuBtn = $('#menu');
  const drawerOpen = () => drawer.classList.contains('open');
  function openDrawer(open) {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.classList.toggle('on', open);
  }
  menuBtn.addEventListener('click', () => openDrawer(!drawerOpen()));
  $('#drawer-close').addEventListener('click', () => openDrawer(false));

  const modal = $('#modal');
  const openModal = (open) => { modal.classList.toggle('open', open); modal.setAttribute('aria-hidden', String(!open)); };
  $('#sys').addEventListener('click', () => openModal(true));
  $('#modal-close').addEventListener('click', () => openModal(false));
  modal.addEventListener('click', (e) => { if (e.target === modal) openModal(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modal.classList.contains('open')) openModal(false);
    else if (state.selected) closePanel();
    else if (drawerOpen()) openDrawer(false);
  });

  const STAGES = [
    ['01', 'SOURCE', '~/.claude', `${S.files} markdown + JSON files that Claude loads before it works.`],
    ['02', 'SCANNER', 'scripts/build.mjs', 'Frontmatter parser, link resolver, mention graph, active and parked tools.'],
    ['03', 'REDACTION', 'redact.mjs', 'Ordered scrub rules. The build fails if anything personal leaks.'],
    ['04', 'LAYOUT', 'layouts.js · engine.js', 'Orb, rings, hex, circle and timeline layouts, plus a 3D force simulation.'],
    ['05', 'RENDERER', 'renderer.js', 'Morphing dust, glow sprites, hex badges and HUD overlays on Canvas 2D.'],
  ];
  $('#pipeline').innerHTML = STAGES.map(([n, h, c, p]) => `<div class="stage"><div class="n">STAGE ${n}</div><h3>${h}</h3><code>${c}</code><p>${p}</p></div>`).join('');
  $('#specs').innerHTML = [
    [nodes.length, 'NODES'], [DUST_COUNT, 'DUST PARTICLES'], [Layouts.names.length, 'LAYOUTS'], ['0', 'GRAPH LIBRARIES'],
  ].map(([b, s]) => `<div class="spec"><b>${b}</b><span>${s}</span></div>`).join('');

  // ---------- boot sequence ----------
  const boot = $('#boot'), bootLog = $('#boot-log'), bootFill = $('#boot-fill'), bootNum = $('#boot-num'), bootStage = $('#boot-stage');
  const BOOT = [
    ['MOUNT', '~/.claude', 'OK'],
    ['SCAN', `${S.files} files · ${bytes(S.bytes || 0)}`, 'OK'],
    ['PARSE', `${pair(S.memories).total} memories · ${pair(S.notes).total} notes · ${pair(S.skills).total} skills`, 'OK'],
    ['TOOLS', `${pair(S.mods).total} mods · ${pair(S.mcp).total} MCP · ${nodes.filter((n) => n.active === false).length} parked`, 'OK'],
    ['LINK', `${S.connections} synapses resolved`, 'OK'],
    ['GUARD', 'redaction filter', 'ARMED'],
    ['ENGINE', `${Layouts.names.length} layouts · ${DUST_COUNT} particles`, 'ONLINE'],
  ];
  let booted = false, bootTimer = null;
  function finishBoot() {
    if (booted) return;
    booted = true;
    clearTimeout(bootTimer);
    boot.classList.add('done');
    document.body.classList.add('online');
    renderer.burst(performance.now() / 1000);
    if (!state.structured) physics.reheat(1);
    countUp();
    lastInteract = performance.now() - 2000;
  }
  function runBoot() {
    if (reduceMotion) { finishBoot(); return; }
    let i = 0;
    const lines = [];
    const next = () => {
      if (i >= BOOT.length) {
        bootStage.textContent = 'LINK ESTABLISHED';
        bootTimer = setTimeout(finishBoot, 420);
        return;
      }
      const [k, v, s] = BOOT[i++];
      const pad = '.'.repeat(Math.max(2, 50 - v.length));
      lines.push(`<span class="k">${k.padEnd(7)}</span>${esc(v)} <span class="pad">${pad}</span> <span class="${s === 'ARMED' ? 'warn' : 'ok'}">${s}</span>`);
      bootLog.innerHTML = lines.join('\n') + (i < BOOT.length ? '\n<span class="cursor"></span>' : '');
      const pct = Math.round((i / BOOT.length) * 100);
      bootFill.style.width = `${pct}%`; bootNum.textContent = `${pct}%`; bootStage.textContent = k;
      bootTimer = setTimeout(next, 230 + Math.random() * 120);
    };
    bootTimer = setTimeout(next, 250);
  }
  boot.addEventListener('click', finishBoot);

  // ---------- main loop ----------
  frameView(true);
  setView(prefs.view);
  runBoot();
  let last = performance.now(), fpsFrames = 0, fpsT = last, rendered = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (booted) {
      if (state.structured) { // ease every node toward its slot in the current layout
        const e = reduceMotion ? 1 : 1 - Math.exp(-dt * 3.2);
        for (const n of nodes) { n.x += (n.tx - n.x) * e; n.y += (n.ty - n.y) * e; n.z += (n.tz - n.z) * e; }
      } else physics.tick();
    }
    const target = extent ? Math.max(extent.w, extent.h) : physics.bounds();
    state.radius += (target - state.radius) * 0.08;

    if (booted && autoOrbit && !state.flat && !pointer.down && now - lastInteract > 3500) cam.goal.yaw += dt * 0.075 * state.motion;
    if (state.selected && !(state.flat && pointer.down && pointer.moved)) { cam.goal.tx = state.selected.x; cam.goal.ty = state.selected.y; cam.goal.tz = state.selected.z; }
    else if (fitting && booted) cam.goal.dist = fitDist();
    if (!booted) cam.goal.dist = 2600; // hold far away until the boot screen lifts, then dive in

    cam.update(dt);
    if (mouse.in && !pointer.down && !isPhone() && fpsFrames % 6 === 0) hover(mouse.x, mouse.y);
    rendered = renderer.draw(now / 1000);
    placeTooltip();

    fpsFrames++;
    if (now - fpsT > 500) {
      renderRuntime(Math.round((fpsFrames * 1000) / (now - fpsT)), rendered);
      fpsFrames = 0; fpsT = now;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  fitTimer = setTimeout(() => { fitting = false; }, 9000);
  window.addEventListener('resize', () => { renderer.resize(); frameView(); if (!state.selected) recenter(); });

  // ---------- utils ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function bytes(n) { return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`; }
  function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return '0x' + (h >>> 0).toString(16).toUpperCase().padStart(8, '0'); }
  function stamp(ms) {
    const d = new Date(ms), p = (v) => String(v).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function ago(ms) {
    const m = (Date.now() - ms) / 60000;
    if (m < 1) return 'just now';
    if (m < 60) return `${Math.floor(m)}m ago`;
    if (m < 1440) return `${Math.floor(m / 60)}h ago`;
    if (m < 43200) return `${Math.floor(m / 1440)}d ago`;
    return `${Math.floor(m / 43200)}mo ago`;
  }
}

// Use the generated data.js when it exists; otherwise fall back to the bundled demo brain.
if (window.BRAIN) startSecondBrain(false);
else {
  const s = document.createElement('script');
  s.src = 'demo/data.js';
  s.onload = () => startSecondBrain(true);
  s.onerror = () => startSecondBrain(false);
  document.head.appendChild(s);
}
