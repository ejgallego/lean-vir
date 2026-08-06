# Handoff: standalone prettyM benchmark webapp

Last verified: 2026-08-06

## Resume here

- Worktree: `/home/egallego/lean/vir/.worktrees/pretty-benchmark-webapp`
- Branch: `feat/pretty-benchmark-webapp`
- Starting commit before this handoff: `b8e53e8`
- Application root: `benchmarks/prettyM-web/`

Read `/home/egallego/lean/vir/AGENTS.md`, this file, and
`benchmarks/prettyM-web/README.md` before changing anything. Keep generated
artifacts and reports inside this worktree. Do not push unless the user asks.

## Purpose and repository boundary

`benchmarks/prettyM-web/` is the extracted, standalone five-backend benchmark
application. The directory is deliberately movable as a future repository
root. It has no runtime dependency on Verso Slides, Reveal, Lake, or the parent
VIR source tree.

This worktree owns:

- the common compact `Std.Format` workload and semantic result contract;
- JavaScript, VIR JSON, VIR direct-Format, FIR-native, and LLVM backends;
- marshal, execute, decode, total, startup, repeated-call, and memory studies;
- corpus, one-axis scaling, and interaction workloads;
- report/campaign JSON, the dashboard, and forwardable performance cards; and
- immutable bounded-runtime artifact-set assembly and verification.

It does not own VIR interpreter profiling or optimization. Resume that work in
`/home/egallego/lean/vir/.worktrees/pr104-internal-counters`; import only stable
summaries or refreshed bounded artifacts here.

## Completed state

- Benchmark execution was removed from the slide runtime and fully extracted
  into `benchmarks/prettyM-web/`.
- Five-backend output and styling-event parity is the compatibility gate.
- The app has standalone build, serve, browser-test, report, campaign, card,
  and refresh commands.
- Artifact paths are confined to the application directory and archives are
  normalized, checksummed, verified, and installed atomically.
- The artifact boundary is generic over Lean versions:

  ```text
  Sigma (leanVersion), boundedRuntime leanVersion x prettyMWorkload leanVersion
  ```

- Set `prettyM-bounded-set-0001` combines VIR/Lean 4.33.0-rc2 at exact PR #104
  commit `64e3078` with native and LLVM bounded runtimes carrying Lean 4.32.
- The final PR #104 bounded validation report is locally available at
  `benchmarks/prettyM-web/_results/pr104-bounded-validation.json` when the
  ignored results directory has been preserved.

The current artifact lock is `local-prototype`: its archive digest and size are
committed, but `archive.url` is intentionally null. Public artifact publication
is unfinished rather than broken.

## Immediate status

This worktree is paused while VIR-internal attribution proceeds. Do not add the
VIR CPU profiler, internal counters, or an interpreter optimization here. The
next change in this worktree should be one of:

1. refresh an individual bounded runtime after its producer publishes a new
   complete package;
2. publish and lock the existing immutable set archive; or
3. import a stable VIR profiling conclusion into a report/card without adding
   VIR-specific execution machinery.

Do not generalize the benchmark engine to arbitrary Lean functions until a
second real function supplies concrete requirements. The current
`prettyM`-specific design is intentional.

## Commands

Run application commands from `benchmarks/prettyM-web/`:

```bash
npm install
npm run artifacts:fetch -- \
  --archive _artifacts/releases/prettyM-bounded-set-0001-26f54081e15145b6.tar
npm test
npm run dev
```

The development server listens on `http://127.0.0.1:18334` and supplies the
cross-origin-isolation headers required by threaded LLVM Wasm.

With the server running:

```bash
npm run report
npm run campaign
npm run cards
```

For a complete local refresh without publication:

```bash
npm run refresh
```

See `benchmarks/prettyM-web/docs/ARTIFACT_SETS.md` before modifying the lock or
publishing artifacts. Never point it at a mutable `latest` URL.

## Validation expectations

Before handing off a benchmark or artifact change:

- run `npm test` inside the application directory;
- require exact rendered-text and styling-event parity at every point;
- preserve phase timing rather than moving work into an unmeasured adapter;
- record candidate-local Lean/runtime/adapter/workload provenance; and
- keep reports and binaries ignored while committing their configuration,
  summaries, and immutable digests.

## Related continuation point

VIR internal counters and the next sampled-profile experiment are documented
in:

```text
/home/egallego/lean/vir/.worktrees/pr104-internal-counters/HANDOFF.md
/home/egallego/lean/vir/.worktrees/pr104-internal-counters/docs/INTERPRETER_COUNTERS.md
```
