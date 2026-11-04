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
overwriting an existing message ID in the mailbox or archive; the delivered
filename is derived from the `message-id` and the draft is retained. Advisory
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

These states are optional, not a required conversation sequence. Do not send
claim, acceptance or closure messages merely to advance a status label; use the
board for routine status. A substantive ownership transfer or decision still
needs an explicit handoff.

The checker warns when standard workflow messages bypass a requested claim,
ownership, routing, transition, or disposition conventions. These warnings are
coordination advice, not transport failures. The Markdown body remains the
authoritative place to explain intent and any deliberate exception.

## Ownership and archival

Ownership is task-scoped. Agent names and historical claims do not establish
permanent subsystem ownership or veto power. Use the current assignment and Git
state to identify an active overlap; completion ends the task's write reservation,
though an explicitly recorded publication or cleanup action may remain pending.
Route ambiguity to the coordinator once rather than seeking every former owner's
agreement.

Lane checkpoints use the optional `owner`, `worktree`, `branch`, `base`, `head`,
`worktree-state` and `publication` fields. The body supplies write scope,
acceptance checks and any ownership handoff. Recorded metadata describes a
checkpoint, not current Git or process state. A completion identifies the result
and its durable commit, PR, design document or explicit disposable disposition.
It does not authorize publication or deletion of a worktree or branch.
An implementation claim identifies the sole writer; transfer names the new
owner and checkpoint. Worktree retirement separately requires maintainer
approval and checks of cleanliness, commit reachability and remote/PR state.

A thread can normally be archived only when **every** branch ends in `closed` or
`cancelled`. The coordinator may explicitly archive a historical thread whose
branches all end in `completed`, using `mailbox:archive -- THREAD-ID --completed`,
after recording its disposition in the workboard/evidence. This moves the original
messages without inventing closure replies or rewriting their states. It is
history relocation, not a new acceptance, publication or task-completion claim.
Keep unresolved review/dependency handoffs active; the flag cannot archive an
open, blocked or otherwise active branch. The archive command moves the complete
thread to `archive/<thread-id>/`. Archiving does not remove its source worktree.
Archived messages are deletable only after their outcome is retained durably.

## Messages And Wake-ups

Use the mailbox for durable evidence, not command transcripts. Before sending,
name the recipient and the action or decision they must take now; otherwise
update the board or evidence silently. A handoff normally answers only:

```text
Outcome: ready, blocked, landed, or no-action
Head/PR: exact commit and public review surface when applicable
Decision: one action needed, or none
Evidence: one durable file or report
```

Keep logs, hashes and detailed rationale in the linked evidence. Do not send
acknowledgements, receipt echoes, routine progress, build/CI starts, unchanged
CI updates or duplicate completion reports. Record a PR's final exact-head
check result once, and an earlier failure only if it changes scope or blocks
the next action. A real blocker or a scope-changing decision is worth an
immediate message. Batch independent status into one coordinator digest when
useful.

Consult other owners only for overlapping edits or shared-contract changes, and
do not repeat permission already granted. An assigned liaison handles intake
and handoffs directly. Each PR operation (publication, CI, landing) has one
accountable owner; independent review does not transfer ownership. After an
interruption, check the current source and handoff before continuing; a model
switch alone needs no new claim or message.

To wake a specific owner, use the targeted mechanism its runtime provides;
threads and the board must stay understandable without it. An owner that can
be woken records its own `x-runtime`, `x-session-uuid` and, if needed,
`x-session-cwd`, and repeats them after a restart or handoff; use the latest
values from a message whose `from` is the current owner. When they are
missing, use `codex` only for known historical Codex lanes; otherwise check the
board or ask, and never guess a session. Never fork, stop or otherwise disturb
a running session to wake it; ask the owner or the maintainer to relay.

- `codex`: `codex queue --thread <uuid> --message '<handoff>'`.
- `claude-code`: from `x-session-cwd` (the launch directory, which may differ
  from the worktree), `claude --bg --resume <uuid> '<handoff>'` continues a
  stopped session. If `claude agents --json` shows it running, relay instead;
  if the command reports that it started a copy, stop the copy at once.

## Commands

```bash
npm run mailbox:deliver -- /path/to/draft.md
npm run mailbox:check
npm run mailbox:list
npm run mailbox:list -- --brief      # one line per thread
npm run mailbox:list -- --details    # or --all, --json
npm run mailbox:archive -- ROOT-VIR-20260813-001
npm run mailbox:list -- --archive
npm run mailbox:check -- --archive
npm run test:mailbox
```

The commands work from the primary checkout or any linked worktree; pass
`--mailbox /path/to/.agents/mailbox` for an explicit mailbox and `--help` for
options. `mailbox:check` validates all v1 envelopes and thread graphs and
reports advisory warnings. `mailbox:archive` accepts only a wholly closed or
cancelled thread unless `--completed` applies (see above).

`mailbox:list` prints at most 20 recent compact thread summaries, with a notice
when entries are omitted, including the latest recorded lane checkpoint.
`--brief` prints a compact one-line index for routine lane selection;
`--details` adds the full index, metadata and warnings; `--all` includes
terminal threads; `--json` is uncapped. A summary is an index into the
immutable message files, not a replacement for them or a roster of running
agents: for a branching thread it derives lane metadata only from the ancestry
of the most recent message, and the workboard, not old thread states, shows
active work.

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
