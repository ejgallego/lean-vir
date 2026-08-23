# Binding tooling

This directory owns the shipped-JavaScript-binding inventory, TypeScript
descriptor generation, faithful Lean declaration generation, Lean type-anchor
comparison, and the consolidated binding explorer. Use the stable
`npm run generate:*`, `npm run check:*`, and `npm run test:*` commands from the
repository root rather than invoking these entry points directly during
routine work.

The `generate-*`, `check-*`, and `render-*` files are thin command entry points.
Their sibling library modules expose reusable report and rendering functions
without running a CLI when imported. The entry points own error formatting and
process exit status through `cli-main.mjs`; reusable modules throw errors or
return an exit status instead of terminating their host process. Small
argument and generated-output conventions are shared through `tool-utils.mjs`;
domain logic stays with its own tool instead of growing a general repository
harness. Repository-root resolution shared with other nested tooling comes
from `scripts/repository-paths.mjs`.

Related ownership:

- `Vir/*.bindings.json` and `Vir/bindings.schema.json`: authored binding maps,
  code-generation policy, and their schema.
- `Vir/*/Generated.lean`: checked-in generated declarations consumed by the
  shipped Lean library.
- `fixtures/type-anchors/`: authored comparison and package-generator inputs.
- `tests/bindings/`: unit and end-to-end tool coverage.
- `web/tools/binding-explorer/`: maintained static explorer presentation.
- `build/bindings/` and `build/type-descriptors/`: ignored generated outputs.
