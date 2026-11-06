import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { frontmatter, firstHeading } from '../scripts/lib/text.mjs';
import { createRedactor } from '../scripts/lib/redact.mjs';
import { BrainGraph, mentionPattern } from '../scripts/lib/graph.mjs';
import { mcpEndpoint, projectLabel, splitPluginDirs } from '../scripts/lib/sources.mjs';
import { build } from '../scripts/build.mjs';

const DEMO_HOME = fileURLToPath(new URL('../demo/ada', import.meta.url));

test('frontmatter: flat keys, one level of nesting and folded block scalars', () => {
  const { meta, body } = frontmatter('---\nname: toolbox\nmetadata:\n  type: project\ndescription: >\n  first line\n  second line\n---\nBody');
  assert.equal(meta.name, 'toolbox');
  assert.equal(meta.metadata.type, 'project');
  assert.equal(meta.description, 'first line second line');
  assert.equal(body, 'Body');
  assert.deepEqual(frontmatter('no frontmatter').meta, {});
});

test('frontmatter: a blank value is an empty string, not a parent object', () => {
  const { meta } = frontmatter('---\nname:\ndescription: hi\n---\n');
  assert.equal(meta.name, '');
  assert.equal(meta.description, 'hi');
});

test('plugin dirs split on ":" for POSIX and ";" for Windows', () => {
  assert.deepEqual(splitPluginDirs('/Users/me/a:/Users/me/b'), ['/Users/me/a', '/Users/me/b']);
  assert.deepEqual(splitPluginDirs('C:\\a;D:/b'), ['C:\\a', 'D:/b']);
  assert.deepEqual(splitPluginDirs('C:\\only'), ['C:\\only']);
  assert.deepEqual(splitPluginDirs(undefined), []);
});

test('firstHeading drops a trailing aside', () => {
  assert.equal(firstHeading('intro\n# Claude Code cheat sheet (Pro plan)\n'), 'Claude Code cheat sheet');
});

test('redaction scrubs emails, home paths and usernames, and keeps package specs', () => {
  const { redact, findLeak } = createRedactor('ada', ['s1234567']);
  const cases = [
    ['mail ada@example.com', 'mail ‹redacted›'],
    ['C:\\Users\\ada\\x', '~\\x'],
    ['C:\\\\Users\\\\ada\\\\x', '~\\\\x'],
    ['/c/Users/ada/y', '~/y'],
    ['/home/ada/z', '~/z'],
    ['C--Users-ada-Code-app', 'Code-app'],
    ['student s1234567', 'student ‹user›'],
    ['adapter for ada', 'adapter for ‹user›'],
    ['npm i react@18.2.0', 'npm i react@18.2.0'],
  ];
  for (const [input, expected] of cases) assert.equal(redact(input), expected, input);
  assert.equal(findLeak('safe adapter text'), null);
  assert.equal(findLeak('oops ada was here'), 'ada');
});

test('graph de-duplicates links and ignores missing endpoints', () => {
  const g = new BrainGraph({ redact: (s) => s });
  g.addNode('a', { label: 'A', type: 'hub' });
  g.addNode('b', { label: 'B', type: 'hub' });
  g.link('a', 'b'); g.link('b', 'a'); g.link('a', 'missing'); g.link('a', 'a');
  assert.equal(g.links.length, 1);
  assert.equal(g.addNode('a', { label: 'A again', type: 'hub' }), 'a~2', 'collisions get a suffix');
});

test('mentions: distinctive names match anywhere, plain words need context', () => {
  const review = mentionPattern({ id: 'skill:review', label: 'review', type: 'skill' });
  assert.equal(review.test('please review this'), false);
  assert.equal(review.test('run the `review` skill'), true);
  assert.equal(review.test('use /review first'), true);
  const hyphen = mentionPattern({ id: 'agent:ui-checker', label: 'ui-checker', type: 'agent' });
  assert.equal(hyphen.test('then ui-checker screenshots it'), true);
  const mod = mentionPattern({ id: 'mod:toolbox', label: 'Toolbox', type: 'mod' });
  assert.equal(mod.test('Toolbox parks it'), true);
  assert.equal(mod.test('a toolbox of ideas'), false);
});

test('MCP endpoints never expose arguments, headers or URLs beyond the host', () => {
  assert.deepEqual(mcpEndpoint({ type: 'http', url: 'https://mcp.example.com/v1?token=abc' }), { transport: 'http', endpoint: 'mcp.example.com' });
  assert.equal(mcpEndpoint({ command: 'npx', args: ['-y', '@scope/server-pg', 'postgresql://u:p@db/app'] }).endpoint, '@scope/server-pg');
  assert.equal(mcpEndpoint({ command: 'node', args: ['C:\\npm\\node_modules\\@playwright\\mcp\\cli.js'] }).endpoint, '@playwright/mcp');
});

test('project labels drop container folders', () => {
  assert.equal(projectLabel('OneDrive-Documents-CSC384-A2'), 'CSC384 A2');
  assert.equal(projectLabel('Downloads-Coding-Projects-Filmverse'), 'Filmverse');
  assert.equal(projectLabel('AppData-Roaming-Claude-scratch-x'), 'Scratch Session');
});

test('demo build: counts active and parked tools, links documents, leaks nothing', () => {
  const { json, stats } = build({ home: DEMO_HOME });
  const { nodes, links } = JSON.parse(json);
  assert.deepEqual(stats.skills, { total: 11, active: 7 });
  assert.deepEqual(stats.mods, { total: 4, active: 2 });
  assert.deepEqual(stats.mcp, { total: 5, active: 3 });
  assert.equal(nodes.find((n) => n.id === 'skill:sql-tuner').active, false);
  assert.ok(links.some((l) => l.kind === 'wikilink'), 'wikilinks resolve');
  assert.ok(links.some((l) => l.kind === 'mention' && l.target === 'skill:code-review'), 'mentions resolve');
  for (const secret of ['demo-secret-token-123', 'hunter2', 'Authorization']) assert.ok(!json.includes(secret), `leaked ${secret}`);
  const ids = new Set(nodes.map((n) => n.id));
  assert.ok(links.every((l) => ids.has(l.source) && ids.has(l.target)), 'no dangling links');
});

test('public build keeps structure but drops document contents', () => {
  const { json, stats } = build({ home: DEMO_HOME, omitBodies: true });
  const { nodes } = JSON.parse(json);
  assert.equal(stats.public, true);
  assert.ok(nodes.every((n) => n.body === ''));
  assert.ok(nodes.some((n) => n.size > 0 && n.desc), 'sizes and descriptions survive');
});

test('MCP endpoint skips values of unknown flags', () => {
  assert.equal(mcpEndpoint({ command: 'npx', args: ['--api-key', 'abc123', '@scope/mcp-server'] }).endpoint, '@scope/mcp-server');
  assert.equal(mcpEndpoint({ command: 'npx.cmd', args: ['-y', 'shadcn@latest', 'mcp'] }).endpoint, 'shadcn@latest');
});

test('demo build: plugin dirs, marketplace plugins, synced skills and parked MCP precedence', () => {
  const { nodes } = JSON.parse(build({ home: DEMO_HOME }).json);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  assert.equal(byId.get('mod:focus-mode').active, true, 'listed in CLAUDE_CODE_PLUGIN_DIRS');
  assert.equal(byId.get('mod:cost-meter').active, false, 'not listed');
  assert.equal(byId.get('mod:jira-sync').active, false, 'enabledPlugins: false');
  assert.equal(byId.get('skill:deep-research').sub, 'claude.ai');
  assert.equal(byId.get('mcp:figma').active, false);
  assert.equal(byId.get('mcp:github').active, true);
});

test('odd but valid files never crash the build', () => {
  const home = mkdtempSync(join(tmpdir(), 'brain-'));
  const claude = join(home, '.claude');
  const put = (rel, text) => { mkdirSync(dirname(join(claude, rel)), { recursive: true }); writeFileSync(join(claude, rel), text); };
  put('CLAUDE.md', '## First section on line one\nbody\n## Second\nmore');
  put('settings.json', 'null');
  put('toolbox/parked-mcp.json', '[]');
  put('skills/synced/b/manifest.json', '{"skills":[{"description":"no name"},null,{"name":"ok"}]}');
  put('plugins/installed_plugins.json', '{"plugins":null}');
  writeFileSync(join(home, '.claude.json'), '{"mcpServers":null}');
  try {
    const { nodes } = JSON.parse(build({ home }).json);
    assert.equal(nodes.filter((n) => n.type === 'section').length, 2, 'a section on line one is kept');
    assert.ok(nodes.some((n) => n.id === 'skill:ok'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
