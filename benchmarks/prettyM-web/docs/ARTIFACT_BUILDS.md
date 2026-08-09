# Source artifact builds

`artifact-builds.json` is the canonical catalog of buildable benchmark
examples. A build record names its example and staging adapter, exact Git
sources, the local checkout roles needed to resolve them, the producer entry
points, the expected package files, component dependencies, artifact-set lock,
and the provenance consumed by the packer. `prettyM` is the first record; it is
not a default baked into the catalog tools.

Machine-specific paths are deliberately absent from the catalog. Resolve each
source to an existing checkout when invoking the driver:

```sh
npm run artifacts:build -- --list

npm run artifacts:build -- prettyM \
  --checkout vir=/path/to/lean-vir-at-the-catalogued-commit \
  --checkout fir=/path/to/lean-fir-at-the-catalogued-commit \
  --checkout workload=/path/to/verso-slides-at-the-catalogued-commit \
  --plan
```

Producer source remains in its owning repository at the immutable catalogued
commit. The artifact application contains only the source URL, commit, package
contract, and output mapping. It never vendors producer source.

CI and self-contained local builds materialize the exact sources into the
ignored application-local directory with:

```sh
npm run artifacts:sources -- prettyM
```

The command initializes detached Git checkouts by fetching each exact commit.
It refuses to switch, clean, or reuse a checkout whose origin, revision, or
working tree does not match the catalog. The controlled layout is:

```text
_sources/vir/       lean-vir at the catalogued commit
_sources/fir/       lean-fir at the catalogued commit
_sources/workload/  verso-slides at the catalogued commit
```

Maintainers may still pass a different clean checkout explicitly to
`artifacts:build`; this is useful when an existing linked worktree already has
the selected commit. `_sources/` holds source checkouts and producer caches
only. `_artifacts/` remains the builder-owned output area, and only declared
package files cross between the two.

The driver defaults npm's cache to `_artifacts/npm-cache`, keeping setup writes
inside the application checkout. Set `NPM_CONFIG_CACHE` explicitly only when a
different controlled cache is desired.

The driver never fetches, switches, or edits source revisions. Each path must
be the root of a clean Git checkout whose `HEAD` is the catalog's full commit.
This keeps local worktree policy outside the portable build description.

Remove `--plan` to build all components and atomically replace
`_artifacts/seed`. Prepared checkouts can build directly. Add `--prepare` for a
fresh checkout; the catalog then runs the VIR npm setup and the FIR
Emscripten/Lean-runtime setup before their respective builds. These setup steps
may download toolchains and are intentionally explicit.

## Producer package contract

Every component declares `browser-benchmarks/source-package/v1`. The builder
supplies verified checkout roots and a fresh output path. A producer must:

1. build only from those checkout revisions and its pinned toolchain;
2. write a complete package below the supplied output path;
3. include its adapter because marshaling and decoding are measured behavior;
4. include self-describing metadata and checksums; and
5. return success only after its package-local smoke or differential checks
   pass.

The initial adapters use the producer entry points that already exist:

- VIR: `npm run build:demo:release`, `lake exe vir_irpkg`, and the checkout's
  browser-runtime bundler;
- FIR native: `integration/talos/artifact/package-pretty-format.sh OUTPUT`;
- FIR LLVM: `integration/lcnf-c-wasm/package-prettyM-emscripten.sh OUTPUT`, with
  the just-built native package supplied for its differential check.

The builder validates package metadata against the catalog, verifies producer
checksums, and copies only the declared regular files into the seed. It does not
rewrite producer bytes. FIR LLVM depends on FIR native because its producer
validates exact output equivalence against that package.

The generated `_artifacts/builds/<build-id>/BUILD.json` is a local receipt. It
records the catalog digest, resolved checkout commits, adapters, and staged
file hashes. It is evidence about one invocation, not a second source of build
configuration and not part of the published artifact set.

## Assemble the immutable set

The packer reads the same catalog record, so source provenance is no longer
duplicated in a separate artifact-set config:

```sh
npm run artifacts:pack -- --build prettyM
npm run artifacts:fetch -- \
  --lock artifact-set.lock.json \
  --archive _artifacts/releases/<archive>.tar
npm test
```

Building and packing remain separate. A newly generated producer byte changes
the archive digest; it must be reviewed and validated before replacing a lock
or benchmark report. Performance measurement is never part of this source
build command.

The source-package v1 contract guarantees exact source identity and validated
package output; it does not yet promise byte-for-byte reproducibility of every
producer. In particular, the current VIR package manifest embeds its generation time and the
spelling of the workload source path. Until VIR exposes deterministic metadata,
CI should generate and test a candidate archive rather than expect a fresh
`.irpkg` to reproduce the committed archive digest.

## CI candidate build

The complete non-publishing path is available locally as:

```sh
npm run artifacts:sources -- prettyM
npm run artifacts:candidate -- prettyM --prepare
```

The candidate command runs the source builder, packs with a separate ignored
lock, imports the generated archive through `artifacts:fetch`, runs `npm test`,
and collects the upload payload under
`_artifacts/candidates/prettyM/upload/`. The payload contains the immutable tar,
its checksum, the artifact-set manifest, the source `BUILD.json` receipt, the
candidate-only lock, and a `CANDIDATE.json` validation statement.

`.github/workflows/prettyM-candidate.yml` runs the same commands on relevant
pull requests and `main` updates and supports explicit dispatch. The workflow
has read-only repository permission and uploads only a short-lived Actions
artifact. It neither compares the candidate bytes with the committed lock nor
publishes or promotes them.
