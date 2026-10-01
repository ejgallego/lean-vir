# Repository packaging tools

Applications do not use this directory. Their owning libraries prepare the
program and runtime through Lake; see [application setup](../../docs/guides/EMBEDDED_RESOURCES.md).
These scripts serve the hosted demos, tests, benchmarks and runtime distribution.

| Files | Current callers / purpose |
| --- | --- |
| `irpkg-generator.mjs` | Shared Lake acquisition adapter for repository producers and tests; it returns resolved executable, compiled inputs and search path. |
| `prepare-irpkg.mjs`, `module-package-config.mjs` | Config-list preparation for the development runner/pages, through shared acquisition and selection helpers. |
| `generate-browser-package.mjs`, `browser-package-{config,plan}.mjs` | Demo/fixture catalogs and explicit selection, including the generator memory test. |
| `check-demo-package.sh` | Demo-output checks. |
| `inspect-irpkg.mjs`, `irpkg-format.mjs`, `package-versions.mjs`, `check-package-abi.mjs` | Compiler-output inspection and ABI consistency tests. |
| `package-{sdk,local}-artifact.mjs`, `sdk-payloads.mjs`, `artifact-bundle.mjs` | Older runtime archives and hosted demo downloads, called by `build:site` and distribution checks. |
| `lean-zip/`, `illuminate/`, `vir-client-package-lib.mjs` | Pinned external benchmark/acceptance producers, not normal client installation. |

The npm command names remain for those callers. They are not a promise of
multiple application workflows or stable script paths. “Package” means compiler
output here; “SDK” names the older runtime archive, not a separate user concept.

There is real migration work before deleting the older tools: demos and tests
still consume their loose outputs, and pinned benchmark producers retain their
own selection requirements. Do not add an application wrapper over these scripts
or duplicate Lake acquisition in JavaScript. Migrate a caller with byte/behavior
tests, then remove the unused command and its configuration.
