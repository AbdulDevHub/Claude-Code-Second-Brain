#!/usr/bin/env node
// PreToolUse guard: blocks `git push --force` on shared branches. Exit 2 blocks the command.
const input = JSON.parse(await new Response(process.stdin).text() || '{}');
const cmd = input.tool_input?.command || '';
if (/git\s+push\b.*--force(?!-with-lease)/.test(cmd)) { console.error('Force-push is blocked.'); process.exit(2); }
