# Agent Mailbox Protocol

Repository-local message transport for linked worktrees and dependent projects.
Messages are ignored by Git; commits, issues and PRs remain the durable public
record. Contribution and ownership rules are in
[CONTRIBUTING.md](../../CONTRIBUTING.md#agent-coordination).

## Canonical Mailbox

Each project has one canonical mailbox:

```text
<primary-checkout>/.agents/mailbox/
```

The primary checkout is the stable root checkout shown first by
`git worktree list --porcelain`. Agents in linked worktrees must use that
mailbox rather than creating `.agents/` below their current worktree. The
repository commands resolve the primary checkout automatically:

```bash
npm run mailbox:check
npm run mailbox:list
```

Use `--mailbox PATH` only for an explicit alternate or test mailbox.

## Thread Home And Addressing

A thread lives in the canonical mailbox of the project that owns the requested
code change.

- A VIR agent requesting work from another VIR agent uses the VIR mailbox.
- A lean-zip agent requesting a VIR runtime change uses the VIR mailbox.
- A VIR agent requesting a lean-zip validation uses the lean-zip mailbox.

All messages in a conversation remain in the same thread home. Participants
use `project/agent` addresses such as `vir/runtime` or `lean-zip/root`.

Use `project/*` when any agent in the destination project may claim the work;
the standard ownership workflow expects a concrete `project/agent` recipient
to be claimed by that agent. For work spanning more than one owning project,
open one thread per project and link them with `parent-thread` or `depends-on`;
do not grant ambiguous write ownership across repositories in one thread.

## Message Files

Protocol v1 uses a Maildir-inspired one-file-per-message layout. Active
messages live directly in the mailbox directory; archived threads live under
`archive/<thread-id>/`:

```text
.agents/mailbox/ROOT-VIR-20260813-001.md
.agents/mailbox/VIR-ROOT-20260813-001.md
.agents/mailbox/archive/ROOT-VIR-20260812-001/...
```

The filename must equal `<message-id>.md`. IDs are opaque, sender-generated
tokens of up to 128 letters, digits, dots, underscores, or hyphens, beginning
with a letter or digit. This repository convention is readable IDs such as:

```text
<FROM>-<TO>-<YYYYMMDD>-<NNN>
```

`FROM` and `TO` are short uppercase project or agent codes, and `NNN` is a
sender-controlled sequence. Simpler UUID-, ULID-, or tool-generated IDs are
also valid. A reply receives a new message ID and retains the opener's
`thread-id`.

Never edit a delivered message. Corrections and changed decisions are new
messages. A reply names its immediate parent with `in-reply-to`; independent
replies may branch naturally, as in email. This preserves causal history
without forcing every conversation through a single serialized tail.

Write a draft outside the active mailbox root, then deliver it with:

```bash
npm run mailbox:deliver -- /path/to/draft.md
```

Delivery validates the draft against the active thread graph and archive,
writes a complete copy under `tmp/`, and publishes it atomically without
overwriting an existing message ID. The source draft is retained. Advisory
warnings do not block delivery. Never copy a partially written file directly
into the active mailbox; a reply cannot repair an invalid graph node.

## Header

Every message starts with a deliberately simple front matter header. Each field
is one line; protocol v1 does not use nested YAML values.

```markdown
---
protocol: agent-mailbox/v1
message-id: ROOT-VIR-20260813-001
thread-id: ROOT-VIR-20260813-001
in-reply-to:
time: 2026-08-13T14:30:00+02:00
from: lean-zip/root
to: vir/*
kind: request
state: open
requires-claim: true
subject: persist interpreted constants across calls
---

## Request

Describe the problem and evidence.

## Acceptance

- State the observable completion conditions.

## Constraints

- State retained ownership, prohibited approaches, and publication limits.
```

Required fields for every message are:

- `protocol`: exactly `agent-mailbox/v1`;
- `message-id`: the immutable message identity;
- `thread-id`: the opening message's ID;
- `in-reply-to`: empty for the opener, otherwise its immediate parent;
- `time`: `YYYY-MM-DDTHH:MM:SS[.fraction]Z` or the same form with an explicit
  `+HH:MM` or `-HH:MM` UTC offset;
- `from` and `to`: lowercase `project/agent` addresses whose components begin
  with a letter and otherwise contain letters, digits, or hyphens; `from` must
  be concrete, while `to` may use `project/*`;
- `subject`: a concise behavior-oriented summary.

Those envelope fields are the hard interoperability contract. The checker
rejects malformed envelopes, duplicate identities, missing parents,
cross-thread parents, and unreachable messages. Workflow fields and their
interpretation are advisory: surprising values produce warnings but do not
prevent delivery or listing.

The following operational fields are optional:

- `kind` and `state`: recommended coordination vocabulary described below;
- `requires-claim`: whether a request asks for an explicit ownership claim;
- `owner`: current `project/agent` owner;
- `worktree`: project-relative `.worktrees/<slug>` or `none`;
- `branch`: the implementation branch;
- `base` and `head`: abbreviated or full 7--64 character hexadecimal Git
  object IDs;
- `worktree-state`: `clean` or `dirty` (omit it when `worktree` is `none`);
- `publication`: `local-only`, `pushed`, `draft-pr`, or `published`;
- `disposition`: one of the durable outcomes defined below;
- `parent-thread`: a parent coordination thread; and
- `depends-on`: a comma-separated list of prerequisite thread IDs.

Fields prefixed with `x-` are reserved for unconstrained extensions. Unknown
unprefixed fields are retained but warn, nudging tools toward collision-free
extension names. `parent-thread` and `depends-on` describe thread openers,
independently of whether they use the recommended task kinds. Linked thread IDs
may name threads in another project's mailbox and therefore are not required to
exist locally.

Publication states describe observable exposure: `local-only` has no remote
branch, `pushed` has a remote branch but no PR, `draft-pr` has a draft PR, and
`published` has a non-draft PR or an equivalent public review surface.

Disposition values describe a completion or termination outcome:

| Disposition | Meaning |
| --- | --- |
| `ready-for-review` | Work or evidence is complete and awaits requester review. |
| `implemented` | The requested behavior has a durable implementation. |
| `decided` | An investigation or interface decision has a durable conclusion. |
| `rejected` | The request was considered and intentionally declined. |
| `no-action` | Investigation found that no change is needed. |
| `landed` | The result was merged or otherwise adopted. |
| `superseded` | Another recorded thread or result replaced this one. |
| `archived` | Useful evidence was retained outside the active mailbox. |
| `discarded` | No result or evidence needs to be retained. |

## Kinds And States

Agents that want an explicit task lifecycle can use this recommended state
machine:

```text
open --claim--> claimed
claimed --update/handoff--> claimed | in-progress | blocked
in-progress | blocked --update/handoff--> in-progress | blocked
claimed | in-progress | blocked --completion--> completed --closure--> closed
open --direct completion when requires-claim is false--> completed
open | claimed | in-progress | blocked --cancellation--> cancelled
```

The message kinds are:

| Kind | State | Meaning |
| --- | --- | --- |
| `request` | `open` | Open a new thread. |
| `claim` | `claimed` | Claim ownership and name the lane. |
| `update` | `claimed`, `in-progress`, or `blocked` | Add evidence, a decision, or a blocker. |
| `handoff` | `claimed`, `in-progress`, or `blocked` | Transfer ownership or a dependency. |
| `completion` | `completed` | Finish implementation or investigation. |
| `closure` | `closed` | The requester accepts the completion. |
| `cancellation` | `cancelled` | Terminate without completion. |

Free-form correspondence may omit `kind` and `state` or use another kind. For
the standard workflow, record a decision as an `update` when the thread remains
active, or as a `completion` when the request asked only for an investigation
or decision. The requester can accept a completed decision with `closure`.

The checker warns when standard workflow messages bypass a requested claim,
ownership, routing, transition, or disposition conventions. These warnings are
coordination advice, not transport failures. The Markdown body remains the
authoritative place to explain intent and any deliberate exception.

## Ownership and archival

Lane checkpoints use the optional `owner`, `worktree`, `branch`, `base`, `head`,
`worktree-state` and `publication` fields. The body supplies write scope,
acceptance checks and any ownership handoff. Recorded metadata describes a
checkpoint, not current Git or process state. A completion identifies the result
and its durable commit, PR, design document or explicit disposable disposition.
It does not authorize publication or deletion of a worktree or branch.
An implementation claim identifies the sole writer; transfer names the new
owner and checkpoint. Worktree retirement separately requires maintainer
approval and checks of cleanliness, commit reachability and remote/PR state.

A thread can be archived only when **every** branch ends in `closed` or
`cancelled`. The archive command moves the complete thread to
`archive/<thread-id>/`; completed-but-unclosed and active free-form threads stay
in the active mailbox. Archiving a thread does not remove its source worktree.
Archived messages are deletable only after their outcome is retained durably.

## Commands

Validate and atomically publish a complete draft message:

```bash
npm run mailbox:deliver -- /path/to/draft.md
```

The draft may have any filename; the delivered filename is derived from its
validated `message-id`. Delivery preserves the draft and refuses an identity
already present in either the active mailbox or archive.

Validate all v1 envelopes and thread graphs, and report advisory workflow
warnings:

```bash
npm run mailbox:check
```

Run the focused protocol contract tests with `npm run test:mailbox`.

List active threads:

```bash
npm run mailbox:list
```

The human-readable list includes the latest recorded lane checkpoint
(worktree, branch, base/head, cleanliness, and publication) when present.
JSON output contains the protocol marker, resolved mailbox path, ignored
filenames, and the same thread summaries. A summary is an index into the
immutable event files, not a replacement for their message bodies.
For a branching thread, the summary reports the number of leaf branches and
derives lane metadata only from the ancestry of its most recent message; read
the individual messages when branch-specific state matters.

Include terminal threads or emit JSON:

```bash
npm run mailbox:list -- --all
npm run mailbox:list -- --json
```

Archive a wholly closed or cancelled thread:

```bash
npm run mailbox:archive -- ROOT-VIR-20260813-001
npm run mailbox:list -- --archive
npm run mailbox:check -- --archive
```

These commands work from the primary checkout or any linked worktree. For an
explicit mailbox:

```bash
npm run mailbox:check -- --mailbox /path/to/.agents/mailbox
```

Every top-level Markdown file other than `README.md` is treated as a v1
message, so an obsolete directional ledger fails validation instead of
silently remaining in the mailbox. Non-Markdown files and `README.md` are
ignored and reported. The reserved `tmp/` and `archive/` entries must be real
directories, not files or symbolic links. The `tmp/` directory stages atomic
delivery and archival. The checker never consumes files from `tmp/` and reports
entries left there so an interrupted operation can be recovered. For
`tmp/deliver-*`, keep the active message when the same ID is already present and
valid; otherwise redeliver the complete temporary file, then remove the stale
copy after checking the mailbox. To recover an interrupted archival, inspect
`tmp/archive-<thread-id>/`, move its complete message files back to the mailbox
root, remove the empty staging directory, and rerun the checks before retrying.
Delivery and archival mutations are serialized by `tmp/operation.lock` so
global message identity and cross-store integrity remain atomic. Remove a
leftover lock only after confirming no mailbox operation is still running,
then rerun both active and archive checks before retrying. Pass `--help` to any
mailbox command for a concise command and option summary.
