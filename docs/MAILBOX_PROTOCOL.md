# Agent Mailbox Protocol

The agent mailbox is a small local message transport for coordinating work
without turning branch or worktree state into a task database. It supports two
common cases:

1. agents working in different linked worktrees of the same project; and
2. agents coordinating changes between dependent projects.

The design deliberately separates a small, validated transport envelope from
optional workflow conventions. Agents remain free to use the Markdown body and
additional metadata that fit the conversation; the CLI is a guardrail and
index, not a ticketing system.

Mailbox contents are local coordination state. They are ignored by Git and do
not replace commits, tracked design documents, issues, or pull requests as the
durable record of a decision.

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
use `project/agent` addresses such as:

```text
vir/root
vir/runtime
lean-zip/root
illuminate/hit-scene
```

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

## Planning And Execution

A mailbox thread is a conversation context, not intrinsically a task. Agents
may use free-form threads to explore alternatives, assemble a plan, or record a
decision without adding `kind`, `state`, ownership, or lane metadata.

```markdown
---
protocol: agent-mailbox/v1
message-id: plan-runtime-boundary
thread-id: plan-runtime-boundary
in-reply-to:
time: 2026-08-13T13:45:00+02:00
from: vir/root
to: lean-zip/root
subject: choose the runtime boundary
---

## Context

Compare the remaining options before opening implementation lanes.
```

For a small change, the same thread may move naturally from request through
claim and completion. When planning produces several implementation lanes,
keep the planning thread as the parent context and open one child request per
lane and owning project. Put `parent-thread` on each child opener, express
ordering with `depends-on`, and record claims and worktree checkpoints only in
the executable child threads. This preserves discussion without turning one
planning conversation into an ambiguous shared task.

Before closing a planning thread, retain its durable conclusion in a tracked
design document, commit, issue, pull request, or an explicit `no-action` or
`discarded` disposition. The mailbox remains the coordination record rather
than the sole home of a plan that future work depends on.

## Worktree Ownership

Before opening or claiming an implementation lane, read the mailbox and run:

```bash
git worktree list
```

The primary checkout remains the stable coordination base. New implementation
work normally uses:

```bash
git worktree add -b <type>/<slug> .worktrees/<slug> <base-commit>
```

An implementation claim should record the project-relative
worktree, branch, base commit, intended write scope, and publication boundary.
Write scope stays
in the Markdown body so paths can be listed clearly:

```markdown
---
protocol: agent-mailbox/v1
message-id: VIR-ROOT-20260813-001
thread-id: ROOT-VIR-20260813-001
in-reply-to: ROOT-VIR-20260813-001
time: 2026-08-13T15:10:00+02:00
from: vir/runtime
to: lean-zip/root
kind: claim
state: claimed
owner: vir/runtime
worktree: .worktrees/persist-ir-cache
branch: fix/persist-ir-cache
base: 5703203
publication: local-only
subject: persistent package interpreter accepted
---

## Write Scope

- `wasm/upstream_shim/interpreter/`
- `fixtures/runtime-tests/`

No push or public PR is authorized.
```

The claim signals to another agent that it should not open an overlapping lane.
A later handoff should name the new owner and the checkpoint it may consume.

## Completion Checkpoints

A completion reports the observable result and enough exact identity for a
dependent agent to consume it:

```markdown
---
protocol: agent-mailbox/v1
message-id: VIR-ROOT-20260813-002
thread-id: ROOT-VIR-20260813-001
in-reply-to: VIR-ROOT-20260813-001
time: 2026-08-13T18:20:00+02:00
from: vir/runtime
to: lean-zip/root
kind: completion
state: completed
worktree: .worktrees/persist-ir-cache
branch: fix/persist-ir-cache
base: 5703203
head: abc1234
worktree-state: clean
publication: local-only
disposition: ready-for-review
subject: persistent package interpreter validated
---

## Outcome

Summarize behavior and compatibility.

## Validation

Record only the review-relevant checks and artifact identities.

## Remaining Work

State explicit follow-up or `None`.
```

Completion does not authorize pushing, opening a PR, deleting a worktree, or
deleting a branch. Those remain explicit maintainer actions. Public PR bodies
must not include local mailbox paths, worktree names, command transcripts, or
routine coordination notes.

## Durability And Cleanup

Before closure, the completion or closure message identifies the durable home
of the outcome:

- a commit or landed pull request;
- a retained branch for useful or rejected experimental evidence;
- a tracked design document; or
- an explicit decision that the evidence is disposable.

Archive mailbox files only when every branch of a thread ends in `closed` or
`cancelled`. The archive command moves the complete thread, not selected
events, to `archive/<thread-id>/`. Open, claimed, blocked,
completed-but-unclosed, and free-form active threads remain. Archives stay
inspectable and may be deleted manually only after their outcome is durable.

Mailbox deletion does not authorize worktree or branch deletion. Worktree
retirement separately confirms cleanliness, commit reachability, remote/PR
state, and maintainer approval.

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

## Design Lineage

This is intentionally a filesystem-local subset, not a replacement for a
network agent protocol:

- [Maildir](https://manpages.debian.org/unstable/qmail/maildir.5.en.html)
  contributes immutable per-message files and staged atomic delivery through a
  temporary directory.
- [RFC 5322](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.4)
  contributes opaque message identity and immediate-parent reply linkage,
  including branching conversations.
- [AMQP 1.0 messaging](https://docs.oasis-open.org/amqp/core/v1.0/amqp-core-messaging-v1.0.html)
  contributes the separation between immutable message content and
  infrastructure or application annotations.
- [A2A](https://a2a-protocol.org/latest/specification/) contributes the
  distinction between free-form messages and optional stateful tasks, plus
  namespaced extension metadata.
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
  demonstrate a local mailbox kept separate from a shared task list. This
  protocol uses linked request threads instead of introducing a task database.
- [MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail)
  demonstrates the fuller repository-coordination design space: inboxes,
  searchable archives, read acknowledgements, and advisory file leases. Those
  server and database features remain outside this local protocol.
- [FIPA ACL](https://www.fipa.org/repository/aclspecs.html) demonstrates the
  alternative of normative communicative acts. The mailbox keeps `kind`
  advisory because these cooperating local agents do not need formal
  performative semantics.

The repository does not need agent discovery, authentication, streaming,
remote transports, or typed artifacts. If those needs emerge, prefer adopting
an established protocol rather than expanding this local format into one.
