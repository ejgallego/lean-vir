# Artifact sets

An artifact set is the immutable compatibility unit used by one example's
benchmark report. Producer packages retain their own metadata and checksums;
the catalog record declares which components jointly implement that example's
browser-visible contract. The current `prettyM` set has VIR, native FIR, and
LLVM components, but the set format does not require those names or count.

Conceptually, a component is a dependent pair:

```text
Σ (leanVersion), boundedRuntime leanVersion × exampleWorkload leanVersion
```

The Lean version lives inside the component. The set does not require all
components to share it. Nothing at the browser boundary passes Lean heap values
between candidates; it passes the common compact Format model and compares
rendered text plus complete styling events.

## Current prettyM roles

- VIR produces one matching unit: release interpreter Wasm, bundled browser
  runtime, and the `prettyM` IR package compiled with that runtime's Lean
  version.
- Native FIR produces its Wasm, descriptor, adapter, and `BUILD.json`.
- LLVM produces its Emscripten module, Wasm, loader, adapter, manifest, and
  checksums.
- The benchmark maintainer selects compatible producer outputs, runs parity,
  and publishes one composite set without rewriting producer bytes.

Adapters are part of their producer components. Marshal and decode timings
depend on them, so an adapter change is a candidate change.

## Workspace layout

All generated data stays inside the movable application directory:

```text
_artifacts/
  seed/                 validated producer inputs used by the publisher
  pack/<set-id>/        normalized assembly directory
  releases/             deterministic tar and inspection files
  downloads/            verified download cache
  sets/<set-id>/        verified extracted immutable sets
artifacts/
  <example-id>/          one independently staged example
```

`_artifacts/`, `artifacts/`, `dist/`, and `_results/` are ignored. The
source-build catalog and the accepted lock are committed.

## Assemble a candidate

1. Select a canonical example build from `artifact-builds.json` and resolve
   its exact sources to clean local checkouts. Materialize the default
   `_sources/` layout with `artifacts:sources`, or select existing FIR/VIR
   producer checkouts with `--toolchain [NAME=]PATH` or a toolchain config.
   Run the source builder for the selected `BUILD`; see `ARTIFACT_BUILDS.md`.
2. Review the portable source-build receipt and validated `_artifacts/seed/`.
   The packer refuses a seed whose catalog, example, source pins, adapters, or
   file hashes differ from that receipt.
3. Run `npm run artifacts:pack -- --build BUILD`. By default its candidate
   lock is written below ignored `_artifacts/releases/`; writing a tracked lock
   always requires an explicit `--lock`.
4. Review the generated manifest under `_artifacts/releases/`.
5. Import the generated tar through the same consumer path:

   ```sh
   npm run artifacts:fetch -- \
     --lock LOCK \
     --archive _artifacts/releases/<archive>.tar
   npm test
   ```

6. Run at least one real differential report. Performance campaigns remain a
   controlled-machine operation rather than a hosted-runner gate.

CI implements steps 1–5 as a candidate build and uploads the resulting archive
and source receipt as a short-lived Actions artifact. It deliberately omits
step 6: hosted runners establish correctness and package integrity, not a
performance conclusion.

Packing is deterministic: members are sorted, regular-file-only, mode 0644,
UID/GID zero, and timestamp zero. Repacking unchanged inputs must reproduce the
same archive digest.

## Publish and promote

Upload these three files to a prerelease owned by the benchmark project:

```text
<set-id>-<digest-prefix>.tar
<set-id>-<digest-prefix>.tar.sha256
<set-id>.manifest.json
```

Never replace those assets and never point the lockfile at a mutable `latest`
URL. After upload:

1. Copy the reviewed candidate lock to the application's accepted lock and set
   `archive.url` to the exact HTTPS release asset URL.
2. Change `status` to `published`; do not change any digest or byte count.
3. Open a lockfile PR. Before merge, validate the accepted URL and lock by
   running `npm run artifacts:fetch` and `npm test` from a clean clone. The
   current candidate workflow does not implement this consumer check; add it
   when the first immutable v2 archive is promoted.
4. Mark the release stable after the lockfile PR passes and merges. Promotion
   changes release visibility, not bytes.

The first pass is intentionally manual. Producer-owned releases, attestations,
and automated promotion can be added after this path has been exercised.
The CI candidate workflow does not enter this section: Actions artifact upload
is evidence transport, not publication or promotion.

## Verification boundary

The fetcher verifies archive size and SHA-256 before extraction. Its tar reader
accepts only normalized regular files and rejects absolute paths, `..`, empty
segments, backslashes, duplicates, links, unsupported member types, bad header
checksums, and truncated members. It then rejects undeclared files, verifies
the manifest digest, recomputes `SHA256SUMS`, and verifies every member size and
digest before atomically installing the set.

The generic stager requires every payload member to live below the manifest's
`<example-id>/` namespace. It replaces only `artifacts/<example-id>/`, copies
the verified manifest into that directory, and preserves sibling examples.
The browser derives stage-time verification status from this copied manifest;
it does not independently rehash the whole set on page load. Missing manifests
are shown as rehearsal or unverified local state. Example reports retain the
manifest provenance; prettyM runtime profiles additionally hash the manifest
and every browser-observed runtime asset.

## Set 0001

`prettyM-bounded-set-0001` contains three independent bounded runtimes. Its VIR
interpreter and `prettyM` IR package use Lean 4.33.0-rc2 and the exact prototype from
[`ejgallego/lean-vir` PR #104](https://github.com/ejgallego/lean-vir/pull/104),
commit `64e30784da16957cca92951344d776f895b30491`, built with WASI SDK 33. Native
FIR and LLVM/Emscripten each carry Lean 4.32. Their isolation is explicit in
the component-local `lean`, `runtime`, and `workload` manifest fields.

Set 0001 is historical and must not be regenerated or assigned new source
bytes. Its committed lock remains `local-prototype` and has no public URL.

## Proposed set 0002

`prettyM-bounded-set-0002` is the candidate identity for the refreshed source
closure. It retains VIR `64e3078` and the Verso Slides workload `c16a6f8`, uses
merged FIR `298682a`, and places every payload below `prettyM/`. Only one
reviewed candidate digest may be promoted under this identity.
