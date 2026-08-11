# Handoff: browser benchmark catalog and artifact pipeline

Last verified: 2026-08-11

## Resume here

- Worktree: `/home/egallego/lean/vir/.worktrees/artifact-example-catalog`
- Branch: `feat/artifact-example-catalog`
- Starting checkpoint for this consolidation: `26d2682`
- Application root: `benchmarks/prettyM-web/`

Read `/home/egallego/lean/vir/AGENTS.md`, this file, and
`benchmarks/prettyM-web/README.md` before changing anything. Keep generated
artifacts and reports inside this worktree. Do not push unless the user asks.

## Purpose and repository boundary

`benchmarks/prettyM-web/` is the extracted, standalone browser benchmark
catalog. The directory is deliberately movable as a future repository root.
It has no runtime dependency on Verso Slides, Reveal, Lake, or the parent VIR
source tree. VIR happens to host the application today; producer source stays
in the repositories that own it.

This worktree owns:

- a compact example descriptor and catalog;
- the `Std.Format.prettyM` and Illuminate player examples at the same level;
- JavaScript, VIR, FIR-native, and LLVM backends selected per example;
- marshal, execute, decode, total, startup, repeated-call, and memory studies;
- corpus, one-axis scaling, and interaction workloads;
- report/campaign JSON, the dashboard, and forwardable performance cards; and
- source-build receipts, immutable artifact-set assembly and verification, and
  generic per-example staging.

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

- Historical set `prettyM-bounded-set-0001` combines VIR/Lean 4.33.0-rc2 at
  exact PR #104 commit `64e3078` with native and LLVM bounded runtimes carrying
  Lean 4.32. It remains immutable and uses the legacy unnamespaced format.
- The build catalog now targets `prettyM-bounded-set-0002`, retains the VIR and
  workload revisions, selects merged FIR `298682a`, and namespaces all payload
  files below `prettyM/`.
- The generic v2 stager derives the example from `ARTIFACT_SET.json`, replaces
  only `artifacts/<example-id>/`, and preserves sibling examples. There are no
  prettyM- or Illuminate-specific canonical set adapters.
- The browser derives verified/rehearsal/unverified status from the staged
  example manifest instead of controller labels.
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

Source-build preparation is now application-owned. The canonical
`benchmarks/prettyM-web/artifact-builds.json` record names the exact VIR, FIR,
and workload commits, producer entry points, package mappings, dependencies,
and pack provenance. `npm run artifacts:build` resolves that record against
clean materialized sources or configured FIR/VIR toolchains, validates producer
packages, and assembles the seed without running performance measurements.
Its schema-v2 receipt records only portable identities and hashes; checkout and
config paths do not leak into CI payloads. Packing reads the same record and
refuses a seed that does not match the receipt. See
`benchmarks/prettyM-web/docs/ARTIFACT_BUILDS.md`.

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

The full `prettyM` source build previously passed with merged FIR `main` at
`298682a766d80e90053d3e76ee2f3e4af78a52aa`, including the native marshaling
change. VIR, FIR native, and FIR LLVM produced complete packages; the
producer-local checks passed, native and LLVM agreed on exact traces, and the
assembled candidate passed the application's tool, artifact-set, and
five-backend browser smoke tests. The latest rehearsal materialized all three
sources below the application-local `_sources/` directory, exactly as CI will.
Its receipt is
`benchmarks/prettyM-web/_artifacts/builds/prettyM/BUILD.json`, and its candidate
archive has SHA-256
`531ac9af7a6ae48e07384edae6f86fb174d0a2c66e0184f2f3116d2df1fca1f6`
and size 2,680,320 bytes. No performance measurement was collected.

The committed set-0001 lock and its `26f54081e15145b6...` archive remain
deliberately unchanged. The application-local ignored `artifacts/prettyM/`
tree is a relocated rehearsal of the previously built bytes and does not carry
a v2 `ARTIFACT_SET.json`; the UI correctly labels it unverified. Fresh
source-built archives can differ from set 0001 despite matching source and
toolchain identities. Treat any source-built archive as a candidate, not a
silent lock refresh.

Keep producer worktrees in controlled, ignored locations rather than `/tmp`.
The validated candidate layout is the self-contained
`benchmarks/prettyM-web/_sources/{vir,fir,workload}` tree populated from the
catalog. Existing clean linked worktrees may still be passed explicitly to the
lower-level source builder, but they are not part of the CI contract.

The current VIR `.irpkg` generator embeds generation time and source-path
spelling. Source identity is exact, but fresh VIR packages are not yet expected
to reproduce an old archive digest byte-for-byte. The CI candidate-build path
is now prepared in `.github/workflows/prettyM-candidate.yml`. It materializes
each exact catalogued source below `benchmarks/prettyM-web/_sources/`, runs the
source build, packs to a separate candidate lock, re-imports and tests the
archive, and uploads the archive plus checksums, manifests, and source receipt.
It does not compare fresh bytes with the current lock or publish/promote them.
The workflow still needs to run on GitHub before its hosted-runner setup and
uploaded payload can be accepted as the validation record.
The workflow now produces the namespaced set-0002 candidate and a separate
ignored candidate lock. Deterministic VIR package metadata and the remaining
Wasm byte differences are separate consolidation work before lock replacement
becomes automatic.

The report UI consolidation was completed after the original handoff. Its
browser regression narrows the dashboard to one backend, checks that chart
series are filtered, opens the corpus report, and verifies that the selection
persists. A full preserved report was also used to exercise scaling, memory,
repeated-call, and interaction filters without changing the report data.

The second real client is Illuminate. Keep workload execution in each example
controller; generalize only the source/package/staging boundary demonstrated by
both examples. Illuminate remains a non-publishable rehearsal until its owning
repository provides source-package-v1 producer entry points and the catalog can
build it without application-side package knowledge.

## Commands

Run application commands from `benchmarks/prettyM-web/`:

```bash
npm install
npm run artifacts:build -- prettyM --plan
npm run build
npm test
npm run dev
```

After building and packing a fresh set-0002 candidate, import it through the
consumer path:

```bash
npm run artifacts:pack -- --build prettyM
npm run artifacts:fetch -- \
  --lock _artifacts/releases/prettyM-bounded-set-0002.lock.json \
  --archive _artifacts/releases/<generated-archive>.tar
```

Do not feed the legacy set-0001 archive to the generic stager. It remains
verifiable as historical input, but canonical staging requires namespaced
artifact-set schema v2.

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
