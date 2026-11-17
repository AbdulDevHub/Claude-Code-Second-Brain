// In-memory knowledge graph: nodes, de-duplicated links, and cross-link resolution
// ([[wikilinks]], relative markdown links and name mentions between documents).
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { escapeRegExp } from './text.mjs';

const MAX_BODY = 20000;
const MENTIONABLE = new Set(['skill', 'mod', 'agent', 'mcp', 'hook']);
const MENTION_SOURCES = new Set(['section', 'memory', 'note', 'reference', 'project']);

export class BrainGraph {
  /**
   * @param {{ redact: (s: string) => string, omitBodies?: boolean }} options
   *   omitBodies: keep titles and descriptions but drop document contents (public builds).
   */
  constructor({ redact, omitBodies = false }) {
    this.redact = redact;
    this.omitBodies = omitBodies;
    this.nodes = new Map();
    this.links = [];
    this.linkKeys = new Set();
    this.bySlug = new Map();
    this.byPath = new Map();
    this.documents = new Map(); // id -> { text, dir } for link resolution
    this.unresolved = []; // { source, target } for [[wikilinks]] and .md links that point nowhere
    this.refs = []; // every resolved [[wikilink]] / .md link, even when de-duplicated against a structure link
  }

  /** Adds a node; every string field is redacted. Returns the final id (suffixed on collision). */
  addNode(rawId, data) {
    let id = this.redact(rawId);
    for (let i = 2; this.nodes.has(id); i++) id = `${this.redact(rawId)}~${i}`;
    const clean = Object.fromEntries(Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, typeof v === 'string' ? this.redact(v) : v]));
    const body = clean.body || '';
    this.nodes.set(id, {
      id, ...clean, desc: clean.desc || '', size: body.length,
      body: this.omitBodies ? '' : body.slice(0, MAX_BODY),
    });
    return id;
  }

  link(source, target, kind = 'structure') {
    if (!source || !target) return;
    [source, target] = [this.redact(source), this.redact(target)];
    if (source === target || !this.nodes.has(source) || !this.nodes.has(target)) return;
    const key = [source, target].sort().join('|');
    if (this.linkKeys.has(key)) return;
    this.linkKeys.add(key);
    this.links.push({ source, target, kind });
  }

  /** Makes a node reachable by file path and by slug, and (optionally) scans its text for links. */
  register(id, { path, slugs = [], text, dir } = {}) {
    if (path) this.byPath.set(resolve(path).toLowerCase(), id);
    for (const s of slugs) if (s) this.bySlug.set(s.toLowerCase(), id);
    if (text != null) this.documents.set(id, { text, dir });
  }

  resolveCrossLinks() {
    const seen = new Set();
    const miss = (source, target) => {
      const key = `${source}|${target.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); this.unresolved.push({ source, target: this.redact(target) }); }
    };
    for (const [id, doc] of this.documents) {
      const { dir } = doc;
      const text = stripCode(doc.text); // `[[example]]` in code is documentation, not a link
      for (const m of text.matchAll(/\[\[([^\]|#\n]{1,80})(?:[|#][^\]\n]*)?\]\]/g)) {
        const slug = m[1].trim(), hit = this.bySlug.get(slug.toLowerCase());
        if (hit) { this.refs.push({ source: id, target: hit }); this.link(id, hit, 'wikilink'); } else if (slug) miss(id, slug);
      }
      if (dir) for (const m of text.matchAll(/\]\(([^)#\s]+\.md)\)/g)) {
        const hit = this.byPath.get(resolve(dir, m[1]).toLowerCase());
        // Only files that are really missing count; links to project files outside ~/.claude are fine.
        if (hit) { this.refs.push({ source: id, target: hit }); this.link(id, hit, 'link'); } else if (!/^[a-z]{2,}:/i.test(m[1]) && !existsSync(resolve(dir, m[1]))) miss(id, m[1]);
      }
    }
    const targets = [...this.nodes.values()].filter((n) => MENTIONABLE.has(n.type)).map((n) => ({ id: n.id, re: mentionPattern(n) }));
    for (const [id, { text }] of this.documents) {
      if (!MENTION_SOURCES.has(this.nodes.get(id)?.type)) continue;
      for (const t of targets) if (t.re.test(text)) this.link(id, t.id, 'mention');
    }
  }

  toJSON(stats, health = []) {
    return { nodes: [...this.nodes.values()], links: this.links, stats, health };
  }
}

export const stripCode = (text) => text
  .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm, ' ') // fenced blocks
  .replace(/^(?: {4}|\t).*$/gm, ' ') // indented code
  .replace(/`[^`\n]*`/g, ' ');

/**
 * Distinctive names (with a hyphen, digit or space) match anywhere as whole words.
 * Plain single words ("review", "retro") only count with context: `name`, /name,
 * "name skill|mod|agent|subagent|mcp|plugin", or, for mods, the capitalised display name.
 */
export function mentionPattern(node) {
  const slug = node.id.slice(node.id.indexOf(':') + 1).replace(/~\d+$/, '');
  const B = '(^|[^\\w-])', E = '(?![\\w-])';
  const parts = [];
  for (const name of new Set([slug, node.label])) {
    const n = escapeRegExp(name);
    if (/[-\d\s]/.test(name)) parts.push(`${B}${n}${E}`);
    else parts.push(`\`${n}\``, `/${n}${E}`, `${B}${n}\\s+(?:skill|mod|agent|subagent|mcp|plugin)s?\\b`);
  }
  const loose = new RegExp(parts.join('|'), 'i');
  const proper = node.type === 'mod' && /^[A-Z]/.test(node.label) ? new RegExp(`${B}${escapeRegExp(node.label)}${E}`) : null;
  return { test: (text) => loose.test(text) || (proper ? proper.test(text) : false) };
}
