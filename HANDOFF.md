# Handoff: standalone prettyM benchmark webapp

Last verified: 2026-08-06

## Resume here

- Worktree: `/home/egallego/lean/vir/.worktrees/pretty-benchmark-webapp`
- Branch: `feat/pretty-benchmark-webapp`
- Starting commit before this continuation: `21e8369`
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
- Dashboard, corpus, scaling, memory, repeated-call, and interaction views share
  one backend selection. The selection follows the user between report views,
  filters both charts and tables, and never changes complete JSON exports.
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
- VIR-002 imports two hash-identified public-`runtime.call` sampled captures
  from `benchmarks/prettyM-web/evidence/vir-pr104-runtime-call-profile.json`.
  Card generation rejects reports whose Lean version, runtime JS, runtime Wasm,
  or IR package does not match that evidence.
- A fresh full report from set 0001 passed 45/45 corpus cases, 32/32 scaling
  points, 36/36 interaction points, repeated calls, isolated repeats, and
  isolated memory collection. It is locally preserved at
  `benchmarks/prettyM-web/_results/pretty-benchmark.json` with SHA-256
  `e3f364dc6b91c5ea2bbcff6297ea8cef38ba695a1ce5448c9d2d826ea79994ee`.

The current artifact lock is `local-prototype`: its archive digest and size are
committed, but `archive.url` is intentionally null. Public artifact publication
is unfinished rather than broken.

## Immediate status

The stable public-call attribution is now imported without adding profiler code
to this application. Across two captures of both structural targets, 75.6-79.1%
of samples roll up to object-ABI import/result lifting and only 21.2-24.4% are
Wasm self samples. Eager `customInductiveShape` construction is the largest
self symbol. VIR-002 records the evidence classes, artifact hashes, caveats,
and a narrow runtime follow-up.

Do not add the VIR CPU profiler, internal counters, or an optimization here.
The producer-side one-entry symbol-MRU prototype has local AB/BA screens, but
this machine is frequently loaded and the observed deltas are not stable enough
for an accepted or rejected optimization conclusion. Treat them as
inconclusive, leave bounded set 0001 unchanged, and require measurements from a
controlled host before importing a decision.

The next change in this worktree should be one of:

1. refresh an individual bounded runtime after its producer publishes a new
   complete package;
2. publish and lock the existing immutable set archive; or
3. import an accepted/rejected producer-side optimization conclusion and
   regenerate the report/card against its new immutable package.

The report UI consolidation was completed after the original handoff. Its
browser regression narrows the dashboard to one backend, checks that chart
series are filtered, opens the corpus report, and verifies that the selection
persists. A full preserved report was also used to exercise scaling, memory,
repeated-call, and interaction filters without changing the report data.

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

`cards` also validates the committed VIR attribution against the report's exact
runtime JS, Wasm, package, and Lean version. An older or unrelated report is
rejected rather than silently receiving the imported conclusion.

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

The separate producer-side MRU experiment is active in
`/home/egallego/lean/vir/.worktrees/pr104-symbol-mru`. It currently has local
changes; do not modify or clean that worktree from this application task.
