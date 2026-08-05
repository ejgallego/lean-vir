# Artifact sets

An artifact set is the immutable compatibility unit used by a benchmark report.
Producer packages retain their own metadata and checksums; this application
asserts that one VIR bounded runtime, one native FIR bounded runtime, and one
LLVM bounded runtime implement the same browser-visible contract.

Conceptually, a component is a dependent pair:

```text
Σ (leanVersion), boundedRuntime leanVersion × prettyMWorkload leanVersion
```

The Lean version lives inside the component. The set does not require all
components to share it. Nothing at the browser boundary passes Lean heap values
between candidates; it passes the common compact Format model and compares
rendered text plus complete styling events.

## Roles

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
artifacts/               currently staged browser inputs
```

`_artifacts/`, `artifacts/`, `dist/`, and `_results/` are ignored. The
configuration and lockfile are committed.

## Assemble a candidate

1. Copy complete producer packages into `_artifacts/seed/`.
2. Update `artifact-set.config.json` with the set ID and exact provenance.
3. Run `npm run artifacts:pack`.
4. Review the generated manifest under `_artifacts/releases/`.
5. Import the generated tar through the same consumer path:

   ```sh
   npm run artifacts:fetch -- --archive _artifacts/releases/<archive>.tar
   npm test
   ```

6. Run at least one real differential report. Performance campaigns remain a
   controlled-machine operation rather than a hosted-runner gate.

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

1. Set `archive.url` in `artifact-set.lock.json` to the exact HTTPS release
   asset URL.
2. Change `status` to `published`; do not change any digest or byte count.
3. Open a lockfile PR. CI runs `npm run artifacts:fetch` and `npm test` from a
   clean clone.
4. Mark the release stable after the lockfile PR passes and merges. Promotion
   changes release visibility, not bytes.

The first pass is intentionally manual. Producer-owned releases, attestations,
and automated promotion can be added after this path has been exercised.

## Verification boundary

The fetcher verifies archive size and SHA-256 before extraction. Its tar reader
accepts only normalized regular files and rejects absolute paths, `..`, empty
segments, backslashes, duplicates, links, unsupported member types, bad header
checksums, and truncated members. It then rejects undeclared files, verifies
the manifest digest, recomputes `SHA256SUMS`, and verifies every member size and
digest before atomically installing the set.

The staged top-level manifest is copied into the built site. Reports should
record its set ID and digest in addition to the browser-observed asset hashes.

## Set 0001

`prettyM-bounded-set-0001` contains three independent bounded runtimes. Its VIR
interpreter and `prettyM` IR package use Lean 4.33.0-rc2 and the exact prototype from
[`ejgallego/lean-vir` PR #104](https://github.com/ejgallego/lean-vir/pull/104),
commit `64e30784da16957cca92951344d776f895b30491`, built with WASI SDK 33. Native
FIR and LLVM/Emscripten each carry Lean 4.32. Their isolation is explicit in
the component-local `lean`, `runtime`, and `workload` manifest fields.
