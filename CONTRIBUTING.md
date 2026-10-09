# Contributing

Lean VIR is a proof of concept with a defined [support scope](docs/SUPPORT.md)
and experimental integrations. The review workflow should stay predictable:
small branches, clear public PR text, and the smallest relevant local check
before asking CI to do the rest.

Review against the [supported-input assumptions](docs/development/REVIEW_ASSUMPTIONS.md):
cooperative users following documented workflows, trusted generated artifacts,
and explicit producer/consumer contracts. Do not infer an adversarial admission
or Lean kernel-soundness guarantee from artifact validation.

## API changes

Maintain the current API and artifact contracts without legacy or backward
compatibility layers. When replacing an interface, remove the retired code,
aliases and fallback paths; update repository callers, documentation and tests
together. A previously documented API alone is not a reason to retain it.
Keep checks that enforce the current contract and implementations required by
current supported hosts. Applications must refresh their build and deployed
assets together; see [matching runtime assets](docs/guides/JS_API.md#matching-runtime-assets).

## Branches

- Use `feat/<slug>` for user-facing or architectural changes.
- Use `fix/<slug>` for bug fixes.
- Use `docs/<slug>` for documentation-only work.
- Use `chore/<slug>` for maintenance and cleanup.
- Use `wip/<slug>` only for local exploratory branches that are not ready for
  review.

Prefer short, descriptive slugs. The repository has no tracked branch-policy
registry; see [backports](docs/HARNESS.md#backports) for the maintenance target
and workflow.

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

## Agent Coordination

Agents in the root checkout and linked worktrees share the primary checkout's
local `.agents/mailbox/`. Read that mailbox and `git worktree list` before
claiming a lane. Cross-project requests live with the project that owns the
requested code change. See [docs/development/MAILBOX_PROTOCOL.md](docs/development/MAILBOX_PROTOCOL.md)
for the minimal message envelope and optional ownership, handoff, and archival
conventions.

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

Development targets `main`. Selected fixes may also target the single
maintenance line; see [backports](docs/HARNESS.md#backports) for the current
target, provenance, PR links and validation workflow.

### Landing and completion

Land repository changes through a PR, including documentation-only changes and
maintenance fixes. A maintainer's request to "wrap up", "land" or "merge" uses
this workflow. Direct pushes to `main` or a maintenance branch require an
explicit maintainer request to bypass the PR workflow for that change.

Within an authorized landing, publish the task branch and open its PR if needed
without another permission loop. A request to prepare a PR authorizes branch
publication and PR creation for review; it does not authorize merging it.
Before an authorized merge, complete the selected review and verify that the
applicable PR checks pass on the actual head being merged.

Before reporting source changes as landed, verify GitHub's merged PR state and
record the PR URL, validated head and merge commit in the task's completion
evidence. A local review checkpoint or green CI establishes readiness while the
PR is still open. For an explicitly requested direct push, record the maintainer
instruction, target branch and landed commit instead, and verify the remote ref.
Investigation and local preparation tasks can finish without claiming a landing.

### PR metadata

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

### Repository protection

To enforce the PR workflow on GitHub, protect `main` and any active maintenance
branch: require pull requests and apply the restrictions to administrators and
the account used by agents. Review bypass permissions explicitly rather than
assuming the agent account is covered. See
[GitHub's branch protection settings](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
These repository settings are configured separately from the tracked guidance;
adding this policy to a PR does not enable them. Settings changes require their
own explicit maintainer selection.

## Documentation

Write for someone using or changing the system, not following its development
diary. Developer-facing guides are documentation too.

- Describe current behavior, contracts, workflows and limitations. Label planned
  work and historical measurements explicitly; do not present them as guarantees.
- Use the [documentation map](docs/README.md) to find a contract's owning guide.
  Link to that guide elsewhere rather than duplicating its explanation; prefer
  updating it to adding a PR-specific document.
- Prefer one main file per topic, with sections for usage, contracts and gaps.
  An audit, implementation note or roadmap is not by itself a separate topic.
  Split only for an independent reading task or useful dated evidence; do not
  turn consolidation into an enormous manual.
- Keep concise rationale and reproducible evidence that inform future decisions,
  including relevant versions and provenance. Omit the sequence of attempts when
  it adds no lasting explanation.
- Leave routine checkpoints, command transcripts and test logs in commit/PR
  history or CI; use the local mailbox for agent coordination. Promote durable
  decisions into the owning guide rather than leaving them only in local notes.
- When behavior changes, update that guide and its links, and remove obsolete
  explanations. Shortening must not erase safety constraints or known limitations.

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
