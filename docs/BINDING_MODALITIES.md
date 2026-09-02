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

## Semantics Fidelity

Semantics fidelity is the repository-wide rule for every upstream-backed
binding. The canonical Lean boundary preserves every representable,
caller-observable property of the upstream operation: operation identity and
naming, types and absence, overload selection, mutation and object identity,
synchronous or asynchronous behavior, success and failure behavior, argument
lifetime and reuse, callback retention, terminal behavior, and result
ownership.

Runtime ownership machinery may retain independent internal leases needed to
implement that contract. It must not consume, clone, revoke, normalize,
convert, or otherwise change a caller-owned value unless the upstream
operation does so. Memory-management convenience is not evidence for changing
the public modality. For example, a reusable JavaScript argument remains
borrowed even when the result must independently retain values reachable from
it.

Conversions and ergonomic policies belong in explicitly named Lean adapters
above the canonical boundary. Such an adapter may be useful and generated, but
it does not occupy the upstream operation's faithful documentation lane or
count as semantics-preserving coverage. Unsupported or ambiguous semantics
fail closed until they have an explicit representation or reviewed policy.

Canonical operation IR records this separately from type-comparator evidence:

- `preserving` claims that the generated contract preserves upstream-observable
  behavior;
- `changing` identifies an explicit semantic adapter;
- `unreviewed` is binding-author work and must never be presented as faithful;
- `vir-owned` and `local-contract` identify operations whose semantics do not
  come from an external upstream operation.

A TypeScript-derived operation without an operation exception and with an
unmodified single-signature call policy receives a `preserving` contract claim
from its declaration plus ABI profile. A method policy that selects an overload
or changes the exposed parameter list must set `semantics` and `reason`, unless
an operation exception already supplies that review. Exceptions and
`upstream-adapter` protocols likewise set `semantics` to `preserving` or
`changing`; until then the operation remains `unreviewed` in the author
workbench. This is a contract classification, not provider-behavior
verification. Provider dispatch, retention, rollback, and cleanup remain
separately trusted and tested.

### Direct Value Rule

Generated bindings preserve the upstream value itself whenever it can cross as
a JavaScript resource. `Js`, borrowing, ownership, and an effect carrier are
boundary semantics, not intermediate representations. A VIR-specific props,
node, collection, or scalar algebra cannot replace a representable upstream
value in the canonical operation. Explicitly named builders and conversions may
sit above that operation, but the audit reports them as adapters rather than API
fidelity.

Any protocol operation that introduces a distinct data model must explain why
the upstream value cannot cross directly. Convenience or easier decoding is not
such a reason.

## Separate Questions

Every operation answers separate representation, passing, and lifetime
questions. Combining these into a single “ownership” label hides important
differences.

| Axis               | Examples                                 | Meaning                                                                                                                               |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Representation     | `immediate`, `js-resource`               | How a TypeScript value crosses the Lean/JavaScript boundary.                                                                          |
| Argument passing   | `value`, `borrowed`, `owned`, `consumed` | What the runtime does with the argument for this invocation. `value` applies to immediate values; the other modes apply to resources. |
| Argument retention | `call`, `until-release`, `runtime`       | How long the host may retain a resource.                                                                                              |
| Result ownership   | `value`, `owned`, `borrowed`             | Whether a result is immediate or which side owns the returned resource.                                                               |
| Effect             | for example `dom` / `DomM`               | Which Lean host-effect carrier wraps the result.                                                                                      |

A borrowed resource cannot have retention beyond `call`. The generator rejects
that combination instead of emitting a declaration that contradicts its host
ABI policy.

These modes are runtime/ABI policy, not an affine Lean type system. `@&` marks
borrowed arguments for Lean's calling convention; it does not prevent a caller
from retaining a Lean alias. Likewise, `consumed` means the runtime takes the
handle and dynamically revokes its aliases after the call. A later operation
through an alias fails resource-liveness validation, but ordinary Lean typing
does not make the second use unrepresentable.

## ABI Profile

Each generated library has a named `generation.abiProfile` in its
`Vir/*.bindings.json` configuration. The browser profile currently says:

- every `Js` resource transports the exact JavaScript value; public host
  wrappers and payload envelopes are not an allowed profile;
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

| TypeScript position             | Generated rule                                          |
| ------------------------------- | ------------------------------------------------------- |
| `string` argument               | `@& Lean.Vir.Js String`, retained for the call          |
| `string` result                 | `Lean.Vir.Js String`, owned result                      |
| `string \| null` argument       | `@& Lean.Vir.Js.Nullable String`, retained for the call |
| instance receiver               | profiled resource marker with receiver passing/lifetime |
| configured host-global receiver | no Lean receiver argument                               |
| `void` result                   | `Unit`                                                  |

Unsupported TypeScript shapes fail generation. They are not silently converted
to opaque Lean types.

Descriptor options retain whether absence came from `null`, `undefined`, or
both. The current `Lean.Vir.Js.Nullable` lane represents only `T | null`.
Generation rejects `T | undefined`, `T | null | undefined`, and optional
properties until their distinct JavaScript semantics have an explicit ABI
representation.

The required `valueTransport: "direct"` profile field makes this boundary
machine-readable. It covers ordinary objects, functions, native timer/frame
tokens, and `null` payloads. Resource liveness and cleanup state stay
out-of-band; they must not replace the public JavaScript value.

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
- the ABI profile's direct-value invariant and any operation-specific private
  active-effect role;
- correspondence and semantic fidelity as separate operation facts;
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
  "CanvasRenderingContext2D.arc": {
    "signature": "only",
    "omittedOptionalParameters": ["counterclockwise"],
    "semantics": "preserving",
    "reason": "Omitting counterclockwise preserves the TypeScript default value false."
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
signature projection rather than a faithful translation. Overload selection,
optional or rest-parameter omission, fixed arguments, and parameter projection
must carry `semantics` plus `reason` when no operation exception classifies the
change. Every optional
parameter must either be represented by a supported translation rule or named
in `omittedOptionalParameters`; the current generator implements the latter
path. A rest parameter must be omitted explicitly or projected to one or more
named fixed-arity Lean binders through `fixedRestParameters`. Parameter names
can be preserved or changed explicitly with `parameterRenames`. A literal
TypeScript parameter that the host supplies internally can be recorded in
`fixedArguments`; generation verifies both its name and exact literal value and
requires a justified exception.

A direct method mapping may set `receiverName` to preserve a concise Lean
binder such as `ctx`. Like accessor `receiverName` and setter `parameterName`,
this changes source spelling only; representation or modality differences still
require a justified exception.

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
disposer that dynamically revokes that handle and its aliases.

## Reviewed Protocol Operations

Some shipped targets intentionally have no one-to-one TypeScript declaration:
examples include retained Lean references, checked resource casts, selector
conveniences, and explicit React builder adapters. These are authored as structured
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

An `upstream-adapter` relation also records whether its behavior is
`semantics: "preserving"` or `semantics: "changing"`. These values answer a
different question from correspondence: naming an upstream member says what an
operation relates to, while semantic classification says whether the VIR
contract preserves or intentionally changes that member's observable behavior.

Operations that need repository-private teardown may additionally declare an
`activeEffect` role:

- `register` creates a private listener, pending timer/frame, or React-root
  teardown record;
- `use` operates through an existing private record without replacing the
  public JavaScript value;
- `release` removes the record and performs the corresponding upstream
  cancellation or unmount.

These roles describe policy that provider tests must exercise. They do not
change value transport and do not claim that provider behavior is mechanically
verified. Passive JavaScript values and React hook/node values have no
active-effect role; JavaScript reachability and official React own their normal
lifetime.

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
An exception's optional `semantics` field records whether the reviewed override
preserves upstream behavior or creates an explicit semantic adapter. Omitting
that field leaves the operation visibly unreviewed rather than inferring
faithfulness from its type comparison.

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
