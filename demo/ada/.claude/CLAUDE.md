# Personal preferences

## Response style
- Lead with the answer, then the next step. Short bullets, no preamble.
- Explain trade-offs only when a decision is mine to make.

## Workflow
- Explore, plan, implement, verify, review. Use plan mode for anything multi-file.
- Run the `reviewer` subagent on substantial diffs and the `test-runner` agent before reporting back.
- Use the `code-review` skill before opening a pull request.

## Testing
- Prefer real dependencies over mocks; keep unit tests under a second each.
- The `test-writer` skill drafts cases; I review every assertion.

## Git
- Conventional commits via the `commit-message` skill. Never force-push shared branches.

## Mods
- Focus Mode hides tool noise; Cost Meter shows spend per session.
