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
/** Claude model families, newest naming first. */
export const MODEL_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];
/**
 * Family of a `model:` value ("opus", "claude-sonnet-4-5", "opusplan", "sonnet[1m]").
 * null when it defers to the session ("inherit", "default", empty); undefined when it names no known family.
 */
export function modelFamily(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || v === 'inherit' || v === 'default') return null;
  return MODEL_FAMILIES.find((f) => v.includes(f));
}
/**
 * Every model the Models hub knows. Claude families come first and match a capitalised name or `claude-<family>`;
 * the rest match their usual spellings. Models nothing names still appear, as inactive.
 */
export const MODEL_CATALOG = [
  ...MODEL_FAMILIES.map((id) => ({ id, label: titleCase(id), maker: 'Anthropic', match: new RegExp(`(^|[^\\w-])(${titleCase(id)}|claude-${id})(?![\\w-])`) })),
  { id: 'gemini-flash', label: 'Gemini Flash', maker: 'Google', match: /\bgemini[- ](?:[\d.]+[- ])?flash\b|\bgemini-flash\b/i },
  { id: 'gemini-pro', label: 'Gemini Pro', maker: 'Google', match: /\bgemini[- ](?:[\d.]+[- ])?pro\b/i },
  { id: 'gemma', label: 'Gemma', maker: 'Google', match: /\bgemma[\d.]*\b/i },
  { id: 'gpt-luna', label: 'ChatGPT Luna', maker: 'OpenAI', match: /\b(?:chat)?gpt[- ]luna\b/i },
  { id: 'gpt', label: 'GPT', maker: 'OpenAI', match: /\bgpt-\d|\bo[34]-mini\b/i },
  { id: 'grok', label: 'Grok', maker: 'xAI', match: /\bgrok(?:[- ]\d[\w.]*)?\b/i },
  { id: 'llama', label: 'Llama', maker: 'Meta', match: /\bllama[- ]?\d/i },
  { id: 'deepseek', label: 'DeepSeek', maker: 'DeepSeek', match: /\bdeepseek\b/i },
  { id: 'qwen', label: 'Qwen', maker: 'Alibaba', match: /\bqwen[\d.]*/i },
  { id: 'mistral', label: 'Mistral', maker: 'Mistral AI', match: /\bmistral\b|\bcodestral\b/i },
  { id: 'kimi', label: 'Kimi', maker: 'Moonshot', match: /\bkimi\b/i },
  { id: 'glm', label: 'GLM', maker: 'Zhipu', match: /\bglm-\d/i },
  { id: 'nemotron', label: 'Nemotron', maker: 'NVIDIA', match: /\bnemotron\b/i },
  { id: 'laguna', label: 'Laguna', maker: 'Poolside', match: /\b(?:poolside-)?laguna\b/i },
];
/** Catalog entry a model id or name belongs to ("qwen3.8-27b" → Qwen), or undefined. */
export const catalogModel = (value) => MODEL_CATALOG.find((m) => m.match.test(String(value ?? '')) || String(value ?? '').toLowerCase().includes(m.id));
export const escapeRegExp =(s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  const lines = m[1].split('\n');
  for (const [i, line] of lines.entries()) {
    const kv = line.match(/^(\s*)([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, indent, key, raw] = kv;
    const val = raw.replace(/^["']|["']$/g, '');
    if (indent && parent) meta[parent][key] = val;
    // A bare `key:` is a parent only when indented keys follow; otherwise it is an empty value.
    else if (!raw && /^\s+[\w-]+:/.test(lines[i + 1] ?? '')) { parent = key; meta[key] = {}; }
    else { parent = null; meta[key] = val; }
  }
  for (const [key, val] of Object.entries(meta)) {
    if (!['>', '|', '>-', '|-'].includes(val)) continue;
    const block = m[1].match(new RegExp(`^${escapeRegExp(key)}:.*\\n((?:[ \\t]+.*(?:\\n|$))+)`, 'm'));
    meta[key] = block ? block[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' ') : '';
  }
  return { meta, body: text.slice(m[0].length) };
}
