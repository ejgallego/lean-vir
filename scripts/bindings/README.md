# Binding tooling

This directory owns the shipped-JavaScript-binding inventory, TypeScript
descriptor generation, faithful Lean declaration generation, Lean type-anchor
comparison, and the consolidated upstream reference/shipped inventory/author
actions document. Use the stable
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

`binding-config.mjs` is the sole loader for `Vir/*.bindings.json` files. It
executes `Vir/bindings.schema.json` before a descriptor, generator, or explorer
uses the configuration, then applies the small cross-field checks that JSON
Schema cannot express directly.

`binding-modalities.mjs` is the shared TypeScript-to-Lean policy boundary. It
combines descriptor shapes with a library ABI profile, explicit method
signature policies, and justified exceptions to produce canonical operation
IR. Lean source generation, comparator intent, generated documentation, and
report evidence consume that same IR. Structured protocols additionally state
whether they adapt a named TypeScript member, are VIR-owned, follow a local
contract, or still need classification. The interactive document presents an
upstream-shaped reference, a complete shipped-boundary inventory, and
actionable author findings with semantic TypeScript/Lean highlighting;
convenience APIs do not count as upstream bindings.

Operation IR also carries a semantic relation independent of type comparison.
Unmodified TypeScript-derived operations are classified as preserving by
construction; operation exceptions and upstream adapters must be reviewed as
preserving or changing, and otherwise remain visible author actions. This
classification is a contract claim. Provider behavior remains separately
trusted and tested.

Runtime provider reconciliation is deliberately narrower: it proves that every
compiled target has a matching provider-map key and that no key is orphaned. It
does not inspect provider behavior or mechanically enforce the operation IR's
retention and revocation policy.

Related ownership:

- `Vir/*.bindings.json` and `Vir/bindings.schema.json`: authored binding maps,
  code-generation policy, and their schema.
- `Vir/*/Generated.lean`: checked-in generated declarations consumed by the
  shipped Lean library.
- `fixtures/type-anchors/`: authored comparison and package-generator inputs.
- `tests/bindings/`: unit and end-to-end tool coverage.
- `web/tools/binding-explorer/`: maintained static explorer presentation.
- `build/bindings/` and `build/type-descriptors/`: ignored generated outputs.

See `docs/BINDING_MODALITIES.md` for the inference rules, provenance contract,
and fail-closed extension boundary.
