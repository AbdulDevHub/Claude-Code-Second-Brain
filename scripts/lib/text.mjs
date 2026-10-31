// Small file and text helpers shared by the scanners.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';

/** Reads a text file as UTF-8 with LF line endings and no BOM. */
export const read = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

/** Reads JSON, returning `fallback` when the file is missing or malformed. */
export function readJson(path, fallback = {}) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(read(path)); } catch { return fallback; }
}

/** A JSON object, or {} for null, arrays and other values that valid-but-odd files can hold. */
export const objectOr = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Lists a directory, or returns [] when it does not exist. */
export const ls = (path) => (existsSync(path) ? readdirSync(path) : []);

export const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
export const mtime = (path) => statSync(path).mtimeMs;
export const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** First `# Heading` of a markdown document, without a trailing "(...)" aside. */
export const firstHeading = (text) => text.match(/^# (.+)/m)?.[1].replace(/\s*\(.*\)$/, '').trim();

/**
 * Minimal YAML frontmatter parser: top-level `key: value`, one level of nesting
 * (`metadata:` + indented keys) and folded/literal block scalars (`>` / `|`).
 */
export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let parent = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\s*)([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, indent, key, raw] = kv;
    const val = raw.replace(/^["']|["']$/g, '');
    if (indent && parent) meta[parent][key] = val;
    else if (!raw) { parent = key; meta[key] = {}; }
    else { parent = null; meta[key] = val; }
  }
  for (const [key, val] of Object.entries(meta)) {
    if (!['>', '|', '>-', '|-'].includes(val)) continue;
    const block = m[1].match(new RegExp(`^${escapeRegExp(key)}:.*\\n((?:[ \\t]+.*(?:\\n|$))+)`, 'm'));
    meta[key] = block ? block[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' ') : '';
  }
  return { meta, body: text.slice(m[0].length) };
}
