# Support scope

VIR's officially supported scope is the application runtime and minimal JS/Lean
interop:

- The Wasm interpreter and VIR runtime extensions.
- Lean object construction and inspection, constructor layouts, retain/release,
  and call ownership through the low-level [object API](reference/OBJECT_ABI.md).
- Generation and client loading of `.irpkg` programs and package sets.
- Explicit host bindings, calling Lean from JavaScript, JavaScript values with
  preserved identity, Lean-backed `JSL` values, and Lean callbacks.
- Automatic conversion of arrays whose elements use supported representations,
  such as `Array Nat`. Arrays inherit the support status of their elements.
- Downstream Lake setup and acquisition of an exact compatible precompiled
  runtime, without building Wasm in an application.

Supported means documented, maintained and tested for the stated workflow and
pinned Lean/VIR versions. It does not promise arbitrary Lean programs, every host
environment, or compatibility across revisions. The first release remains under
review; see [current qualification](development/RESOURCE_ACCEPTANCE.md).

VIR maintains the current contracts without legacy APIs or backward compatibility
layers. Retired interfaces are removed when the contract changes. Applications
must refresh their build setup and deploy
[matching JavaScript/Wasm assets](guides/JS_API.md#matching-runtime-assets) together.
Contributors follow the [API change policy](../CONTRIBUTING.md#api-changes).

Start with [application setup](guides/EMBEDDED_RESOURCES.md). The underlying
[JavaScript API](guides/JS_API.md) documents custom host bindings and direct runtime
access; the current `createProgram` resource facade exposes only
`status`, `call` and `dispose`.

For two-way interop, [choose a boundary representation](guides/LEAN_VIR_LIBRARY.md#choose-a-boundary-representation):
exact JavaScript values, opaque Lean-owned values and callbacks have different
contracts from automatic structural conversion.

## Experimental conveniences

DOM, canvas, React, JSX, ProofWidgets, Infoview, editor/RPC integration and UI
lifecycle adapters are experimental. Broad generated JavaScript convenience
bindings and automatic conversion of records and custom inductives are also
outside the minimal supported interop contract. Their guides and tests remain
useful for trying them.

The `Vir` umbrella import and default browser host providers currently include
experimental helpers. An API being shipped, tested, or available through those
defaults does not make it officially supported. Choose these conveniences with
that expectation.

Build tools, pack encoding and cache handling can implement supported workflows
without becoming public APIs themselves. A module's directory or namespace does
not determine its support status.

## Planned for 0.1.1

Generated JSON converters, explicitly invoked by applications in both directions,
are a planned 0.1.1 deliverable. They are not yet a qualified release feature.
Existing automatic value conversion is not that API; basic calls and Js/JSL
reference interop do not require JSON.
