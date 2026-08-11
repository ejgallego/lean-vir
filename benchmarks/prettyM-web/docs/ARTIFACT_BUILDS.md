# Source artifact builds

`examples/<id>/example.json` is the canonical declaration of each example's
VIR targets and exports. `artifact-builds.json` selects exact Git sources, local
checkout roles, producer dependencies, expected package files, artifact-set
identity, and the provenance consumed by the packer. Accepted locks are
separate consumer state. A VIR component names a `packageRef`; the driver
resolves its target and exports from the example
descriptor before validating or building it. `prettyM` is the first record; it
is not a default baked into the catalog tools.

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

The VIR adapter is uniform across examples: every package reference becomes
one `lake exe vir_irpkg` call over its declared target and exports. Clients do
not provide shell commands. The other initial adapters use producer entry
points that already exist:

- FIR native: `integration/talos/artifact/package-pretty-format.sh OUTPUT`;
- FIR LLVM: `integration/lcnf-c-wasm/package-prettyM-emscripten.sh OUTPUT`, with
  the just-built native package supplied for its differential check.

The builder validates package metadata against the catalog, verifies producer
checksums, and copies only the declared regular files into the seed. It does not
rewrite producer bytes. FIR LLVM depends on FIR native because its producer
validates exact output equivalence against that package.

The generated `_artifacts/builds/<build-id>/BUILD.json` is a portable receipt.
It records both the build-catalog and example-manifest digests, resolved source
commits, adapters, and staged file hashes. Machine-local checkout and config
paths are deliberately omitted because the receipt is included in the CI
candidate payload. It is evidence about one invocation, not a second source of
build configuration and not part of the published artifact set.

## Assemble the immutable set

Serving and testing an accepted set does not invoke FIR or rebuild its Wasm.
The accepted lock selects an immutable archive containing the FIR native and
LLVM packages alongside the VIR package. `artifacts:fetch` verifies that
archive and stages its declared example namespace. `--toolchain` is only a
source-build input used to produce a new seed or candidate. Historical set
0001 remains in `artifact-set.lock.json`; the refreshed catalog targets set
0002 so changing FIR source does not redefine an existing set.

The packer reads the same catalog record, so source provenance is no longer
duplicated in a separate artifact-set config. It also requires the corresponding
source-build receipt before accepting `_artifacts/seed`:

```sh
npm run artifacts:pack -- --build prettyM
npm run artifacts:fetch -- \
  --lock _artifacts/releases/prettyM-bounded-set-0002.lock.json \
  --archive _artifacts/releases/<archive>.tar
npm test
```

Building and packing remain separate. A newly generated producer byte changes
the archive digest; exactly one reviewed digest can be promoted for a new set
ID. A published set ID is never reused for changed bytes. Performance
measurement is never part of this source build command.

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
npm run artifacts:candidate -- prettyM \
  --toolchain /path/to/lean-fir-at-the-catalogued-commit \
  --prepare
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
