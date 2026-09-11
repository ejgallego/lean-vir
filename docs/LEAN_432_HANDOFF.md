# Lean 4.32 maintenance handoff

Prepared 2026-09-11 for a VIR-native agent. This is a handoff checkpoint, not a
refresh to current main. The branch adds documentation only above the working
Iris dependency. No agent is started or ownership transferred by publishing it.

## Assignment prompt

Take ownership of VIR's Lean **4.32.2** compatibility maintenance when the
maintainer assigns you this handoff. Keep a small, reviewable compatibility
layer over landed VIR changes, with the Iris proof-mode widget as the concrete
downstream acceptance case. Work in the VIR repository, not inside Iris's
installed dependency checkout.

Start with read-only intake: verify the actual branches, current upstream,
existing owners and prerequisites. Then record an explicit lane claim and
prepare a successor based on the latest landed main, preserving the known-good
checkpoint. Separate necessary 4.32 adaptations from obsolete experiments and
generic fixes already owned or implemented upstream. Report a tested successor
commit and its remaining limitations to the Iris owner; do not repin Iris as
part of producer maintenance.

Read the current primary checkout's `AGENTS.md`, `docs/DEVELOPER_GUIDE.md`,
`docs/README.md`, and the applicable subsystem contracts before implementing.
When present, read the canonical private `WORKBOARD.md` and relevant mailbox
threads, then run `npm run mailbox:lanes`. Older branches can use
`git worktree list`, `npm run mailbox:list`, and direct status/head checks.
The primary checkout may itself be stale or dirty: inspect current upstream
code in an isolated worktree and preserve existing edits.

Coordinate through the existing VIR integration coordinator. Keep one writer
for this compatibility lane; an upstream RPC/bindings/module owner does not
lose their lane because this handoff exists. Do not wake or replace paused
owners, expand into their queued work, or edit the coordinator's private board.
Read related local threads when available: `IRIS-VIR-INTEGRATION-20260911-001`,
`VIR-IRIS-SHELL-PORT-20260911-001`, and `VBP-VIR-LAKE-CACHE-20260911-001`.
Those records are coordination context, not prerequisites for fetching the code.

Publication of this initial handoff is authorized. Subsequent pushes, public
PRs, history rewrites, branch/worktree deletion, and consumer changes require
the maintainer's explicit direction. Local compatibility work, tests and
checkpoints are the intended scope after assignment. Do not introduce a
general backport framework or a new downloader/cache policy.

## Fetch the handoff

Repository: [ejgallego/lean-vir](https://github.com/ejgallego/lean-vir).
Branch: [`chore/lean-v432`](https://github.com/ejgallego/lean-vir/tree/chore/lean-v432).
This document lives at `docs/LEAN_432_HANDOFF.md` on that branch.

From the VIR primary checkout, after checking existing lanes and paths:

```sh
git fetch https://github.com/ejgallego/lean-vir.git refs/heads/chore/lean-v432
git worktree add -b chore/lean-v432-maintenance .worktrees/lean-v432 FETCH_HEAD
```

These commands create a new working lane, not a reset of an existing one. If
the branch or path already exists, inspect its ownership and state first.
Record the fetched handoff head and the upstream base before further work.

The historical producer checkout is an **independent Git clone** under Iris's
`Iris/.lake/packages/lean_vir`, with linked donor worktrees named
`vir-pr171-v432` and `vir-widget-errors` under Iris's `.worktrees/`. It is not
part of the primary VIR repository's worktree registry. Fetch the published
objects into VIR; do not move, reset, clean or build over those donor paths.

## Exact baseline and history

| Role | Revision |
| --- | --- |
| Iris's working VIR pin; parent of this documentation handoff | `8032fd34add0b75d4f59c82382e2a57b4c2522a4` |
| Readable native RPC errors | `b6eed32f996886c6de4491b22b16775685413059` |
| Combined 4.32 compatibility/legacy-bridge commit | `be6931c063a675a8089f2d5ed52bb4d379d0f718` |
| PR #171 source head used by that compatibility commit | `8750e1b2192a2da3ebac518c5dcd2695c10b0b39` |
| Previous main-based compatibility checkpoint | `b68e442689274cb7be7a8d5f3167f201ed97cf9c` |
| Original published module-system checkpoint | `ea9ba047aef4bc6cbb24c24d74a51af50dcce66c` |
| Remote main observed while preparing this handoff | `d5aa57fad25dd398bb584ea3009490fa1298a113` |
| Required Lean toolchain | `leanprover/lean4:v4.32.2` |
| Matching Lean source | `f3b06c705e6c85f5314019d5d3baab0fec5b580c` |

The lineage was: module-system PR #166 -> refresh over main `44eaeba` ->
refresh over PR #171 at `8750e1b` -> the two shell fixes. PR #171 later landed
as `1f50365fc4c6c041502a8687cb588e967ce0fd15`; **the compatibility branch is not
based on that final landed commit**. Fetch current main and inspect the delta;
do not equate a pre-merge PR head with the final implementation.

Remote refs checked at handoff preparation:

- `fix/iris-widget-errors` retains the working `8032fd3` donor.
- `feat/module-system-v432` still points to `ea9ba047`. The old local branch
  of the same name points to `be6931c`; they are not interchangeable.
- `chore/lean-v432` is the new documentation-bearing checkpoint. Neither old
  remote branch is rewritten by this handoff.

## Classify the patch before refreshing it

Inspect `git show be6931c` and `git diff 8750e1b..8032fd3`. The compatibility
commit mixes two concerns; do not blindly replay all of it as toolchain support.

| Concern | Files and required review |
| --- | --- |
| Toolchain/source pairing | `lean-toolchain`, `scripts/fetch-lean-source.sh`: keep Lean 4.32.2 and the exact matching source together. |
| Float and native extern compatibility | `fixtures/Boundary.lean` uses `Init.Data.Float32` and direct `Float.toBits`/`Float32.toBits`; `Vir/GeneratePackage/NativeExterns.lean` includes those externs and filters table entries absent from the environment. Reassess the filter against current contracts; missing required externs must still fail validation. |
| Wasm compilation | `scripts/build-upstream-probe.sh` adds `-DLEAN_USE_SPLIT_STACK=1`. Preserve the upstream interpreter boundary and verify strict-link/runtime behavior on the selected Lean source. |
| Historical cursor-RPC bridge | `Vir/Infoview/RpcWidget.lean`, `web/src/rpc-json.js`, shell support, the typed-RPC fixture/tests, Lake registration, package scripts and library docs. This is an older downstream experiment, not inherently a 4.32 requirement. |

The current Iris widget no longer uses `ReactRpcWidget`/`RpcJson`, nor the
removed `ResolvedRef`/`ExprWithCtx.save`/`Rpc.resolve` adapters. It uses ordinary
`ReactWidget`/`Surface`, native RPC Promises, and real `WithRpcRef` snapshots.
Check consumers before proposing removal of the legacy bridge; isolate any
removal from required compatibility changes and retain the donor for recovery.
Do not restore obsolete adapters just to make an old fixture compile.

The two later commits are generic shell fixes:

- `b6eed32` preserves message/code from plain RPC rejections instead of showing
  `[object Object]`; its formatter also handles native/aggregate/cyclic errors.
- `8032fd3` skips revision polling before initial installation, preventing
  repeated supersession of a slow initial package load.

An independent upstream port already exists under the RPC owner's coordination.
Check its current disposition before doing duplicate work. When incorporated
in the selected upstream base, retain the upstream implementation/regressions
and drop redundant compatibility patches. Initial-load acceptance is not a
claim of general hot-reload or server-restart recovery. The user's original
hidden error was not captured, so do not claim its unique cause is known.

Other Iris requests (checked Nat-to-JS-number conversion, `useId`, async/error
authoring, typed RPC builders and runtime staging) have separate owners or
triage. Reconcile current implementations first; do not bundle those projects
into a compatibility refresh. At the donor pin, `JsValue.ofNat` returns BigInt,
so Iris uses JS-number conversions for native RPC indices/positions. This is
not evidence that arbitrary `Nat.toFloat` conversion is lossless.

## Build and cache constraints

Keep Lake's artifact cache enabled. For local commands use a writable cache
directory, for example on the existing development host:

```sh
export LAKE_ARTIFACT_CACHE=true
export LAKE_CACHE_DIR=/home/egallego/.cache/mathlib
export LAKE_RESTORE_ARTIFACTS=true
```

Choose an equivalent writable cache path elsewhere. Restoration materializes
cached module files for this pin's standalone package generator. The generator
does not consume Lake's resolved artifact mapping; cache-only package generation
is a separately tracked correctness gap. Restoration is a scoped workaround,
not a fix and not a reason to disable, clear or redesign the cache. The earlier
download trouble was weak internet; report slow/failed downloads to the user
before assuming a downloader defect.

Use the available Lean Beam skill for focused Lean edits and checkpoints, then
Lake for final dependency validation. Stop owned Beam sessions after changing
Lake configuration. A successful file checkpoint is not full package evidence.

The generated runtime is **not in Git**. A fresh checkout needs npm dependencies,
the matching Lean source and a WASI SDK, then a runtime build. In an owned,
isolated worktree with no shared source checkout to overwrite:

```sh
npm install
npm run fetch:lean
npm run install:wasi
git -C third_party/lean4-src rev-parse HEAD
lake env lean --version
lake build VirInfoview VirInfoviewFixtures VirBrowserFixtures VirRuntimeFixtures VirExamples vir_irpkg
VIR_SKIP_PACKAGES=1 npm run probe:upstream
npm run build:demo-package
```

Alternatively use `LEAN4_SRC` and `WASI_SDK_PATH` for verified existing inputs;
do not run a fetch/reset script against another agent's shared Lean source.
Never modify `third_party/lean4-src/src/library/ir_interpreter.cpp`.

The donor's tested `web/public/vir-upstream.wasm` has SHA-256
`8aca7930f8f0dee9bd88ee6aceb472dab45f3ded65d52740176f6da5dbec71e2`.
This identifies retained evidence, not an expected hash for a changed build.
Record the successor's source, toolchain, package and Wasm identities; never
substitute a 4.33/4.34 runtime because its file exists. Inspect current VIR SDK
staging support before inventing another installer, and coordinate consumer
adoption separately. Do not commit generated Wasm, packages or npm dependencies.

## Validation and evidence

These are the commands used for the PR #171/4.32 baseline, not a promise that
future main retains every script. Reconcile names and prerequisites against the
selected code and `docs/HARNESS.md`; preserve equivalent acceptance coverage.
After the setup/build above:

```sh
npm run check:lean-bindings
npm run test:bindings:unit
npm run test:infoview
npm run test:infoview:browser
node --test tests/infoview/widget-errors.test.mjs
node --test tests/runtime/collection-type-fidelity.test.mjs tests/runtime/object-type-fidelity.test.mjs tests/runtime/promise-type-fidelity.test.mjs tests/infoview/rpc-test-support.test.mjs tests/infoview/rpc-browser-harness.test.mjs
node tests/runtime/runner.mjs module-input module-cli
node scripts/packages/generate-browser-package.mjs --package fixtures-basic --package pretty-printer --package fixtures-lean --copy-public
node tests/runtime/infoview-rpc-promise-smoke.mjs
git diff --check
```

Recorded baseline evidence: fresh Lean build; zero unresolved strict-link
symbols; 94 binding units; 31 focused host/RPC harness units; module snapshots;
native RPC/lifetime browser acceptance; module-input/CLI and RPC/Promise runtime
smokes. The two shell fixes additionally passed four formatter units and the
downstream slow-startup regression. **The full VIR `npm test` suite was not run
for this donor.** Do not turn these historical results into current-head CI
claims. This handoff changes docs only and does not rerun those builds.

## Iris acceptance boundary

Published consumer: [ejgallego/iris-lean, feat/proof-mode-widget](https://github.com/ejgallego/iris-lean/tree/feat/proof-mode-widget),
review checkpoint `5cd3241fd75da40da3f1cb5c71119f5ed1fbb626`. Its Lake workspace
is `Iris/`; its lakefile and manifest pin exact VIR `8032fd3`. Any local Iris
namespace cleanup or later edits remain owned by the Iris agent, not this lane.

Goal provenance must remain:
saved Lean goal context -> instantiated target -> `Iris.ProofMode.parseIrisGoal?`
-> typed `IrisGoal`/`Hyps` -> display model. Tagged proposition leaves retain
contextual expressions in a native snapshot; no pretty-printed goal parsing,
JSON copying of reference objects, or reattachment by display strings.

Ask the Iris owner to validate a proposed exact pin in an isolated consumer
worktree with a matching rebuilt runtime. From its `Iris/` workspace, with the
cache environment above and no active owned Beam session:

```sh
lake build IrisTest.ProofMode.Widget IrisTest.ProofMode.WidgetDemo +Iris.ProofMode.Widget:vir
lake test
```

Then from that worktree's root:

```sh
node scripts/widget-runtime-smoke.mjs
node scripts/widget-browser-smoke.mjs
IRIS_WIDGET_RELOAD_MS=1000 IRIS_WIDGET_PACKAGE_DELAY_MS=2200 node scripts/widget-browser-smoke.mjs
git diff --check
```

The donor passed these checks: 38 package members, format 11, 1,136 declarations
(1,038 IR / 98 native), two exports; 37/40 actual RPC calls in the normal/delayed
browser runs at 360 px. Coverage includes canonical text, nested binder types,
repeated occurrences, keyboard activation, stale successes/failures, split-goal
DOM/ARIA isolation, empty non-Iris goals, readable errors and slow startup.
SSR only checks package loading/factory/mount; it does not execute RPC effects.
The user confirmed basic VS Code usability, not exhaustive accessibility,
retention/performance, released-reference or server-restart acceptance.

Consumer architecture and detailed historical evidence:

- [Maintainer guide](https://github.com/ejgallego/iris-lean/blob/5cd3241fd75da40da3f1cb5c71119f5ed1fbb626/docs/widget-maintainer-guide.md)
- [Native RPC migration](https://github.com/ejgallego/iris-lean/blob/5cd3241fd75da40da3f1cb5c71119f5ed1fbb626/docs/widget-native-rpc.md)
- [Compatibility refresh history](https://github.com/ejgallego/iris-lean/blob/5cd3241fd75da40da3f1cb5c71119f5ed1fbb626/docs/vir-v432-refresh.md)
- [Shell fixes](https://github.com/ejgallego/iris-lean/blob/5cd3241fd75da40da3f1cb5c71119f5ed1fbb626/docs/widget-shell-errors.md)
- [API review at the donor pin](https://github.com/ejgallego/iris-lean/blob/5cd3241fd75da40da3f1cb5c71119f5ed1fbb626/docs/vir-widget-api-review.md)

## Return a concrete maintenance checkpoint

Deliver the exact upstream base, compatibility head, scoped diff, remaining
4.32 adaptations and disposition of the old RPC bridge/shell patches. Include
toolchain/source/Wasm identities, commands actually run, results and explicit
gaps. Distinguish producer validation from Iris-owner acceptance and identify
any API migration the consumer would need.

Keep the working Iris pin, donor branches and artifacts reachable. Report a
proposed successor for review rather than silently adopting it, force-pushing
an older compatibility branch, or claiming maintenance complete merely because
the toolchain file was downgraded.
