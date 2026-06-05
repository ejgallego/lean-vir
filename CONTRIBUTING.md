# Contributing

Lean VIR is experimental, but the review workflow should stay predictable:
small branches, clear public PR text, and the smallest relevant local check
before asking CI to do the rest.

## Branches

- Use `feat/<slug>` for user-facing or architectural changes.
- Use `fix/<slug>` for bug fixes.
- Use `docs/<slug>` for documentation-only work.
- Use `chore/<slug>` for maintenance and cleanup.
- Use `wip/<slug>` only for local exploratory branches that are not ready for
  review.

Prefer short, descriptive slugs. This repository does not use tracked branch
policy metadata or a backport workflow.

## Worktrees

For multi-step implementation work, prefer one linked worktree per task:

```bash
git worktree add -b feat/<slug> .worktrees/<slug> main
```

Use the root checkout as a stable base for syncing branches, seeding
worktrees, and inspecting shared generated artifacts. Keep local worktree state
under `.worktrees/`; it is ignored by Git.

By default, clean up only worktrees and branches created for the current task.
Do not delete unrelated local worktrees unless the maintainer explicitly asks.

## Commits

Prefer concise imperative subjects in the form:

```text
type: summary
```

Examples:

- `feat: add host callback fixture package`
- `fix: preserve callback cleanup on package reload`
- `docs: document browser smoke setup`

Keep the first line tight enough for `git log --oneline`. Avoid generic
subjects such as `update files` or `misc cleanup`.

## Pull Requests

Before opening or editing a PR, run:

```bash
scripts/pr-message.sh
```

Use the emitted title/body scaffold as the public PR metadata.

Guidelines:

- Use the commit convention for the PR title: `<type>: <subject>`.
- Start the PR body with a short paragraph beginning `This PR ...`.
- Summarize the problem and useful outcome in the body itself; issue links are
  not a substitute.
- Add a few bullets only for behavior, compatibility, review risk, or
  maintainer-visible workflow changes.
- Keep local worktree names, write-scope notes, command transcripts, and
  routine validation logs out of the public body.
- Do not add generator or tool prefixes such as `[codex]` to the title.
- Treat CI as the validation record. Mention local checks only when they cover
  something CI cannot show or when skipped checks change review risk.
- Put questions and extra coordination in PR comments rather than the PR
  description.

## Local Validation

Use the smallest relevant suite first. See [docs/HARNESS.md](docs/HARNESS.md)
for the full command map.

Common checks:

```bash
npm run build:demo
npm run doctor
npm run test:upstream
npm run test:runtime
VIR_FIXTURE_FILTER=fib12 npm run test:fixtures
VIR_FIXTURE_FILTER=fib12 npm run test:fixtures:no-build
npm run test:site
CHROMIUM=/path/to/chromium npm run test:pages:browser
npm test
```

Generated outputs under `build/`, `web/dist/`, and `web/public/*.wasm` /
`web/public/*.irpkg` are local artifacts and should stay out of commits unless
the maintainer explicitly asks for an artifact-policy change.
