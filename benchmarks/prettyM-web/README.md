# Lean prettyM benchmark webapp

This directory is a standalone browser application for comparing five
`Std.Format.prettyM` implementations. It intentionally has no dependency on
Verso, Reveal, Lake, or the parent VIR repository's source tree.

The complete application can be moved to the root of another repository. The
root-level VIR npm commands are convenience pointers only and are not used by
this package.

## Responsibilities

- load the JavaScript, VIR JSON, VIR typed-Format, native FIR Wasm, and
  LLVM/Emscripten candidates;
- verify exact rendered-text and styling parity;
- collect marshal, execute, decode, and total timings;
- run corpus, scaling, interaction, retained-memory, and repeated-call studies;
- collect cold-start and isolated-runtime observations in fresh browser contexts;
- aggregate multiple fresh browser processes and generate forwardable cards;
- display reports and campaigns, and import/export their JSON representation.

The slide deck is not part of this application. It may link here or present a
recorded report, but benchmark execution does not initialize Reveal or use
slide DOM state.

## Artifact contract

The committed `artifact-set.lock.json` selects one immutable, compatible set.
Binary artifacts and downloaded release archives remain ignored by Git. The
current prototype lock has no public URL yet; assemble and consume it locally:

```sh
npm run artifacts:pack
npm run artifacts:fetch -- \
  --archive _artifacts/releases/<generated-archive>.tar
```

`artifacts:pack` reads a validated `_artifacts/seed/` with this layout:

```text
lean-vir/js/vir-runtime.js
lean-vir/wasm/vir-upstream.wasm
prettyM-vir.irpkg
lean-native/{BUILD.json,prettyM-browser-adapter.mjs,prettyM.wasm,prettyM.wasm.json}
lean-llvm/{README.md,SHA256SUMS,emscripten-loader.mjs,
           prettyM-emscripten-adapter.mjs,prettyM.manifest.json,
           prettyM.mjs,prettyM.wasm}
```

It writes a deterministic normalized tar, member checksums, an
`ARTIFACT_SET.json` compatibility manifest, and the lockfile. The fetcher
verifies the outer archive before extraction, rejects unsafe tar members,
verifies every extracted member, installs it atomically under
`_artifacts/sets/`, and stages it. Every input, cache, set, and output path is
restricted to this application directory.

Once the archive is uploaded as an immutable release asset, set its exact HTTPS
URL in the lockfile and change the status from `local-prototype` to `published`.
Clean clones can then use `npm run artifacts:fetch` without an override. See
`docs/ARTIFACT_SETS.md` for producer, promotion, and publication details.

The artifact set is generic over Lean versions. Each candidate is a complete
bounded runtime carrying its own Lean version, runtime, adapter, and `prettyM`
workload. The browser only observes the common semantic input/output and timing
contract. Set 0001 intentionally combines a VIR runtime and workload built with
Lean 4.33.0-rc2 at the exact PR #104 head (`64e3078`) with native and LLVM
bounded runtimes built with Lean 4.32. Five-backend parity is the compatibility
gate; no cross-backend Lean heap values are exchanged.

The current VIR package retains the historical
`VersoSlides.Pretty.*ForVir` export names. They are declared in `src/config.js`
as artifact compatibility data; the application itself does not load Verso or
depend on slide sources. Renaming those two exports can accompany a later
artifact refresh without changing the benchmark or dashboard APIs.

## Develop and test

```sh
npm install
npm run artifacts:fetch
npm run build
npm run dev
```

Open <http://127.0.0.1:18334>. The included server supplies the cross-origin
isolation headers required by threaded LLVM Wasm. `_headers` and `.htaccess`
files are included at the root of `dist/` for static hosts; configure equivalent
headers when the hosting platform does not consume either format.

Run the browser regression with:

```sh
npm test
```

Set `CHROMIUM` to an alternate Chrome/Chromium executable when necessary.

## Reproducible reports

With the app server running, collect one full report from a separate browser
process:

```sh
npm run report
```

The default output is `_results/pretty-benchmark.json`. Result paths are kept
inside this directory and ignored by Git. The collector includes five
fresh-context startup profiles, retained and isolated memory, and isolated
repeated-call traces for the two VIR entry points. The earlier independent JSON
round-trip control is intentionally no longer collected; the two VIR backends
still preserve the useful string-ABI versus direct-Format comparison.

For process-to-process variability and owner-ready summaries:

```sh
npm run campaign
npm run cards
```

`campaign` launches the Node collector in fresh processes and writes both JSON
and Markdown. `cards` turns the default report into VIR-001 through VIR-003.
Both Python scripts use only the standard library; browser automation continues
to use this package's Playwright dependency.

The complete local refresh is:

```sh
npm run refresh
```

It stages the installed locked set (or the validated in-tree seed), builds and serves the app,
collects a report, refreshes cards, and runs a three-process campaign. It never
publishes or reads artifact directories outside this application.

## Spin-off boundary

The future repository root is exactly this directory. Source, styles, build and
serve scripts, browser tests, package metadata, licensing files, documentation,
and the artifact input contract are all contained here. The app uses only
browser APIs and its own npm development dependency.

The benchmark engine is still deliberately `prettyM`-specific. Generalizing
the sampler for unrelated Lean functions should happen only after a second
function supplies concrete requirements.
