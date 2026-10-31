// Scanners: each one reads one part of ~/.claude and adds it to the graph.
// Active and parked (switched-off) tools are both included; `active: false` marks the parked ones.
// The on/off sources match the Toolbox mod: skills-disabled/, CLAUDE_CODE_PLUGIN_DIRS,
// settings.enabledPlugins, ~/.claude.json mcpServers and toolbox/parked-mcp.json.
import { join, basename, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { read, readJson, objectOr, ls, isDir, mtime, titleCase, firstHeading, frontmatter, escapeRegExp } from './text.mjs';

const NOT_MODS = new Set(['cache', 'data', 'marketplaces', 'store', 'synced']);
const HUBS = { memory: 'Memory', notes: 'Notes', skill: 'Skills', mod: 'Mods', agent: 'Agents', mcp: 'MCP Servers', reference: 'Reference' };

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
  scanReference(g, ctx);
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
    label: meta.name || name, type: 'skill', sub, active,
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

// ---------- mods: local plugin folders + marketplace plugins ----------
function scanMods(g, ctx) {
  const pluginsDir = join(ctx.claude, 'plugins');
  const raw = objectOr(ctx.settings.env).CLAUDE_CODE_PLUGIN_DIRS;
  // Windows lists use ';'. POSIX lists use ':', but not the ':' of a drive letter like C:\.
  const onDirs = (typeof raw === 'string' ? raw : '').split(/;|:(?![\\/])/).map((p) => normalizePath(p.trim())).filter(Boolean);
  // A full-path match (what Claude Code uses), or a `/plugins/<name>` suffix so a copied or relocated
  // home folder (like the demo) still resolves. Trade-off: two plugin folders with the same name both count as on.
  const isOn = (dir, d) => onDirs.some((p) => p === normalizePath(dir) || p.endsWith(`/plugins/${d.toLowerCase()}`));

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
    }
  }
}

// ---------- agents/*.md: sub-agents ----------
function scanAgents(g, ctx) {
  const dir = join(ctx.claude, 'agents');
  for (const f of ls(dir).filter((f) => f.endsWith('.md'))) {
    const path = join(dir, f);
    const { meta, body } = frontmatter(read(path));
    const name = meta.name || f.replace(/\.md$/, '');
    const id = g.addNode(`agent:${name}`, {
      label: name, type: 'agent', file: `~/.claude/agents/${f}`, body, mtime: mtime(path), desc: meta.description, model: meta.model, active: true,
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

// ---------- reference docs ----------
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

function pruneEmptyHubs(g) {
  for (const key of Object.keys(HUBS)) {
    const id = `hub:${key}`;
    if (g.links.some((l) => l.source === id && l.target !== 'core')) continue;
    g.nodes.delete(id);
    g.links = g.links.filter((l) => l.source !== id && l.target !== id);
  }
}
