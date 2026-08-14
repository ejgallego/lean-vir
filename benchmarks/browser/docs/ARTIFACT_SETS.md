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
  and packs one composite candidate without rewriting producer bytes.

Adapters are part of their producer components. Marshal and decode timings
depend on them, so an adapter change is a candidate change.

## Workspace layout

All generated data stays inside the movable application directory:

```text
_artifacts/
  seed/                 validated producer inputs used by the packer
  pack/<set-id>/        normalized assembly directory
  releases/             ignored deterministic tar and inspection files
  downloads/            verified download cache
  sets/<set-id>/        verified extracted immutable sets
artifacts/
  <example-id>/          one independently staged example
```

`_artifacts/`, `artifacts/`, `dist/`, and `_results/` are ignored. The
source-build catalog is committed; generated locks remain with their candidate
payloads and are not committed.

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
   lock is written below ignored `_artifacts/releases/`.
4. Review the generated manifest under `_artifacts/releases/`.
5. Import the generated tar through the same consumer path:

   ```sh
   LOCK_PATH=_artifacts/releases/example-set.lock.json
   ARCHIVE_PATH=_artifacts/releases/example-set-digest.tar
   npm run artifacts:fetch -- \
     --lock "$LOCK_PATH" \
     --archive "$ARCHIVE_PATH"
   npm run test:unit
   npm run test:example -- EXAMPLE VARIANT
   ```

6. Review the differential report. Performance campaigns remain a
   controlled-machine operation rather than a hosted-runner gate.

CI implements these correctness steps as a candidate build and uploads the
resulting archive and source receipt as a short-lived Actions artifact. Hosted
runners establish parity and package integrity, not a performance conclusion.

Packing is deterministic: members are sorted, regular-file-only, mode 0644,
UID/GID zero, and timestamp zero. Repacking unchanged inputs must reproduce the
same archive digest.

## Deployment lifecycle

The project has no publication, promotion, or accepted-lock phase. Candidate
locks exist only to re-import and verify the exact tar produced by the current
build. Pull-request validation and the Pages build retain their own candidate
payloads as short-lived Actions artifacts; Pages deploys the candidate it built
and validated in that job. An explicit HTTPS URL in a lock remains supported
for transport when needed, but does not define repository state or a release
policy.

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
manifest provenance and selected example/variant test-package digest; newly
packed manifests bind that digest as well. prettyM runtime profiles additionally
hash the manifest and every browser-observed runtime asset.

## Catalog authority

`artifact-builds.json` is the single source of truth for current set IDs,
producer revisions, workload revisions, and component files. Generated locks
record the exact archive digest for one build; documentation deliberately does
not duplicate changing source pins.
