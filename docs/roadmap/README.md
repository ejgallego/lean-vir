# Plans and Follow-up Work

For current workflows and contracts, start with the [documentation index](../README.md).
This page links proposals and open decisions, not a list of implemented APIs.

- [ProofWidgets component coverage and gaps](../INFOVIEW.md#component-coverage-and-gaps).
- [Optional package adapters](../PACKAGE_ADAPTER_ROADMAP.md#proposed-shape).
- [Future Wasm features](../OBJECT_ABI.md#future-wasm-features).

These notes may also describe existing foundations; follow the linked sections
for proposed work rather than treating the whole document as unimplemented.

This directory also tracks small, reviewable maintainer cards for repository-local
follow-up and upstream Lean work. A card owns one problem, the evidence that
makes it actionable, and the decision needed before implementation.

## Lean Upstream Candidates

| Card | Status | Priority |
| --- | --- | --- |
| [ULC-0001 IR Declaration Lookup Boundary](cards/ULC-0001-ir-declaration-lookup-boundary/README.md) | ready-to-transfer | medium |

`ULC` cards describe Lean API questions discovered by VIR. They are not VIR
release blockers and should be transferable to `leanprover/lean4` once the
card's open decision is resolved.

## Card Rules

- One card owns one upstream contract and its local removal target.
- Separate reproduced facts from proposed API shape.
- Check whether the existing upstream API can serve VIR before requesting a
  new one.
- Keep enough sanitized evidence in the card to paste it into an upstream issue
  or PR discussion.
- Do not create or modify upstream issues or pull requests without an explicit
  request.
- Update the card when upstream support lands, then remove the named local
  workaround.
