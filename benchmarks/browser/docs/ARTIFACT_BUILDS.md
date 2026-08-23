# Source artifact builds

`examples/<id>/example.json` declares each example's source-level VIR targets
and exports. `artifact-builds.json` selects exact Git sources, including the
Lean runtime source consumed by VIR, local checkout roles, producer
dependencies, expected package files, artifact-set identity, and the
provenance consumed by the packer. Generated candidate locks are ignored
invocation-local integrity records, not committed consumer state. A standard
`vir` component names a `packageRef`, and the driver resolves its target and
exports directly from the example descriptor. A `package-command` component
instead owns its repository-specific export driver while receiving the same
verified source inputs. Every build binds an `example.id` plus
`example.variant`, and the driver verifies that `tests.json` selects that build
before validating or building it. `prettyM/default` is the first record; it is
not a default baked into the catalog tools.

Machine-specific paths are deliberately absent from the catalog. The usual
local flow materializes the catalogued sources, then optionally replaces the
FIR producer checkout with an existing checkout selected as a toolchain:

```sh
npm run artifacts:build -- --list
npm run artifacts:sources -- prettyM

npm run artifacts:build -- prettyM \
  --toolchain /path/to/lean-fir-at-the-catalogued-commit \
  --plan
```

An unnamed `--toolchain` means FIR. Name both producer toolchains when needed:

```sh
npm run artifacts:build -- prettyM \
  --toolchain fir=/path/to/lean-fir \
  --toolchain vir=/path/to/lean-vir
```

For repeat use, put the same selection in ignored `toolchains.local.json`, or
pass another file with `--toolchain-config PATH`:

```json
{
  "schemaVersion": 1,
  "kind": "browser-benchmarks/toolchains",
  "toolchains": {
    "fir": "/path/to/lean-fir",
    "vir": "/path/to/lean-vir"
  },
  "checkouts": {
    "workload": "/path/to/verso-slides"
  }
}
```

Relative paths are resolved from the config file. The
`VIR_BENCH_TOOLCHAIN_CONFIG` environment variable selects a config when no
command-line config is given. Resolution order is an explicit `--checkout`, an
explicit `--toolchain`, config `checkouts`, config `toolchains`, then
`_sources/<checkout>`. `--checkout NAME=PATH` remains available for any catalog
role that needs a one-off override.

Selecting a toolchain does not relax provenance. The selected FIR or VIR path
must still be a clean Git root at the exact revision recorded in
`artifact-builds.json`. FIR's package scripts then use the Lean toolchain pinned
by that FIR checkout; the benchmark application does not independently choose
a Lean release.

Producer source remains in its owning repository at the immutable catalogued
commit. The artifact application contains only the source URL, commit, package
contract, and output mapping. It never vendors producer source.

When this repository owns both the catalog and a producer, update them in two
commits: commit the producer change first, then pin that exact commit in
`artifact-builds.json`. A rebase rewrites the producer commit, so refresh the
catalog pin in the following commit before rebuilding or publishing artifacts.
The producer commit must remain reachable after landing: preserve these commits
with a merge commit, or land the producer separately before a squash or rebase
merge and pin its resulting durable commit.

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
_sources/lean/      Lean interpreter/runtime source at the component's commit
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

Prepared VIR checkouts normally provide their lockfile-pinned esbuild binary.
For an offline local build, `VIR_ESBUILD` may select an existing controlled
binary; the driver checks its version against the VIR checkout's package lock
before starting the expensive runtime build. `WASI_SDK_PATH` may likewise
select an already installed catalog-compatible SDK.

The driver never fetches, switches, or edits source revisions. Each path must
be the root of a clean Git checkout whose `HEAD` is the catalog's full commit.
This keeps local worktree policy outside the portable build description.

Remove `--plan` to build all components and atomically replace
`_artifacts/seed`. Prepared checkouts can build directly. Add `--prepare` for a
fresh checkout; the driver installs VIR's npm dependencies and WASI SDK and
runs the FIR Emscripten/Lean-runtime setup before their respective builds. Lean
source is an ordinary exact catalog checkout rather than an ambient VIR setup
side effect. These setup steps may download toolchains and are intentionally
explicit.

## Producer package contract

Every component declares `browser-benchmarks/source-package/v1`. The builder
supplies verified checkout roots and a fresh output path. A producer must:

1. build only from those checkout revisions and its pinned toolchain;
2. write a complete package below the supplied output path;
3. include its adapter because marshaling and decoding are measured behavior;
4. include self-describing metadata and checksums; and
5. return success only after its package-local smoke or differential checks
   pass.

The standard VIR adapter is uniform across examples: every package reference
becomes one `lake exe vir_irpkg` call over its declared target and exports. The
other initial adapters use producer entry points that already exist:

- FIR native: `integration/talos/artifact/package-pretty-format.sh OUTPUT`;
- FIR LLVM: `integration/lcnf-c-wasm/package-prettyM-emscripten.sh OUTPUT`, with
  the just-built native package supplied for its differential check.

The builder validates package metadata against the catalog, verifies producer
checksums, and copies only the declared regular files into the seed. It does not
rewrite producer bytes. FIR LLVM depends on FIR native because its producer
validates exact output equivalence against that package.

Client repositories that need their own Lake environment or assemble more than
one source-owned file use the generic `package-command` adapter. Its executable
entry point is invoked with a fresh caller-owned output directory and every
resolved input explicitly:

```text
producer --output OUTPUT \
  --checkout ROLE=EXACT_CLEAN_CHECKOUT ... \
  --package COMPONENT=VALIDATED_DEPENDENCY ...
```

The `producer` checkout owns the entry point. The command must emit its declared
JSON manifest and `SHA256SUMS`, verify its package-local correctness checks, and
return only after the output is ready for consumption. The catalog driver then
checks the sums, admits only declared regular files, and re-verifies every Git
checkout before writing the source-build receipt. This is the escape hatch for
repository-owned compilation context, not a place for application-specific
staging logic.

The generated `_artifacts/builds/<build-id>/BUILD.json` is a portable receipt.
It records both the build-catalog and example-manifest digests, resolved source
commits, adapters, staged file hashes, selected variant, and the digest of its
self-contained `tests.json`. Machine-local checkout and config paths are
deliberately omitted because the receipt is included in the CI candidate
payload. It is evidence about one invocation, not a second source of build
configuration and not part of the packed artifact set.

## Assemble the candidate set

Serving and testing a staged set does not invoke FIR or rebuild its Wasm. The
generated lock identifies an immutable archive containing the FIR native and
LLVM packages alongside the VIR package. `artifacts:fetch` verifies that
archive and stages its declared example namespace. `--toolchain` is only a
source-build input used to produce a new seed or candidate. Generated v2 locks
remain under ignored `_artifacts/releases/`; the repository does not retain
artifact locks.

The packer reads the same catalog record, so source provenance is no longer
duplicated in a separate artifact-set config. It also requires the corresponding
source-build receipt before accepting `_artifacts/seed`:

```sh
npm run artifacts:pack -- --build prettyM
```

Building and packing remain separate. A newly generated producer byte changes
the archive digest, and the generated lock binds that exact invocation.
Performance measurement is never part of this source build command. See
`ARTIFACT_SETS.md` for the single canonical re-import and validation recipe.

The source-package v1 contract guarantees exact source identity and validated
package output. Historical byte-for-byte reproduction is not a project
requirement; CI generates and validates a fresh candidate for the current
source selection.

## CI candidate build

The complete ephemeral-candidate path is available locally as:

```sh
npm run artifacts:sources -- prettyM
npm run artifacts:candidate -- prettyM \
  --toolchain /path/to/lean-fir-at-the-catalogued-commit \
  --prepare
```

The candidate command runs the source builder, packs with a separate ignored
lock, imports the generated archive through `artifacts:fetch`, runs the shared
unit tests and every differential test declared by the build's example
variant, and collects the upload payload under
`_artifacts/candidates/prettyM/upload/`. The payload contains the immutable tar,
its checksum, the artifact-set manifest, the source `BUILD.json` receipt, the
candidate-only lock, the hash-identified `EXAMPLE_TEST.json` differential
report, and a `CANDIDATE.json` validation statement.

`.github/workflows/example-candidate.yml` runs the same commands on relevant
pull requests and explicit dispatches. On `main`, the Pages workflow derives
its plan from active canonical examples, gives each build a separate controlled
source directory, builds and stages every candidate, uploads their short-lived
payloads together, and deploys the admitted static application. Neither
workflow compares candidate bytes across runs or updates repository state.
