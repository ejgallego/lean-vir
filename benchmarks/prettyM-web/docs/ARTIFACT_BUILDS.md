# Source artifact builds

`artifact-builds.json` is the canonical database of buildable benchmark
artifacts. A build record names exact Git sources, the local checkout roles
needed to resolve them, the producer entry points, the expected package files,
component dependencies, and the artifact-set provenance consumed by the
packer. `prettyM` is the first record.

Machine-specific paths are deliberately absent from the database. Resolve each
source to an existing checkout when invoking the driver:

```sh
npm run artifacts:build -- --list

npm run artifacts:build -- prettyM \
  --checkout vir=/path/to/lean-vir-at-the-catalogued-commit \
  --checkout fir=/path/to/lean-fir-at-the-catalogued-commit \
  --checkout workload=/path/to/verso-slides-at-the-catalogued-commit \
  --plan
```

For maintained local builds, keep external producer worktrees below the
ignored `_sources/` directory instead of an ephemeral system directory. In
this checkout the controlled layout is:

```text
_sources/fir/       lean-fir at the catalogued commit
_sources/workload/  verso-slides at the catalogued commit
```

The pinned VIR worktree remains alongside this application worktree under the
parent repository's `.worktrees/` directory. These locations hold source
checkouts and producer caches only; `_artifacts/` remains the builder-owned
output area.

The driver defaults npm's cache to `_artifacts/npm-cache`, keeping setup writes
inside the application checkout. Set `NPM_CONFIG_CACHE` explicitly only when a
different controlled cache is desired.

The driver never fetches, switches, or edits source revisions. Each path must
be the root of a clean Git checkout whose `HEAD` is the database's full commit.
This keeps local worktree policy outside the portable build description.

Remove `--plan` to build all components and atomically replace
`_artifacts/seed`. Prepared checkouts can build directly. Add `--prepare` for a
fresh checkout; the database then runs the VIR npm setup and the FIR
Emscripten/Lean-runtime setup before their respective builds. These setup steps
may download toolchains and are intentionally explicit.

## Producer package contract

Every component declares `prettyM-web/source-package/v1`. The builder supplies
verified checkout roots and a fresh output path. A producer must:

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

The builder validates package metadata against the database, verifies producer
checksums, and copies only the declared regular files into the seed. It does not
rewrite producer bytes. FIR LLVM depends on FIR native because its producer
validates exact output equivalence against that package.

The generated `_artifacts/builds/prettyM/BUILD.json` is a local receipt. It
records the database digest, resolved checkout commits, adapters, and staged
file hashes. It is evidence about one invocation, not a second source of build
configuration and not part of the published artifact set.

## Assemble the immutable set

The packer reads the same database record, so source provenance is no longer
duplicated in a separate artifact-set config:

```sh
npm run artifacts:pack -- --build prettyM
npm run artifacts:fetch -- --archive _artifacts/releases/<archive>.tar
npm test
```

Building and packing remain separate. A newly generated producer byte changes
the archive digest; it must be reviewed and validated before replacing a lock
or benchmark report. Performance measurement is never part of this source
build command.

The v1 contract guarantees exact source identity and validated package output;
it does not yet promise byte-for-byte reproducibility of every producer. In
particular, the current VIR package manifest embeds its generation time and the
spelling of the workload source path. Until VIR exposes deterministic metadata,
CI should generate and test a candidate archive rather than expect a fresh
`.irpkg` to reproduce the committed archive digest.
