# Generated Binding Modalities

The binding generator treats a shipped Lean declaration as a deterministic
translation of three reviewed inputs:

```text
pinned TypeScript declaration
  + library ABI profile
  + named, justified exceptions
  = generated binding operation
  = Lean source + explorer explanation
```

This keeps TypeScript as the authority for API shape while making the host ABI
choices explicit and reusable. The reviewed mapping identifies the TypeScript
operation, Lean declaration, and host target once; the generated binding
operation carries the operation's TypeScript-level type and derived modalities.

## Semantics Fidelity

An upstream-backed binding preserves the selected operation's types, absence,
mutation, identity, errors, timing and lifetime behavior. Explicitly named
conversions and adapters are classified separately. The runtime value and
ownership contract is in [HOST_BINDINGS.md](HOST_BINDINGS.md#semantic-fidelity);
this guide describes how generation represents and checks that contract.

### Type Parameter Fidelity

Preserving upstream type relationships is a correctness requirement. A binding
must not invent polymorphism, erase a meaningful type parameter, or replace a
constraint with a caller-selected result type. For example, TypeScript's
`Array<T>` index signature returns `T`, and `push` accepts `T` elements. A Lean
binding with an independent result or inserted-element parameter does not
preserve that contract. Heterogeneous arrays can use a represented union or
explicit `Js.Any`; they do not justify an implicit conversion to an unrelated
concrete type. Absence and out-of-bounds behavior remain separate obligations.

The same rule applies to tuple positions, generic callbacks and state/action
relationships. A coarse `Js`-resource classification is not evidence that these
relationships were preserved. Unsupported generic translation must fail closed
or remain an explicitly reported gap, not silently widen the declaration.

Agreement between configuration and generated Lean proves consistency, not
TypeScript conformance. Neither a `semantics: preserving` label nor a runtime
payload check establishes the correctness of the static type relationship.

The current independent relationship check is deliberately small:
`js-value-type-relationships.mjs` reads the descriptor's upstream `Array<T>`
binder, numeric index signature and `push(...items: T[]): number` shape, then
checks the configured receiver, item and result types before Lean emission.
Missing provenance or an unsupported upstream relationship is an error for
these operations, even with a `preserving` label. Mutation tests change both
the configured Lean types and the upstream descriptor relationships.

`Js.Array α` describes a native array of JavaScript shape `α`: insertion takes
`Js α`, and indexing returns `Js α`. It cannot store a raw Lean `α`; Lean-owned
payloads require explicit `JSL` boxing. There is no redundant inner `Js` in the
array type. `Js.Array.push` selects the one-item arity of TypeScript's variadic method.
`Js.Array.getJs` follows TypeScript's **unchecked** `[n: number]: T` declaration:
holes and missing entries remain exact JavaScript `undefined`. It does not
implement `noUncheckedIndexedAccess` or turn `undefined` into `null`.
The separate `item` helper checks numeric bounds, not sparse-array membership.

Native two-position tuples use `Js.Tuple2`, with typed `first` and `second`
projections instead of an unconstrained array getter. React's `StateTuple` and
`ReducerTuple` aliases retain their position types. These VIR-owned projections
have a checked position contract and compile-time cross-type regressions; the
React aliases are still authored, not inferred from React's TypeScript overloads.
`NodeList.toArray` likewise has a checked VIR-owned representation contract:
its input `Js.NodeList (Js α)` uses a full Lean-view parameter, while its output
`Js.Array α` uses a JavaScript shape. This is not an upstream-derived NodeList
generic translation.
The selected Promise relationships below also have a bounded check. Other
reviewed protocol operations do not yet receive an independent generic
relationship check. These checks are not proof of all TypeScript semantics,
callback invocation, or provider behavior.

For VIR-owned dynamic `Object.get`, the same checker enforces an erased `Js.Any`
result, not a caller-chosen result parameter. The closed `Js.String.fromAny`
predicate has no type parameters and can return only `Js String`. These are
explicit checked contracts with negative compile/configuration tests and native
predicate tests, not derived evidence for arbitrary TypeScript indexed access.
No generic narrowing from `Js.Any` to a `Js α` or `JSL α` is supplied.

### Selected Promise Relationships

The Promise bindings select explicit subsets of the pinned TypeScript
declarations, keeping their generic results:

| Lean operation | Selected TypeScript relationship |
| --- | --- |
| `thenValue` | `Promise<A>.then<B>` with a callback returning `B` |
| `thenPromise` | `Promise<A>.then<B>` with a callback returning native `Promise<B>`, a `PromiseLike<B>` |
| `thenValueWithRejection` | `then<B, B>` with both handlers returning `B`; `B \| B` is `B` |
| `catchValue` | `Promise<A>.catch<A>` with recovery returning `A`; `A \| A` is `A` |
| `thenVoid`, `thenVoidWithRejection` | handlers returning `undefined`, represented by `Unit` |

Every rejection handler receives `Js.Any`: TypeScript's rejection `any` supplies
no evidence for an arbitrary concrete error or Lean payload type. This boundary
exposes it as an unknown JavaScript value requiring explicit narrowing.

The generator verifies the upstream Promise binder, method parameters/defaults,
handler inputs and `R | PromiseLike<R>` alternatives, and result union before
checking the configured Lean types. Tests compile generic wrappers against the
pinned TS library (including native Promise/PromiseLike compatibility), mutate
upstream and configured relationships, and compile positive/negative Lean calls.
These are selected-relationship checks, not a general TS subtype checker.
Callback-local generic binders remain unsupported syntax rather than being
erased into references to outer parameters. The descriptor permits compatible
interface merging that adds a default, but the selected Array/Promise checks
still reject defaults or constraints outside their supported relationships.

These methods call native `.then`/`.catch` unchanged. **`thenValue` does not
exclude promises or thenables.** Native resolution recursively assimilates
returned thenables, including a previously ordinary object whose `then` changes.
Explicit TS generic instantiation admits approximations too: a value wrapper can
have static result `Promise<Promise<string>>` while native resolution settles to
a string. VIR preserves that selected TS relationship rather than erasing every
result or claiming to repair all upstream approximations.

Full overload inference, optional-handler breadth, distinct branch unions and
general PromiseLike/Awaited translation remain unsupported. A preserved TS
relationship is not proof of actual settlement shape, foreign callback behavior
or safe Lean heap recovery. Those payload obligations remain separate from
binding fidelity; these checks do not authorize unchecked `JSL` recovery.

### Reported Contract Claims

Each generated binding operation records this separately from provider and
reachability evidence:

- `preserving` claims that the generated contract preserves upstream-observable
  behavior;
- `changing` identifies an explicit semantic adapter;
- `unreviewed` is binding-author work and must never be presented as faithful;
- `vir-owned` and `local-contract` identify operations whose semantics do not
  come from an external upstream operation.

A TypeScript-derived operation without an operation exception and with an
unmodified single-signature call policy starts with a `preserving` contract
claim. The generator then folds in the ABI profile's receiver and resource
mapping facts; any changing fact makes the complete operation an adapter. A
method policy that selects an overload or changes the exposed parameter list
must set `semantics` and `reason`, unless an operation exception already
supplies that review. Exceptions and
`upstream-adapter` protocols likewise set `semantics` to `preserving` or
`changing`; until then the operation remains `unreviewed` in the author
workbench. This is a contract classification, not provider-behavior
verification. Provider dispatch, retention, rollback, and cleanup remain
separately trusted and tested.

### Direct Value Rule

Generated `Js` bindings transport the upstream value itself, not a VIR props,
node or collection representation. Builders and conversions have separate
names and contract classifications.

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
from retaining a Lean alias. `consumed` marks a terminal operation that takes
the Lean argument and may terminate associated private effect state. It does
not revoke ordinary JavaScript aliases or make a second use unrepresentable in
Lean.

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
- `Document`, `Console`, and `Element` are explicit borrowed receivers;
  separate VIR-owned `current` operations expose the host globals where
  needed.

Binding-library configuration format version 2 makes semantic policy explicit.
Only exactly identical resource marker names may use the short string form.
Qualified or renamed Lean markers, and every host-global receiver choice, must
instead carry `semantics` plus `reason`. These are
operation-policy facts: a changing fact makes the generated operation an
adapter, while only identity mappings and explicitly preserving facts can
contribute to faithful coverage. This keeps widened phantom types and omitted
receivers from being promoted silently.

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

## Generated Binding Operations

`npm run generate:lean-bindings` creates one operation record for every
selected TypeScript operation and every reviewed protocol operation.
It renders the Lean declarations and the binding-policy portions of the
explorer from those records. The records remain an in-memory generation model;
the consolidated explorer report includes them where binding authors need to
inspect their policy and provenance.

Each operation records:

- the TypeScript member, selected signature or accessor shape, source location,
  display text, and upstream documentation;
- the host target and Lean declaration name;
- the effect;
- global or argument receiver policy;
- every argument's Lean type, representation, passing, and retention;
- the result's Lean type, representation, and ownership;
- any operation-specific private active-effect role;
- correspondence and semantic fidelity as separate operation facts;
- provenance for every derived choice;
- the reason for any explicit exception;
- a protocol's machine-readable upstream relation.

The checked-in `Vir/**/Generated.lean` declarations and the explorer's conversion
policy panels are rendered from these records.

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
raw getter/setter pairs. `CanvasStyle.ofString` is a separate explicit
conversion into the string arm of that union; the convenience setters call the
faithful generated property setter after that conversion.

## Method Selection

A uniquely signed TypeScript method needs no method policy. A
`generation.methodPolicies` entry records only a choice or specialization that
cannot be inferred from that declaration:

```json
"methodPolicies": {
  "CanvasRenderingContext2D.arc": {
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

The generator selects a unique function signature automatically. An integer
selects a zero-based overload explicitly. A required
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

Missing overload policies, changed overload layouts, unclassified rest parameters,
unknown parameter names, unjustified required-parameter omissions, and
unsupported parameter or result types fail generation.
TypeScript parameter names that collide with Lean keywords are rendered as
escaped Lean identifiers.

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

- `register` creates a pending timer/frame or React-root teardown record;
- `use` operates through an existing private record without replacing the
  public JavaScript value;
- `release` removes the record and performs the corresponding upstream
  cancellation or unmount.

These roles are declared policy, not mechanically verified provider behavior.
Passive JavaScript values and React hook/node values have no active-effect role;
JavaScript reachability and official React own their normal lifetime.

## Documentation Flow

The TypeScript compiler extracts declaration display text, JSDoc, source
locations, and documentation links into the descriptor. Generation copies
those fields into the generated binding operation and emits the JSDoc plus an
upstream source link on the public Lean declaration. The explorer consumes the
same descriptor and operation record: it renders JSDoc paragraphs and links,
TypeScript and Lean code with language-aware token classes, and the exact
conversion policy that produced each generated declaration. No separate
handwritten method documentation database is involved.

The explorer documents the generated operation's derived policy and provenance.
Provider behavior remains a separately tested runtime claim; it is never
promoted from provider-key presence.

## Exceptions

`generation.exceptions` is keyed by operation id (the host target for direct
operations). An exception must have
a non-empty `reason` and may override only the receiver, named argument role,
type or modalities, result ownership, or effect. A receiver may be projected
away only through an explicit `kind: "none"` exception. Unknown operation ids,
unknown generated argument names, unsupported fields, unsafe borrowed
lifetimes, and exceptions on immediate values are errors.

Exceptions are intended for semantics that TypeScript declarations do not
express, such as a host retaining a callback until explicit release. They are
not a place to restate ordinary profile defaults. The generated operation marks
every override and its reason, so review can distinguish inference from policy.
An exception's optional `semantics` field records whether the reviewed override
preserves upstream behavior or creates an explicit semantic adapter. Omitting
that field leaves the operation visibly unreviewed rather than inferring
faithfulness from its generated shape or provider presence.

## Authored And Generated Ownership

Authored configuration owns:

- the pinned declaration inputs and reviewed mappings (from which the selected
  member set is derived);
- correspondence among TypeScript operations, Lean names, and host targets;
- resource marker names and the named ABI profile;
- reviewed semantic policy for non-identity resource mappings and host-global
  receivers;
- documented semantic exceptions.

Generation owns:

- Lean parameter and result types;
- `@&` placement;
- receiver, argument, result, and effect modalities;
- generated Lean declarations;
- explorer explanations.

Structural records and broader union translations are unsupported. Generic
translation is limited to the selected relationships described above.
