# Package tooling

This directory owns repository-local tooling for `.irpkg` files, generated
browser packages, and distributable SDK and local artifacts. The stable command
surface is the corresponding npm scripts in the repository `package.json`.
The demo-package diagnostic wrapper also lives here behind `npm run
check:package`.

The side-effect-free format, version, fixture-configuration, and SDK-payload
modules are imported by tests and benchmark tooling. Command implementations
remain colocated here because their paths are repository internals; no direct
script-path compatibility is promised.

Shared process, filesystem, timing, and repository-path helpers remain one
level above this directory because they serve multiple tooling owners. Shared
SDK/local bundle layout and publication policy lives in `artifact-bundle.mjs`.

Lean-zip external-client acceptance, browser source-package export, and the
package-local smoke payload live together under `lean-zip/`. The benchmark
catalog entry point is resolved inside its exact immutable producer revision,
so a path move takes effect there only when that source pin advances. `npm run
accept:lean-zip` remains the stable maintainer command.
