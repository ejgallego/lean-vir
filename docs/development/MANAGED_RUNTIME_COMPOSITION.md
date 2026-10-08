# Managed runtime composition

The public browser and Node factories use the full runtime composition. Their
construction, ownership, conversion and retirement contracts remain unchanged.
Applications can already keep Lean values and functions opaque through `JSL`
using the public factories. This extraction separates that existing ownership
and invocation machinery from optional structural conversion. The internal
primitive composition qualifies this dependency boundary; it is excluded from
public package exports and the SDK.

Both compositions share these modules:

| Module | Responsibility |
| --- | --- |
| `factory-core.js` | Wasm acquisition, one host state per instance, package-set creation and construction-failure cleanup |
| `managed-core.js` | Package admission, startup, calls, argument transfer, failed-generation quarantine and retirement |
| `object-core.js` | Object transport and consuming calls, exact JavaScript resources and the single retained-value ownership registry for JSL and converted callbacks |
| `primitive-values.js` | Unit, resources, booleans, numeric values, strings and byte-array conversion |
| `object-boundary.js` | Boxed-boundary requirements used by package admission |
| `host-state.js` | Host-call transactions, shared retained-value tracking and binding-provider cleanup |

The full `core.js` composition adds `object-values.js`: arrays, lists, options,
pairs, structures, inductives, `Lean.Expr` and automatic Lean-function conversion
to JavaScript callables, including their creation and typed invocation. The
retained cell holds the sole calling descriptor; the shared owner manages
lifetime. Its primitive cases
delegate to the shared implementation.
Owned collection and constructor builders also stay in this optional layer.
The internal `primitive-factory.js` imports none of those structural converters
or their layout/normalization modules. It uses the same factory and lifecycle;
it does not establish a separate raw construction or retirement protocol.

The internal primitive composition uses the existing host-binding factory options,
including a fresh default builder when required. Public browser and Node entries
continue selecting their usual providers. Imports remain declarative: there is
no mutable codec registry or runtime feature flag.

Conversion consumes the installed, validated and deeply frozen manifest directly.
`interface-manifest.js` owns descriptor-shape validation; the converters do not
repeat it for each field, element or callback. Argument and result support share
one traversal, with automatic functions permitted only in the result direction.
Layout plans and constructor-name lookups are derived once per immutable owner;
changing an internal descriptor after admission is unsupported.

This distinction applies to metadata, not application values. Each call still
checks JavaScript value shapes and numeric bounds, returned constructor tags,
supported scalar layouts and retained-value liveness/instance ownership. Argument
conversion can execute application code, so callback liveness is checked again
before native transfer. Package admission keeps its independent native contract
check; it is not replaced by these conversion caches.

The compiled [ManagedCore fixture](../../fixtures/runtime/ManagedCore.lean)
exercises a thin Lean boundary:

```lean
buildHeld : Nat → RuntimeM (JSL (Array Nat))
advanceHeld : JSL (Array Nat) → Nat → RuntimeM (JSL (Array Nat))
summarizeHeld : JSL (Array Nat) → RuntimeM String
makeSummaryHeld : JSL (Array Nat) → RuntimeM (JSL (Unit → String))
invokeSummaryHeld : JSL (Unit → String) → RuntimeM String
```

JavaScript transports opaque carriers between these calls. Lean owns traversal
and function application; JavaScript only converts the small primitive inputs
and summary results. The existing JSL identity, liveness and instance checks
apply to state and function carriers alike.

An unsupported structural entry is rejected before argument lowering or native
execution. Package admission still validates the complete binary contract and
metadata; omitting converters does not relax it. Ordinary managed callbacks
retain their existing invocation metadata in the full composition. They share
JSL's retained-value cell, finalizer and terminal tracking rather than using a
second native ownership registry. The optional layer performs typed closure
application through `vir_closure_apply_objects`; the shared host state owns
retirement.
Host imports that receive Lean callbacks as ordinary JavaScript functions also
need the full callable converter. A primitive JSL client can instead schedule a
JavaScript closure that calls its explicit Lean `invoke...` boundary with the
opaque function carrier.

JavaScript reachability and terminal runtime disposal retain their current
meaning; see [Lean-backed value lifetimes](../reference/HOST_BINDINGS.md#lean-backed-javascript-values)
for provider-cleanup admission and healthy versus failed retirement.
Canceling a timeout does not release a separately reachable carrier or
interrupt a synchronous Lean call. This split adds no per-value public disposal,
cycle collection or post-trap interpreter re-entry. The existing four permitted
retirement-safe Wasm exports and native-cleanup quarantine are unchanged.

`tests/runtime/entry-composition.test.mjs` checks that the primitive import graph
omits optional conversion modules. `tests/runtime/primitive-composition.test.mjs`
checks that both compositions share their ownership and ordinary call methods.
The existing unit and Wasm smoke suites exercise the full composition. SDK
payloads must include every extracted module needed by the existing entries.
`tests/runtime/managed-core-smoke.mjs` compiles a small Lean fixture and exercises
the primitive composition against both Wasm profiles, including function captures,
reentry and terminal retirement.
