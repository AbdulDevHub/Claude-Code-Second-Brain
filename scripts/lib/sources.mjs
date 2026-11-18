// Scanners: each one reads one part of ~/.claude and adds it to the graph.
// Active and parked (switched-off) tools are both included; `active: false` marks the parked ones.
// The on/off sources match the Toolbox mod: skills-disabled/, CLAUDE_CODE_PLUGIN_DIRS,
// settings.enabledPlugins, ~/.claude.json mcpServers and toolbox/parked-mcp.json.
import { join, basename, dirname } from 'node:path';
import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { read, readJson, objectOr, ls, isDir, mtime, titleCase, firstHeading, frontmatter, escapeRegExp, modelFamily, MODEL_CATALOG, catalogModel } from './text.mjs';
import { MENTION_SOURCES } from './graph.mjs';

const NOT_MODS = new Set(['cache', 'data', 'marketplaces', 'store', 'synced']);
const HUBS = { memory: 'Memory', notes: 'Notes', skill: 'Skills', mod: 'Mods', agent: 'Agents', model: 'Models', mcp: 'MCP Servers', hook: 'Hooks', reference: 'Reference' };

/** `~/.claude/...` display path for a file under the Claude folder. */
const tilde = (ctx, path) => `~/.claude/${path.slice(ctx.claude.length + 1).replace(/\\/g, '/')}`;
const normalizePath = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function scanAll(g, ctx) {
  scanCore(g, ctx);
  for (const [key, label] of Object.entries(HUBS)) {
    g.addNode(`hub:${key}`, { label, type: 'hub', desc: `Every ${label.toLowerCase().replace(/s$/, '')} in the brain` });
    g.link('core', `hub:${key}`);
  }
  scanMemory(g, ctx);
  scanNotes(g, ctx);
  scanSkills(g, ctx);
  scanMods(g, ctx);
  scanAgents(g, ctx);
  scanMcp(g, ctx);
  scanHooks(g, ctx);
  scanReference(g, ctx);
  scanModels(g, ctx);
  pruneEmptyHubs(g);
  g.resolveCrossLinks();
}

// ---------- CLAUDE.md: the core and one node per "## " section ----------
function scanCore(g, ctx) {
  const path = join(ctx.claude, 'CLAUDE.md');
  const text = existsSync(path) ? read(path) : '';
  const when = text ? mtime(path) : 0;
  g.addNode('core', { label: 'Claude', type: 'core', file: '~/.claude/CLAUDE.md', body: text, mtime: when, desc: 'Global instructions loaded into every session' });
  for (const part of text.split(/(?:^|\n)(?=## )/).filter((p) => p.startsWith('## '))) {
    const heading = part.match(/^## (.+)/)[1].trim();
    const id = g.addNode(`section:${heading}`, {
      label: heading.replace(/\s*\(.*\)$/, ''), type: 'section', file: '~/.claude/CLAUDE.md', body: part, mtime: when,
      desc: 'Section of the global instructions',
    });
    g.link('core', id);
    g.register(id, { text: part });
  }
}

// ---------- projects/*/memory: one hub per project, one node per memory file ----------
const CONTAINER_DIRS = /^((?:Coding-Projects|Code|Projects|Documents|Downloads|OneDrive|Desktop|repos|src|dev)-)+/i;
/** "OneDrive-Documents-CSC384-A2" -> "CSC384 A2": drop the folders that only hold projects. */
export function projectLabel(key) {
  if (/scratch/i.test(key)) return 'Scratch Session';
  return key.replace(CONTAINER_DIRS, '').replace(/-/g, ' ') || 'Home';
}

function scanMemory(g, ctx) {
  const root = join(ctx.claude, 'projects');
  for (const dir of ls(root)) {
    const memDir = join(root, dir, 'memory');
    const files = ls(memDir).filter((f) => f.endsWith('.md'));
    if (!files.length) continue;
    const key = dir.replace(new RegExp(`^[a-z]--Users-${escapeRegExp(ctx.userName)}(-|$)`, 'i'), '');
    const label = projectLabel(key);
    const indexPath = join(memDir, 'MEMORY.md');
    const indexText = existsSync(indexPath) ? read(indexPath) : '';
    const titles = new Map([...indexText.matchAll(/\[([^\]]+)\]\(([^)]+\.md)\)/g)].map((m) => [m[2], m[1]]));
    const projId = g.addNode(`project:${key}`, {
      label, type: 'project', file: `~/.claude/projects/${key}/memory/MEMORY.md`, body: indexText,
      mtime: indexText ? mtime(indexPath) : 0, desc: `Memory index for ${label}`,
    });
    g.link('hub:memory', projId);
    if (indexText) g.register(projId, { path: indexPath, text: indexText, dir: memDir });

    for (const f of files.filter((f) => f !== 'MEMORY.md')) {
      const path = join(memDir, f);
      const { meta, body } = frontmatter(read(path));
      const slug = meta.name || f.replace(/\.md$/, '');
      const id = g.addNode(`memory:${key}/${slug}`, {
        label: titles.get(f) || titleCase(slug), type: 'memory', sub: meta.metadata?.type || meta.type || undefined,
        project: label, file: `~/.claude/projects/${key}/memory/${f}`, body, mtime: mtime(path), desc: meta.description,
      });
      g.link(projId, id);
      g.register(id, { path, slugs: [slug, f.replace(/\.md$/, '')], text: body, dir: memDir });
    }
  }
}

// ---------- notes/: cross-project notes hanging off INDEX.md ----------
function scanNotes(g, ctx) {
  const dir = join(ctx.claude, 'notes');
  const files = ls(dir).filter((f) => f.endsWith('.md'));
  const hasIndex = files.includes('INDEX.md');
  for (const f of files) {
    const path = join(dir, f);
    const text = read(path);
    const isIndex = f === 'INDEX.md';
    const id = g.addNode(isIndex ? 'note:index' : `note:${f.replace(/\.md$/, '')}`, {
      label: isIndex ? 'Notes Index' : firstHeading(text) || titleCase(f.replace(/\.md$/, '')), type: 'note',
      file: `~/.claude/notes/${f}`, body: text, mtime: mtime(path), desc: isIndex ? 'Index of cross-project notes' : undefined,
    });
    g.register(id, { path, slugs: [f.replace(/\.md$/, '')], text, dir });
  }
  for (const n of g.nodes.values()) if (n.type === 'note' && n.id !== 'note:index') g.link(hasIndex ? 'note:index' : 'hub:notes', n.id);
  g.link('hub:notes', 'note:index');
}

// ---------- skills: local (on), skills-disabled (parked) and claude.ai-synced ----------
function addGroup(g, hub, key, label, desc) {
  const id = g.addNode(`group:${key}`, { label, type: 'group', desc });
  g.link(`hub:${hub}`, id);
  return id;
}

function addSkill(g, ctx, group, { name, path, active, sub, desc }) {
  const exists = Boolean(path) && existsSync(path);
  const { meta, body } = frontmatter(exists ? read(path) : '');
  const id = g.addNode(`skill:${meta.name || name}`, {
    label: meta.name || name, type: 'skill', sub, active, model: meta.model,
    file: exists ? tilde(ctx, path) : undefined, body: body || desc || '', mtime: exists ? mtime(path) : undefined,
    desc: meta.description || desc,
  });
  g.link(group, id);
  g.register(id, { slugs: [name] });
}

function scanSkills(g, ctx) {
  const sets = [
    { dir: join(ctx.claude, 'skills'), key: 'skills-local', label: 'Local skills', active: true, desc: 'Skills loaded into every session' },
    { dir: join(ctx.claude, 'skills-disabled'), key: 'skills-parked', label: 'Parked skills', active: false, desc: 'Installed but switched off in Toolbox' },
  ];
  for (const set of sets) {
    const names = ls(set.dir).filter((d) => d !== 'synced' && !d.startsWith('.') && existsSync(join(set.dir, d, 'SKILL.md')));
    if (!names.length) continue;
    const group = addGroup(g, 'skill', set.key, set.label, set.desc);
    for (const d of names) {
      addSkill(g, ctx, group, { name: d, path: join(set.dir, d, 'SKILL.md'), active: set.active, sub: set.active ? 'local' : 'parked' });
    }
  }

  // claude.ai skills synced down by the desktop app: skills/synced/<bucket>/manifest.json
  const syncedRoot = join(ctx.claude, 'skills', 'synced');
  const synced = ls(syncedRoot).filter((b) => !b.startsWith('.')).flatMap((bucket) => {
    const skills = objectOr(readJson(join(syncedRoot, bucket, 'manifest.json'))).skills;
    return (Array.isArray(skills) ? skills : []).filter((s) => typeof s?.name === 'string' && s.name).map((s) => ({ ...s, bucket }));
  });
  if (synced.length) {
    const group = addGroup(g, 'skill', 'skills-cloud', 'claude.ai skills', 'Synced from the claude.ai account');
    for (const s of synced) {
      addSkill(g, ctx, group, { name: s.name, path: join(syncedRoot, s.bucket, s.name, 'SKILL.md'), active: true, sub: 'claude.ai', desc: s.description });
    }
  }
}

/** Splits a CLAUDE_CODE_PLUGIN_DIRS value: ';' on Windows (or when a drive letter appears), ':' otherwise. */
export function splitPluginDirs(raw) {
  if (typeof raw !== 'string') return [];
  const sep = raw.includes(';') || /(^|;)[A-Za-z]:[\\/]/.test(raw) ? ';' : ':';
  return raw.split(sep).map((p) => p.trim()).filter(Boolean);
}

// ---------- mods: local plugin folders + marketplace plugins ----------
function scanMods(g, ctx) {
  const pluginsDir = join(ctx.claude, 'plugins');
  const raw = objectOr(ctx.settings.env).CLAUDE_CODE_PLUGIN_DIRS;
  const onDirs = splitPluginDirs(raw).map(normalizePath);
  // A full-path match (what Claude Code uses), or a `/plugins/<name>` suffix so a copied or relocated
  // home folder (like the demo) still resolves. Trade-off: two plugin folders with the same name both count as on.
  const isOn = (dir, d) => onDirs.some((p) => p === normalizePath(dir) || p.endsWith(`/plugins/${d.toLowerCase()}`));

  ctx.modRoots = []; // { id, root, label, slug, active } for scanHooks
  const local = ls(pluginsDir).filter((d) => !NOT_MODS.has(d) && existsSync(join(pluginsDir, d, '.claude-plugin', 'plugin.json')));
  if (local.length) {
    const group = addGroup(g, 'mod', 'mods-local', 'Local mods', 'Hand-built Claude Code mods');
    for (const d of local) {
      const dir = join(pluginsDir, d);
      const manifestPath = join(dir, '.claude-plugin', 'plugin.json');
      const manifest = readJson(manifestPath, null);
      if (!manifest) { console.warn(`  skipped mod ${d}: unreadable plugin.json`); continue; }
      const name = manifest.name || d;
      const readme = join(dir, 'README.md');
      const id = g.addNode(`mod:${name}`, {
        label: titleCase(name), type: 'mod', sub: 'local', version: manifest.version,
        active: name === 'toolbox' || isOn(dir, d), // Toolbox is the switch itself, so it is always on
        file: `~/.claude/plugins/${d}`, desc: manifest.description,
        body: existsSync(readme) ? read(readme) : `# ${titleCase(name)}\n\n${manifest.description || ''}`,
        mtime: mtime(existsSync(readme) ? readme : manifestPath),
      });
      g.link(group, id);
      g.register(id, { path: manifestPath, slugs: [name] });
      ctx.modRoots.push({ id, root: dir, label: titleCase(name), slug: name, active: g.nodes.get(id).active });
    }
  }

  const enabled = Object.entries(objectOr(ctx.settings.enabledPlugins));
  if (enabled.length) {
    const installed = objectOr(objectOr(readJson(join(pluginsDir, 'installed_plugins.json'))).plugins);
    const group = addGroup(g, 'mod', 'mods-plugins', 'Marketplace plugins', 'Installed from plugin marketplaces');
    for (const [key, isOn] of enabled) {
      const [name, marketplace = 'a marketplace'] = key.split('@');
      const root = installed[key]?.[0]?.installPath;
      const manifest = root ? readJson(join(root, '.claude-plugin', 'plugin.json')) : {};
      const readme = root ? join(root, 'README.md') : '';
      const id = g.addNode(`mod:${name}`, {
        label: titleCase(name), type: 'mod', sub: 'plugin', active: isOn === true, version: manifest.version || installed[key]?.[0]?.version,
        desc: manifest.description || `Plugin from ${marketplace}`,
        body: readme && existsSync(readme) ? read(readme) : `# ${titleCase(name)}\n\nFrom the \`${marketplace}\` marketplace.\n\n${manifest.description || ''}`,
        mtime: Date.parse(installed[key]?.[0]?.lastUpdated || '') || undefined,
      });
      g.link(group, id);
      g.register(id, { slugs: [name] });
      if (root && isDir(root)) ctx.modRoots.push({ id, root, label: titleCase(name), slug: name, active: isOn === true });
    }
  }
}

// ---------- agents/**/*.md: sub-agents ----------
// Claude Code loads agents from every subfolder, and any .md there that starts with `---` frontmatter
// counts as one. Kit files (READMEs, templates) without leading frontmatter are skipped, like Claude Code does.
function agentFiles(dir, rel = '', depth = 0) {
  const out = [];
  for (const f of ls(dir)) {
    if (f.startsWith('.') || f === 'node_modules') continue;
    const path = join(dir, f);
    if (isDir(path)) { if (depth < 6) out.push(...agentFiles(path, `${rel}${f}/`, depth + 1)); }
    else if (f.endsWith('.md')) out.push({ path, rel: rel + f, folder: rel.replace(/\/$/, '') });
  }
  return out;
}
function scanAgents(g, ctx) {
  for (const { path, rel, folder } of agentFiles(join(ctx.claude, 'agents'))) {
    const text = read(path).replace(/^﻿/, '');
    if (!text.startsWith('---')) continue;
    const { meta, body } = frontmatter(text);
    const name = meta.name || rel.split('/').pop().replace(/\.md$/, '');
    const id = g.addNode(`agent:${name}`, {
      label: name, type: 'agent', sub: folder || undefined, file: `~/.claude/agents/${rel}`, body, mtime: mtime(path), desc: meta.description, model: meta.model, active: true,
    });
    g.link('hub:agent', id);
    g.register(id, { path, slugs: [name] });
  }
}

// ---------- MCP servers: live (~/.claude.json) and parked (toolbox/parked-mcp.json) ----------
/** A short, secret-free summary of where a server lives. Headers, env and tokens are never read. */
export function mcpEndpoint(config) {
  if (config.url) {
    try { return { transport: config.type || 'http', endpoint: new URL(config.url).host }; } catch { return { transport: config.type || 'http', endpoint: 'remote' }; }
  }
  const args = (config.args || []).map(String);
  const runner = basename(String(config.command || '')).replace(/\.(cmd|exe)$/i, '').toLowerCase();
  const isPackage = (a) => /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(a);
  const fromModules = args.map((a) => a.replace(/\\/g, '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).find(Boolean);
  // npx/uvx/bunx: the package is the first plain argument that is not the value of an unknown flag
  // (so `npx --api-key abc pkg` never shows "abc"). Later args such as connection strings are never shown.
  const BOOLEAN_FLAGS = new Set(['-y', '--yes', '-q', '--quiet']);
  const fromRunner = ['npx', 'bunx', 'uvx', 'pnpx'].includes(runner)
    ? args.find((a, i) => !a.startsWith('-') && isPackage(a) && (i === 0 || !args[i - 1].startsWith('-') || BOOLEAN_FLAGS.has(args[i - 1])))
    : undefined;
  return { transport: 'stdio', endpoint: fromModules || fromRunner || runner || 'local' };
}

function scanMcp(g, ctx) {
  const live = objectOr(objectOr(readJson(join(ctx.home, '.claude.json'))).mcpServers);
  const parked = objectOr(readJson(join(ctx.claude, 'toolbox', 'parked-mcp.json')));
  const servers = [
    ...Object.entries(live).map(([name, config]) => ({ name, config, active: true })),
    ...Object.entries(parked).filter(([name]) => !(name in live)).map(([name, config]) => ({ name, config, active: false })),
  ];
  for (const { name, config, active } of servers) {
    const { transport, endpoint } = mcpEndpoint(config || {});
    const id = g.addNode(`mcp:${name}`, {
      label: name, type: 'mcp', sub: transport, active, desc: `${transport.toUpperCase()} server · ${endpoint}`,
      body: `# ${name}\n\n| | |\n|---|---|\n| Transport | ${transport} |\n| Endpoint | \`${endpoint}\` |\n| Status | ${active ? 'Live' : 'Parked by Toolbox'} |\n`,
    });
    g.link('hub:mcp', id);
    g.register(id, { slugs: [name] });
  }
  const env = objectOr(ctx.settings.env);
  if (servers.length || Object.keys(env).length) {
    g.link('hub:mcp', g.addNode('mcp:claude.ai-connectors', {
      label: 'claude.ai connectors', type: 'mcp', sub: 'connectors', active: env.ENABLE_CLAUDEAI_MCP_SERVERS !== 'false',
      desc: 'Every connector on the claude.ai account (Gmail, Calendar, Drive, Docs…)',
      body: '# claude.ai connectors\n\nRemote MCP servers attached to the claude.ai account and shared with Claude Code.',
    }));
  }
}

// ---------- hooks: settings.json "hooks", one node per script ----------
// Commands can carry tokens and flags, so they are never emitted: only the script's name, its events,
// matchers, timeout and async flag, and the script's own leading comment as a description.
const SCRIPT_RE = /(?:"([^"]+\.(?:mjs|cjs|js|ts|ps1|py|sh|bat|cmd|exe))"|'([^']+\.(?:mjs|cjs|js|ts|ps1|py|sh|bat|cmd|exe))'|([^\s"']+\.(?:mjs|cjs|js|ts|ps1|py|sh|bat|cmd|exe)))(?=$|[\s"'])/i;

/**
 * The script a hook command runs, as { name, path }, or null for inline commands.
 * `path` is absolute (it may not exist), or null when it depends on an env var or the working
 * directory ($CLAUDE_PROJECT_DIR, ${CLAUDE_PLUGIN_ROOT}, ./x.sh), so it can't be checked from here.
 */
export function hookScript(command, home, vars = {}) {
  // Known roots (a mod's ${CLAUDE_PLUGIN_ROOT}, a project's $CLAUDE_PROJECT_DIR) are filled in first so their scripts can be checked.
  let cmd = String(command || '');
  for (const [k, v] of Object.entries(vars)) {
    if (!v) continue;
    const val = v.replace(/\\/g, '/'), ref = `(?:\\$\\{${k}\\}|\\$${k}\\b|%${k}%)`;
    // "$VAR"/rest (the documented form) becomes one quoted path, so a value with spaces stays in one piece.
    cmd = cmd.replace(new RegExp(`"${ref}"(/[^\\s"']*)`, 'g'), (_, rest) => `"${val}${rest}"`).replace(new RegExp(ref, 'g'), val);
  }
  const m = cmd.match(SCRIPT_RE);
  if (!m) return null;
  const token = cmd.slice(0, m.index).split(/\s/).pop() + m[0]; // the whole word, including any $VAR prefix glued to it
  const homeFwd = home.replace(/\\/g, '/');
  let p = (m[1] || m[2] || m[3]).replace(/\\/g, '/');
  p = p.replace(/^(~|\$HOME|\$\{HOME\}|%USERPROFILE%)(?=\/)/i, homeFwd);
  const resolvable = !/[$%]/.test(p) && !/[$%]/.test(token.replace(/^["']?(~|\$HOME|\$\{HOME\}|%USERPROFILE%)/i, '')) && /^([a-z]:)?\//i.test(p);
  let name = basename(p).replace(/\.[^.]+$/, '');
  // Generic entry points (helper.mjs, index.js) inside ~/.claude are named after their folder instead.
  // Only there: outside it, a parent folder can be a username.
  const inClaude = p.toLowerCase().startsWith(`${homeFwd}/.claude/`.toLowerCase());
  if (inClaude && /^(helper|helpers|index|main|run|cli|hook|script)$/i.test(name) && basename(dirname(p))) name = basename(dirname(p));
  return { name, path: resolvable ? p : null };
}

/** First comment sentence of a script (after a shebang), for its description. */
function scriptSummary(text) {
  const lines = text.split('\n').filter((l) => !l.startsWith('#!')).slice(0, 12);
  const comment = [];
  for (const l of lines) {
    const m = l.match(/^\s*(?:\/\/|#|<#|\*|\/\*\*?)\s?(.*?)\s*(?:#>|\*\/)?$/);
    if (!m) break;
    if (m[1]) comment.push(m[1]);
    else if (comment.length) break;
  }
  const text1 = comment.join(' ').replace(/^\.SYNOPSIS\s*/i, '');
  return text1.split(/(?<=\.)\s/)[0].slice(0, 200) || undefined;
}

/** Project folders Claude Code has worked in, read from the `cwd` near the top of each project's newest session log. */
function projectFolders(ctx) {
  const root = join(ctx.claude, 'projects'), out = new Map();
  for (const key of ls(root)) {
    const logs = ls(join(root, key)).filter((f) => f.endsWith('.jsonl')).map((f) => join(root, key, f));
    if (!logs.length) continue;
    const newest = logs.reduce((a, b) => (mtime(a) >= mtime(b) ? a : b));
    let head = '';
    try {
      const fd = openSync(newest, 'r'), buf = Buffer.alloc(65536);
      head = buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString('utf8');
      closeSync(fd);
    } catch { continue; }
    const m = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    if (!m) continue;
    let dir; try { dir = JSON.parse(`"${m[1]}"`); } catch { continue; }
    if (normalizePath(dir) === normalizePath(ctx.home) || !isDir(dir) || out.has(normalizePath(dir))) continue;
    const shortKey = key.replace(new RegExp(`^[a-z]--Users-${escapeRegExp(ctx.userName)}(-|$)`, 'i'), '');
    out.set(normalizePath(dir), { dir, label: projectLabel(shortKey), slug: shortKey });
  }
  return [...out.values()];
}

/** Every place hooks are registered: your settings.json, each mod's hooks/hooks.json, and each project's .claude/settings*.json. */
function hookSources(ctx) {
  const sources = [{ hooks: ctx.settings.hooks, origin: null, vars: {} }];
  for (const mod of ctx.modRoots || []) {
    const file = join(mod.root, 'hooks', 'hooks.json');
    const hooks = existsSync(file) ? objectOr(readJson(file, null)).hooks : null; // local mods use { modules: [...] }, not command hooks
    if (hooks) sources.push({ hooks, origin: { kind: 'mod', ...mod }, vars: { CLAUDE_PLUGIN_ROOT: mod.root } });
  }
  for (const p of projectFolders(ctx)) {
    for (const f of ['settings.json', 'settings.local.json']) {
      const hooks = objectOr(readJson(join(p.dir, '.claude', f), null)).hooks;
      if (hooks) sources.push({ hooks, origin: { kind: 'project', id: null, label: p.label, slug: p.slug, active: true }, vars: { CLAUDE_PROJECT_DIR: p.dir } });
    }
  }
  return sources;
}

function scanHooks(g, ctx) {
  const byName = new Map();
  for (const { hooks, origin, vars } of hookSources(ctx)) {
    for (const [event, groups] of Object.entries(objectOr(hooks))) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        for (const h of Array.isArray(group?.hooks) ? group.hooks : []) {
          const script = h?.type === 'command' ? hookScript(h.command, ctx.home, vars) : null;
          const name = script ? script.name : `${event} ${h?.type === 'prompt' || h?.type === 'agent' ? h.type : 'inline'}`;
          // Same script on several events = one node. Inline hooks group per owner and event.
          const key = `${origin ? `${origin.kind}:${origin.slug}` : 'you'}|${script?.path ? script.path.toLowerCase() : name}`;
          if (!byName.has(key)) byName.set(key, { name, script, origin, regs: [] });
          byName.get(key).regs.push({ event, matcher: typeof group.matcher === 'string' && group.matcher ? group.matcher : '', timeout: h?.timeout, async: !!h?.async, type: h?.type || 'command' });
        }
      }
    }
  }
  const off = ctx.settings.disableAllHooks === true;
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  // With hooks from more than one place, group them by owner so the layouts keep them apart.
  const kinds = new Set([...byName.values()].map((h) => h.origin?.kind || 'you'));
  const groups = {};
  if (kinds.size > 1) {
    const spec = { you: ['hooks-yours', 'Your hooks', 'Registered in ~/.claude/settings.json'], mod: ['hooks-mods', 'Mod hooks', 'Shipped inside installed mods and plugins'], project: ['hooks-projects', 'Project hooks', 'Registered in a project\'s .claude/settings.json'] };
    for (const k of kinds) groups[k] = addGroup(g, 'hook', ...spec[k]);
  }
  for (const { name, script, origin, regs } of byName.values()) {
    const path = script?.path;
    const exists = !!path && existsSync(path) && !isDir(path);
    const inClaude = exists && normalizePath(path).startsWith(normalizePath(ctx.claude) + '/');
    const events = [...new Set(regs.map((r) => r.event))];
    const table = ['| Event | Matcher | Timeout | Async |', '| --- | --- | --- | --- |',
      ...regs.map((r) => `| ${r.event} | ${r.matcher ? `\`${cell(r.matcher)}\`` : 'all'} | ${r.timeout ? `${r.timeout}s` : 'default'} | ${r.async ? 'yes' : 'no'} |`)].join('\n');
    const summary = inClaude && /\.(mjs|cjs|js|ts|ps1|py|sh)$/i.test(path) ? scriptSummary(read(path)) : undefined;
    const from = origin ? (origin.kind === 'mod' ? `${origin.label} mod` : `${origin.label} project`) : undefined;
    const where = script ? (exists ? '' : path ? '**Script not found.** ' : 'Its location depends on an environment variable or the working folder. ') + (inClaude || !path ? '' : 'Lives outside `~/.claude`. ') : 'An inline command, not a script file. ';
    const id = g.addNode(`hook:${origin ? `${origin.slug}/` : ''}${name}`, {
      label: name, type: 'hook', sub: events.join(' · '), from,
      project: origin?.kind === 'project' ? origin.label : undefined,
      file: inClaude ? tilde(ctx, path) : undefined,
      desc: summary || (script ? `Runs ${script.name} on ${events.join(', ')}` : `Inline ${regs[0].type} on ${events.join(', ')}`),
      body: `${table}\n\n${from ? `From the ${from}. ` : ''}${where}The command itself is never shown.`.trim(),
      mtime: exists ? mtime(path) : undefined, active: !off && (origin ? origin.active !== false : true), missing: script && path ? !exists : undefined,
    });
    g.link(groups[origin?.kind || 'you'] || 'hub:hook', id);
    if (origin?.id) g.link(origin.id, id, 'link'); // a mod's hooks connect to the mod
    g.register(id, { slugs: [name] });
  }
}

function scanReference(g, ctx) {
  const files = [
    ...ls(join(ctx.claude, 'reference')).filter((f) => f.endsWith('.md')).map((f) => join(ctx.claude, 'reference', f)),
    join(ctx.claude, 'WORKFLOW.md'),
  ].filter((p) => existsSync(p) && !isDir(p));
  for (const path of files) {
    const text = read(path);
    const slug = basename(path, '.md');
    const id = g.addNode(`ref:${slug}`, {
      label: firstHeading(text) || titleCase(slug), type: 'reference', file: tilde(ctx, path), body: text, mtime: mtime(path),
    });
    g.link('hub:reference', id);
    g.register(id, { path, slugs: [slug], text, dir: dirname(path) });
  }
}

// ---------- models: Claude families plus other popular models ----------
// Every model in MODEL_CATALOG gets a node. It is active when something names it: the default `model` in
// settings.json, an agent's or skill's `model:` frontmatter, a mention in instructions, memories, notes or reference
// ("Opus", "claude-haiku-4-5", "Gemini Flash"), or an alias in the free-helpers config (`helpers/config.json`, the
// FreeLLMAPI hub; only its model names are read, never its key). Models nothing names stay inactive.
function scanModels(g, ctx) {
  const uses = new Map(MODEL_CATALOG.map((m) => [m.id, { users: [], mentions: [], hub: [] }]));
  const def = modelFamily(ctx.settings.model);
  for (const n of g.nodes.values()) {
    if ((n.type === 'agent' || n.type === 'skill') && n.model) {
      const fam = modelFamily(n.model);
      if (fam) uses.get(fam).users.push(n);
    }
  }
  for (const [id, { text }] of g.documents) {
    if (!MENTION_SOURCES.has(g.nodes.get(id)?.type)) continue;
    for (const m of MODEL_CATALOG) if (m.match.test(text)) uses.get(m.id).mentions.push(id);
  }
  const aliases = objectOr(objectOr(readJson(join(ctx.claude, 'helpers', 'config.json'))).aliases);
  for (const [alias, model] of Object.entries(aliases)) {
    const m = typeof model === 'string' && catalogModel(model);
    if (m) uses.get(m.id).hub.push(`${alias}: ${model}`.replace(/[^\w.:\- ]/g, ''));
  }
  const count = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
  for (const { id: key, label, maker } of MODEL_CATALOG) {
    const { users, mentions, hub } = uses.get(key);
    const isDefault = def === key;
    const active = isDefault || users.length > 0 || mentions.length > 0 || hub.length > 0;
    const agents = users.filter((n) => n.type === 'agent').length, skills = users.filter((n) => n.type === 'skill').length;
    const parts = [isDefault ? 'Default model' : '', agents ? `runs ${count(agents, 'agent')}` : '', skills ? `runs ${count(skills, 'skill')}` : '',
      hub.length ? 'on the FreeLLMAPI hub' : ''].filter(Boolean);
    const desc = parts.length ? parts.join(' · ').replace(/^r/, 'R').replace(/^o/, 'O')
      : mentions.length ? `Named in ${count(mentions.length, 'document')}` : `${maker} model · not used yet`;
    const body = [`# ${label}`, '', `Made by ${maker}.\n`,
      isDefault ? 'The default model for every session (`model` in settings.json).\n' : '',
      users.length ? `## Used by\n\n${users.map((n) => `- ${n.label} (${n.type})`).join('\n')}\n` : '',
      hub.length ? `## FreeLLMAPI hub\n\n${hub.map((h) => `- ${h}`).join('\n')}\n` : '',
      mentions.length ? `Named in ${count(mentions.length, 'document')} (instructions, memories, notes or reference).` : '',
      active ? '' : 'Nothing in `~/.claude` names this model yet.',
    ].filter(Boolean).join('\n');
    const id = g.addNode(`model:${key}`, { label, type: 'model', sub: isDefault ? 'default' : maker, from: hub.length ? 'FreeLLMAPI' : undefined, active, desc, body });
    g.link('hub:model', id);
    if (isDefault) g.link('core', id, 'link');
    for (const n of users) g.link(n.id, id, 'link');
    for (const m of mentions) g.link(m, id, 'mention');
  }
}

function pruneEmptyHubs(g) {
  for (const key of Object.keys(HUBS)) {
    const id = `hub:${key}`;
    if (g.links.some((l) => l.source === id && l.target !== 'core')) continue;
    g.nodes.delete(id);
    g.links = g.links.filter((l) => l.source !== id && l.target !== id);
  }
}
