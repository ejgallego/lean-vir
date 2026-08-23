# Analysis tooling

This directory owns repository-local surface analysis, frontier-size
measurement, Wasm binary attribution, and static report generation. Use the
stable `npm run analyze:*`, `npm run compare:*`, `npm run render:*`, and
`npm run size:wasm` commands from the repository root.

Maintained report presentation stays under `web/tools/`; generated reports and
data stay under ignored `build/` or `web/dist/` paths. Focused contracts and
integration checks live under `tests/surface/`.

Shared process, repository-path, and timing helpers remain one level above this
directory because they serve multiple tooling owners.
