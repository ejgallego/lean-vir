# Shipped JavaScript binding coverage

The shipped-bindings report is the exhaustive pre-release census of VIR's
JavaScript boundary. It reconciles declarations discovered from compiled Lean
metadata with the JavaScript providers in this checkout.

The current report covers 119 ordinary `@[vir_js]` declarations and 13
`@[vir_js_explicit_conversion]` declarations. All 132 distinct targets have a
shipped provider; there are no missing providers and no provider-only targets.

## Fidelity Contract

This check makes four mechanically enforceable claims:

1. Every row comes from elaborated declarations and compiled IR metadata, not
   source-text matching.
2. Lean revalidates every complete signature against `Vir.HostValidation`.
   Ordinary `@[vir_js]` declarations may use only `Unit`, JavaScript resources,
   object handles, and resource-shaped callbacks at the boundary.
3. Conversions between JavaScript values and ordinary Lean values must be
   isolated behind `@[vir_js_explicit_conversion]`; they cannot be hidden in an
   ordinary binding.
4. Every declared target must be implemented by a shipped browser/React,
   virtual Node, or runtime-intrinsic provider, and every such provider target
   must have a compiled declaration.

This prevents accidental representation drift such as exposing a raw Lean
`String` where the JavaScript API returns a `Js String`. Ergonomic wrappers may
convert above the boundary, but they do not change the faithful boundary type.

The check deliberately does not claim that all upstream APIs have been ported,
or that every phantom resource name has been proven equivalent to an upstream
TypeScript type. Library-specific type-anchor reports provide that second,
semantic layer. Keeping the mechanical census and semantic comparison separate
lets the exhaustive gate stay strict without inventing correspondences.

## Data Flow

```text
compiled Vir + Vir.Infoview environments
  -> compiler-decoded vir_js metadata
  -> signature and boundary-policy validation

browser/React + virtual Node provider maps
runtime object-handle intrinsic targets
  -> shipped provider inventory

compiler targets + provider targets
  -> strict reconciliation JSON
  -> interactive HTML dashboard
```

Generate the tracked report and dashboard with:

```bash
npm run generate:shipped-bindings
```

Validate the compiler inventory, tracked outputs, reconciliation invariants,
and dashboard contract with:

```bash
npm run check:shipped-bindings
```

The Lean compiler inventory is an ignored intermediate under
`build/type-descriptors/`. The tracked machine report is
`docs/bindings/shipped-v1.coverage.json`; the primary human report is
`docs/bindings/shipped-v1.dashboard.html`.

The dashboard supports search, status, provider, boundary, and visibility
filters; deep links; Lean source links; exact elaborated types; and light/dark
themes. A `provided` row means the representation policy and runtime dispatch
path are covered. Consult a library-specific type-anchor report for upstream
semantic parity.
