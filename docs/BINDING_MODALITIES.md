# Generated Binding Modalities

The binding generator treats a shipped Lean declaration as a deterministic
translation of three reviewed inputs:

```text
pinned TypeScript declaration
  + library ABI profile
  + named, justified exceptions
  = canonical operation IR
  = Lean source + comparator intent + explorer explanation
```

This keeps TypeScript as the authority for API shape while making the host ABI
choices explicit and reusable. An anchor still identifies which TypeScript
operation, Lean declaration, and host target correspond; it does not repeat the
modalities derived by generation.

## Separate Questions

Every operation answers separate representation, passing, and lifetime
questions. Combining these into a single “ownership” label hides important
differences.

| Axis | Examples | Meaning |
| --- | --- | --- |
| Representation | `immediate`, `js-resource` | How a TypeScript value crosses the Lean/JavaScript boundary. |
| Argument passing | `value`, `borrowed`, `owned`, `consumed` | What the callee receives for this invocation. `value` applies to immediate values; the other modes apply to resources. |
| Argument retention | `call`, `until-release`, `runtime` | How long the host may retain a resource. |
| Result ownership | `value`, `owned`, `borrowed` | Whether a result is immediate or which side owns the returned resource. |
| Effect | for example `dom` / `DomM` | Which Lean host-effect carrier wraps the result. |

A borrowed resource cannot have retention beyond `call`. The generator rejects
that combination instead of emitting a declaration whose lifetime cannot be
supported by `@&`.

## ABI Profile

Each generated library has a named `generation.abiProfile` in its
`Vir/*.bindings.json` configuration. The browser profile currently says:

- TypeScript `string` is represented faithfully as `Lean.Vir.Js String`;
- TypeScript `void` is represented as immediate `Unit`;
- nullable resources use `Lean.Vir.Js.Nullable`;
- ordinary resource arguments and instance receivers are borrowed for one
  call;
- resource results are owned;
- operations run in `DomM`;
- `Document` is a host-global receiver, while `Element` is an explicit
  borrowed receiver.

The profile is library policy, not user convenience policy. In particular, it
does not turn JavaScript strings into Lean-owned `String` values. Applications
can add conversions at their own API layer.

The normal property rules are therefore mechanical:

| TypeScript position | Generated rule |
| --- | --- |
| `string` argument | `@& Lean.Vir.Js String`, retained for the call |
| `string` result | `Lean.Vir.Js String`, owned result |
| `string \| null` argument | `@& Lean.Vir.Js.Nullable String`, retained for the call |
| instance receiver | profiled resource marker with receiver passing/lifetime |
| configured host-global receiver | no Lean receiver argument |
| `void` result | `Unit` |

Unsupported TypeScript shapes fail generation. They are not silently converted
to opaque Lean types.

## Canonical Operation IR

`npm run generate:lean-bindings` creates a canonical operation record for every
selected TypeScript operation and every reviewed protocol operation.
It then renders all downstream views from those records. Ignored debugging
artifacts are written per library under:

```text
build/bindings/*.generated-operations.json
```

Each operation records:

- the TypeScript member, selected signature or accessor shape, source location,
  display text, and upstream documentation;
- the host target and Lean declaration name;
- the effect;
- global or argument receiver policy;
- every argument's Lean type, representation, passing, and retention;
- the result's Lean type, representation, and ownership;
- provenance for every derived choice;
- the reason for any explicit exception;
- a protocol's machine-readable upstream relation.

The checked-in `Vir/**/Generated.lean` declarations are rendered from this IR.
The descriptor generator also projects comparator-compatible `portIntent`
fields from it. Comparison results retain the complete `modalityContract`, and
the binding explorer shows generated operations in an expandable conversion
policy panel. This avoids three independently authored versions of the same
policy.

## Property Selection

A writable TypeScript property has independent getter and setter operations.
Selecting the property normally requires mappings for both. When VIR ships
only one direction, the other accessor must use an explicit missing-accessor
mapping with `missing: true` and a non-empty `note`; silently dropping it fails
generation. The missing direction remains a visible upstream coverage gap and
an author-workbench action.

Accessor mappings may set `receiverName` and setter `parameterName` to preserve
existing Lean binder names without treating spelling as a semantic exception.
Type or modality differences still require a justified
`generation.exceptions` entry. Canvas `fillStyle` and `strokeStyle`, for
example, use the opaque JavaScript-owned `CanvasStyle` marker for their faithful
raw getter/setter pairs. Their existing string-valued setters are separately
classified generated convenience adapters.

## Method Selection

A selected TypeScript method must have a `generation.methodPolicies` entry.
The policy separates API identity (the reviewed mapping) from signature
selection:

```json
"methodPolicies": {
  "Element.getAttribute": { "signature": "only" },
  "Document.createElement": {
    "signature": 2,
    "omittedOptionalParameters": ["options"]
  },
  "Element.removeEventListener": {
    "signature": 1,
    "omittedOptionalParameters": ["options"],
    "omittedRequiredParameters": ["type"]
  }
}
```

`"signature": "only"` asserts that the declaration has exactly one function
signature. An integer selects that zero-based overload explicitly. A required
parameter can be omitted only by naming it in `omittedRequiredParameters` and
providing a justified operation exception; this deliberately marks a reviewed
signature projection rather than a faithful translation. Every optional
parameter must either be represented by a supported translation rule or named
in `omittedOptionalParameters`; the current generator implements the latter
path. A rest parameter must be omitted explicitly or projected to one or more
named fixed-arity Lean binders through `fixedRestParameters`. Parameter names
can be preserved or changed explicitly with `parameterRenames`. A literal
TypeScript parameter that the host supplies internally can be recorded in
`fixedArguments`; generation verifies both its name and exact literal value and
requires a justified exception.

Missing policies, changed overload layouts, unclassified rest parameters,
unknown parameter names, unjustified required-parameter omissions, and
unsupported parameter or result types fail generation.
TypeScript parameter names that collide with Lean keywords are rendered as
escaped Lean identifiers.

The browser slice includes global functions, DOM methods, and properties.
Selected overloads, parameter projections and renames, fixed-arity rest
specializations, callbacks, primitive resources, and receiver/result overrides
are all recorded in the same IR. In particular, the event-listener pair records
registration as returning a revocable handle and removal as a receiver-free
disposer that consumes that handle.

## Reviewed Protocol Operations

Some shipped targets intentionally have no one-to-one TypeScript declaration:
examples include retained Lean references, checked resource casts, selector
conveniences, and replay-safe React callbacks. These are authored as structured
`generation.protocolOperations`, never as handwritten `@[vir_js]`
declarations. Protocol records carry their type parameters, complete Lean
types, representation, passing, retention, effect, target, and justification.
The generator emits them through the same declaration and modality pipeline.

Every protocol also declares exactly one `upstreamRelation`:

- `upstream-adapter` names the TypeScript member whose behavior it adapts;
- `vir-owned` records that no one-to-one upstream declaration exists;
- `local-contract` identifies an operation governed by a repository-local API;
- `unclassified` is temporary author debt and remains visible in the workbench.

Generation validates adapter member names against the configured TypeScript
descriptor and rejects relation kinds inconsistent with internal or local API
groups. The explorer reports each class separately, confirms upstream members
served by reviewed adapters, and reserves correspondence actions for genuinely
unclassified operations.

## Documentation Flow

The TypeScript compiler extracts declaration display text, JSDoc, source
locations, and documentation links into the descriptor. Generation copies
those fields into operation IR and emits the JSDoc plus an upstream source link
on the public Lean declaration. The explorer consumes the same descriptor and
operation IR: it renders JSDoc paragraphs and links, TypeScript and Lean code
with language-aware token classes, and the exact conversion policy that
produced each generated declaration. No separate handwritten method
documentation database is involved.

`portIntent` is reserved for transformations that the comparator actually
checks. A reviewed observation about lifecycle, retention, or host ownership
that is not yet enforced belongs in the anchor's `advisorySemantics` list. Both
the focused report and consolidated explorer display such observations under
an explicit “not mechanically verified” heading; they do not contribute to a
type-fidelity verdict.

## Exceptions

`generation.exceptions` is keyed by operation/anchor id. An exception must have
a non-empty `reason` and may override only the receiver, named argument role,
type or modalities, result ownership, or effect. A receiver may be projected
away only through an explicit `kind: "none"` exception. Unknown operation ids,
unknown generated argument names, unsupported fields, unsafe borrowed
lifetimes, and exceptions on immediate values are errors.

Exceptions are intended for semantics that TypeScript declarations do not
express, such as a host retaining a callback until explicit release. They are
not a place to restate ordinary profile defaults. The operation IR marks every
override and its reason, so review can distinguish inference from policy.

## Authored And Generated Ownership

Authored configuration owns:

- the pinned declaration inputs and selected member set;
- correspondence among TypeScript operations, Lean names, and host targets;
- resource marker names and the named ABI profile;
- documented semantic exceptions.

Generation owns:

- Lean parameter and result types;
- `@&` placement;
- receiver, argument, result, and effect modalities;
- generated Lean declarations;
- comparator modality intent and explorer explanations.

For generated operations, authored anchors are rejected if they include
`effect`, `receiver`, `resourceArguments`, or `resultRepresentation`, because
those are projections of the operation IR.

## Current Boundary And Next Extension

The implemented translation covers full and partial properties, selected
overloads, explicit optional and required parameter projections, fixed literal
arguments, fixed-arity rest specializations, parameter renames, resource-result
mappings, and retained callback/disposer lifecycles. These rules derive the
current Document, Element, Canvas 2D, animation-frame, and React root slices
while retaining explicit reasons for every specialization.

Structural records, generic containers, and broader union translations remain
fail-closed until their policies are explicit and tested.
