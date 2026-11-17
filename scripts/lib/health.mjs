// Read-only health checks over the built graph: things worth tidying in ~/.claude.
// Pure function of the graph and `now`, so tests can pin the clock.

export const STALE_DAYS = 120;
const DAY = 86_400_000;
const DOCS = new Set(['memory', 'note']);
const DESCRIBED = new Set(['memory', 'skill', 'agent', 'mod']);
const PARKABLE = new Set(['skill', 'mod', 'mcp', 'hook']);
const isIndex = (n) => n.id === 'note:index';
// Links from an index (MEMORY.md, notes/INDEX.md) don't count as a real connection for the orphan check.
const isIndexId = (id) => id === 'note:index' || id.startsWith('project:');

/** Kinds in display order. `warn` kinds lower the score; `info` kinds are just listed. */
export const HEALTH_KINDS = [
  { kind: 'missing-script', level: 'warn', title: 'Hook script missing' },
  { kind: 'unindexed', level: 'warn', title: 'Not in the memory index' },
  { kind: 'missing-link', level: 'warn', title: 'Links to nothing' },
  { kind: 'no-description', level: 'warn', title: 'No description' },
  { kind: 'orphan', level: 'info', title: 'Not linked' }, // common and harmless, so it doesn't lower the score
  { kind: 'stale', level: 'warn', title: 'Not touched lately' },
  { kind: 'parked', level: 'info', title: 'Parked' },
];

/**
 * @param {{ nodes: Map<string, object>, links: object[], refs: object[], unresolved: {source:string,target:string}[] }} graph
 * @returns {{ items: {kind:string,id:string,label:string,detail:string}[], summary: object }}
 */
export function checkHealth(graph, now = Date.now()) {
  const nodes = [...graph.nodes.values()];
  const items = [];
  const add = (kind, n, detail) => items.push({ kind, id: n.id, label: n.label || n.id, detail });

  for (const { source, target } of graph.unresolved) {
    const n = graph.nodes.get(source);
    if (n) add('missing-link', n, `points to "${target}", which doesn't exist yet`);
  }

  const linked = new Set(), indexed = new Set();
  const refs = graph.refs || [];
  for (const r of refs) if (r.source.startsWith('project:')) indexed.add(r.target);
  for (const l of [...refs, ...graph.links.filter((l) => l.kind === 'mention')]) {
    if (l.source === l.target || isIndexId(l.source) || isIndexId(l.target)) continue;
    linked.add(l.source); linked.add(l.target);
  }
  // Memories whose own project has a non-empty MEMORY.md (matched by the project->memory structure link, not the lossy label).
  const underIndex = new Set();
  for (const l of graph.links) {
    const p = graph.nodes.get(l.source);
    if (l.kind === 'structure' && p?.type === 'project' && p.size > 0) underIndex.add(l.target);
  }

  for (const n of nodes) {
    if (DESCRIBED.has(n.type) && !n.desc && !isIndex(n)) add('no-description', n, 'no description in its frontmatter');
    if (n.type === 'memory' && underIndex.has(n.id) && !indexed.has(n.id)) add('unindexed', n, 'missing from MEMORY.md, so Claude never loads it');
    if (DOCS.has(n.type) && !isIndex(n)) {
      if (!linked.has(n.id)) add('orphan', n, 'no links to other memories, notes or tools');
      const days = n.mtime ? Math.floor((now - n.mtime) / DAY) : 0;
      if (days > STALE_DAYS) add('stale', n, `last edited ${days} days ago`);
    }
    if (n.type === 'hook' && n.missing === true) add('missing-script', n, 'its script file is gone, so this hook fails every time it fires');
    if (PARKABLE.has(n.type) && n.active === false) add('parked', n, n.type === 'hook' ? 'all hooks are off (disableAllHooks)' : `${n.type} is switched off`);
  }

  const warnKinds = new Set(HEALTH_KINDS.filter((k) => k.level === 'warn').map((k) => k.kind));
  const checked = nodes.filter((n) => (DESCRIBED.has(n.type) || DOCS.has(n.type) || n.type === 'hook') && !isIndex(n)).length;
  const flagged = new Set(items.filter((i) => warnKinds.has(i.kind)).map((i) => i.id)).size;
  const counts = Object.fromEntries(HEALTH_KINDS.map(({ kind }) => [kind, items.filter((i) => i.kind === kind).length]));
  return { items, summary: { checked, clean: checked - flagged, flagged, counts } };
}
