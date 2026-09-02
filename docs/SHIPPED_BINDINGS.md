# Binding reference, shipped inventory, and author actions

The generated binding reference is the primary human report for VIR's
pre-release library surface. One HTML document presents three projections of the
same machine data:

- **Upstream reference** follows the configured upstream TypeScript
  documentation hierarchy and shows only confirmed Lean correspondences as
  bindings.
- **Shipped VIR surface** inventories every generated host boundary, including
  TypeScript-derived operations, upstream adapters, VIR-owned protocols, and
  local contracts.
- **Author actions** lists precise generator, annotation, identity,
  type-translation, and runtime actions for binding authors.

Convenience wrappers and arbitrary Lean dependencies are not upstream API
entries. They do not appear in the primary reference or contribute to upstream
coverage. Author actions may still flag a shipped declaration whose upstream
identity or exception policy is missing.

The report exhaustively scans ordinary `@[vir_js]` declarations and explicit
conversion declarations. Every distinct target must have a matching key in a
shipped provider map, provider-only keys are rejected, and every shipped target
must be reachable from at least one public executable Lean declaration. Each
public connection includes its concrete compiled-IR call path.

Generation indexes every configured TypeScript API group before presenting the
report. Unselected upstream entries remain ordinary documentation coverage;
they are not findings. Authored mappings are confirmed shipped bindings and
name-based candidates require an identity annotation. Every compiled host
declaration must come from a configured generated output; the report displays
the generated/handwritten boundary count explicitly. It also separates
operations derived from selected TypeScript declarations from reviewed
protocol operations. Protocols are further classified as named upstream
adapters, VIR-owned operations, local-contract operations, or unclassified
author debt, so migration progress does not conflate generated source with
direct upstream lowering and intentional convenience APIs do not create false
correspondence actions.

## Fidelity Contract

This check makes six mechanically enforceable claims:

1. Every row comes from elaborated declarations and compiled IR metadata, not
   source-text matching.
2. Lean revalidates every complete signature against `Vir.HostValidation`.
   Ordinary `@[vir_js]` declarations may use only `Unit`, JavaScript resources,
   object handles, and resource-shaped callbacks at the boundary.
3. Conversions between JavaScript values and ordinary Lean values must be
   isolated behind `@[vir_js_explicit_conversion]`; they cannot be hidden in an
   ordinary binding.
4. Every declared target must have a matching key in a shipped browser/React,
   virtual Node, or runtime-intrinsic provider map, and every such provider key
   must have a compiled declaration.
5. Public Lean-to-target links come from transitive references in compiled IR.
   Each link carries its declaration path; the report does not infer callers
   from naming or source text.
6. A reviewed TypeScript property is decomposed into named getter and setter
   operations (getter only for a readonly property). Each operation either
   identifies one host target and one canonical generated public Lean
   declaration, or explicitly records a missing coverage gap. Downstream
   conversion helpers may reach that generated operation, but they are not
   presented as additional upstream property operations.

This prevents accidental representation drift such as exposing a raw Lean
`String` where the JavaScript API returns a `Js String`. Applications may
convert at call sites or in their own policy layer, but the reviewed binding
surface remains one-to-one with the upstream property operations.

Provider reconciliation is target-name presence only. It does not inspect raw
provider argument handling, retention, callback leases, result adoption, or
terminal cleanup, so it is not a mechanical provider-modality audit. The
compiler/runtime check also does not claim that all upstream APIs have been
ported, or that every phantom resource name has been proven equivalent to an
upstream TypeScript type. Configured API groups, type-anchor comparisons, and
focused lifecycle tests provide separate evidence. The explorer keeps these
layers visibly distinct while presenting their findings together.
The consolidated machine report records this guarantee boundary explicitly in
its `boundaryAnalysis` object rather than leaving it implicit in prose.

## Terminology and dispositions

An **API group** is the unit presented in the explorer, such as `Document`,
`HTMLCanvasElement`, or timers. The configuration schema retains the historical
`roots` key, but those entries group upstream entry points, public Lean APIs,
and shipped runtime targets; the UI does not call them roots.

Each upstream member has a generation record with three independent facts:

- **semantic coverage** is `faithful`, `adapter-only`, `unreviewed`,
  `local-contract`, `candidate`, or `not-provided`. It is computed once from
  the canonical operations associated with the member. A changing adapter no
  longer appears as faithful coverage merely because its provider key exists.
  `unreviewed` dominates mixed coverage; otherwise one preserving operation is
  enough for `faithful`, while a member with only changing operations is
  `adapter-only`. Thus a faithful primitive can coexist with named convenience
  adapters without hiding either fact.
- **provenance** records whether upstream-correspondence evidence comes from
  direct TypeScript lowering, a reviewed protocol, an automatic candidate, an
  annotation, or no implementation. This is distinct from declaration
  provenance: all shipped host declarations are generated.
- **disposition** is `generated`, `adapted`, `needs-annotation`, `unsupported`,
  or `not-selected`. `adapted` means a reviewed protocol is linked to an
  upstream or local declaration member. Convenience wrappers are downstream
  Lean APIs rather than upstream members, so they are not a member disposition.
- **evidence status** keeps semantic comparison separate from correspondence:
  `exact` and `compatible` come only from the comparator, `derived` means one
  canonical TypeScript operation produced the Lean declaration,
  `protocol-linked` means reviewed policy names an upstream member, and
  `contract-linked` means a repository-local declaration member is linked.

Only dispositions with an actionable diagnostic appear under author actions.
In particular, `not-selected` is not an error or author action, and
an explicitly `unsupported` upstream member remains a visible reference/roadmap
gap without becoming immediate binding-author work.
Every work item names a diagnostic code, explains the evidence, and gives the
next required action. Reviewed protocols may still use `needs-annotation`
until their upstream identity and direct TypeScript lowering are fully
expressed.

A generated operation whose reviewed mapping has no comparator anchor is
`derived`: the TypeScript shape, ABI policy, and emitted Lean type are one
canonical operation record. An upstream adapter is `protocol-linked`, and a
local declaration operation is `contract-linked`; neither is silently promoted
to semantic `compatible` without comparator evidence.

A **public Lean API** row is a public executable declaration in the measured
`Vir` environment that reaches at least one JavaScript host target. It does not
claim to inventory type-only declarations or pure APIs that never cross the
host boundary. A **host target** is the lower-level dispatch key implemented by
the JavaScript runtime.

Therefore a provider-key-present target proves only that VIR can resolve that
dispatch name, while an automatic correspondence only proposes an upstream
identity. Neither proves raw provider behavior. The user-facing reference never
presents that candidate as a confirmed binding. Compiler and runtime internals
remain author evidence rather than a parallel documentation hierarchy.

## Soundness-first Roadmap

The upstream operation is the source of truth for the faithful binding layer.
The intended construction is:

```text
TypeScript declaration + VIR ABI policy + explicit annotation
  -> canonical operation IR
  -> generated Lean declaration
```

The operation IR preserves JavaScript resources, supported null-only
nullability, overloads, receiver shape, effects, and authored ownership or
retention policy. Descriptors distinguish `null`, `undefined`, and nullish
absence; generation rejects the latter two and optional properties until they
have explicit representations. Convenience conversions belong in a separate
application-facing layer and do not count as upstream bindings.

Faithfulness includes observable behavior, not only declaration shape. The
canonical boundary preserves identity, mutation, argument reuse, success and
failure behavior, callback retention, terminal behavior, and ownership. The
runtime may acquire independent leases internally, but it may not expose a
stronger consumption or conversion policy as though it were upstream
semantics. Managed handles and ergonomic conversions remain explicit adapters.

The explorer reports a semantic relation independently of type evidence. An
exact or compatible comparator result says only that the represented types
compare successfully. It cannot promote a semantics-changing or unreviewed
operation to faithful. Every operation exception and upstream-linked protocol
therefore remains binding-author work until it is classified as preserving or
changing.

An incorrect public binding is a release-blocking defect. An unselected
upstream operation is documentation coverage, not evidence that an existing
binding is unsound. The reference, inventory, and author actions keep those
conditions separate.

Every binding repair or addition should satisfy these landing gates:

1. **Reproducible generation.** Checked-in generated Lean is an exact function
   of pinned declarations, ABI policy, and annotations.
2. **Boundary representation safety.** Compiler validation accepts the
   generated host signature; ordinary bindings contain no implicit
   Lean/JavaScript conversion.
3. **Operation identity.** The configuration selects one upstream operation
   and host target. Writable properties generate getter and setter operations
   independently.
4. **Runtime dispatch presence.** Every generated target has its intended
   shipped provider key, and provider-only keys are rejected. Provider behavior
   remains separately trusted and tested.
5. **Explicit exceptions.** TypeScript deviations and protocols are generated
   from structured, justified operation records. Every protocol declares its
   upstream relation; handwritten host declarations are rejected.
6. **Compiled evidence.** The consolidated gate reaches every target from a
   public Lean declaration; focused runtime suites exercise selected lifetime
   behavior separately.
7. **Semantic relation.** The canonical contract is classified as preserving,
   changing, unreviewed, VIR-owned, or local-contract. Preserving claims cover
   success and failure paths; changing contracts are exposed as adapters, and
   unreviewed contracts remain author actions.

Every external shipped binding is generated. Shipped targets must also acquire
authored upstream identity or an explicit no-parity protocol classification.
Unsupported selected
operations and weak type translations remain author actions; unselected
upstream operations may remain visible in the reference without failing CI.

The abrupt migration covers Browser, JavaScript core, React, Common, Infoview,
and ProofWidgets. Further slices should replace reviewed protocol operations
with direct TypeScript lowering where an upstream declaration exists, without
changing their host target or public faithful type unnecessarily.

Request planners and correspondence ranking consume the same authored
API-group configurations and canonical operation data as generation. A
suggestion never becomes a confirmed binding automatically. Generated
declarations target the faithful layer; conversion wrappers remain an explicit
downstream policy choice.

## Library Configuration

Each Lean source group that owns shipped bindings has a companion
`*.bindings.json` file, validated against
`Vir/bindings.schema.json`:

- `Vir/Browser.bindings.json`
- `Vir/Common.bindings.json`
- `Vir/Js.bindings.json`
- `Vir/React.bindings.json`
- `Vir/Infoview/Surface.bindings.json`
- `Vir/ProofWidgets/Rpc.bindings.json`

Local host protocols use declaration syntax too:

- `Vir/Infoview/Surface.contract.d.ts`
- `Vir/ProofWidgets/Rpc.contract.d.ts`

Every local protocol operation names the exact declaration member it
implements. The generator rejects missing members, while the explorer verifies
that the contract covers every generated target and that its public Lean entry
point reaches that target. The reviewed protocol still owns ABI-specific effect,
resource, callback, and conversion policy that cannot be inferred from the
local declaration alone.

The descriptor generator, Lean generator, and consolidated explorer all load
these files through the same schema validator. Unknown fields and malformed
nested anchors, mappings, ABI profiles, and dependency-policy entries therefore
fail consistently at every configured entry point.

A configuration identifies its compiled Lean modules and divides their targets
into API groups. External groups name their declaration files and upstream
entry points; internal groups explicitly state that they have no external
parity contract. Reviewed anchors and dependency policy live with the group
rather than in parallel symbol, policy, and anchor files. A method mapping
names its target list. A property mapping instead names `get` and `set`
operations, or only `get` for a readonly property, with an exact host target,
public Lean declaration, and comparison anchor for each shipped operation.
An unshipped operation uses an explicit `{ "missing": true, "note": "..." }`
entry, so partial property coverage cannot be mistaken for a faithful pair.
Anchor `portIntent` contains only policy that the comparator mechanically
checks. Lifecycle, retention, or ownership claims that are not yet derived from
the operation IR use `advisorySemantics`; reports label those notes as not
mechanically verified.

Generation rejects an unowned module, a target assigned to zero or multiple
groups, a stale selector, a property operation that disagrees with its reviewed
anchor, or an unclassified public accessor alias. The library configurations
assign every shipped target exactly once.

## Data Flow

```text
TypeScript declarations + configured upstream entry points
  -> complete upstream documentation catalog

binding selection + ABI profile + explicit annotations
  -> canonical operation IR
  -> reproducible faithful Lean declarations

compiled Vir + Vir.Infoview environments
  -> compiler-decoded vir_js metadata
  -> public declaration call reachability and exact paths

browser/React + virtual Node provider keys + runtime intrinsics
  -> strict target-name reconciliation JSON

reviewed protocol operations + correspondence suggestions
  -> direct-lowering and annotation work items

catalog + operation IR + compiled/runtime evidence + work items
  -> one machine report
  -> upstream-shaped reference
  -> complete shipped-boundary inventory
  -> binding-author actions
```

Generate the consolidated local report with human-readable progress output:

```bash
npm run generate:bindings
```

Validate all layers and the explorer contract with:

```bash
npm run check:bindings
```

The Lean compiler inventory and type comparisons are generated under
`build/type-descriptors/`. The consolidated machine report is
`build/bindings/report.json`; the primary human report is
`build/bindings/index.html`. These reproducible reports are ignored build
artifacts, not commit material.

Serve the repository root when source jumps are useful:

```bash
python3 -m http.server 4178 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4178/build/bindings/index.html`.

The document supports library, semantic-coverage, boundary-evidence, and
author-disposition filters;
deep links; upstream TypeScript documentation; inherited-member provenance;
Lean and TypeScript source context; compiled boundary evidence; and light/dark
themes. It omits descriptor dependencies that are not configured upstream
roots or members. Types referenced by signatures remain part of the declaration
rather than a heuristic "related types" section.

Generated boundaries lead with a structured Lean signature derived from the
canonical operation IR. Receiver, argument, result, effect, representation,
passing, retention, and ownership annotations are interactive and expose their
policy provenance on hover or keyboard focus. For TypeScript-derived operations,
the same card aligns the selected TypeScript shape with the emitted Lean
boundary, including omitted or host-fixed parameters. The fully qualified
compiler type remains available under **Exact compiled Lean type**; namespace
elision affects presentation only.

Use **Upstream reference** to browse the upstream hierarchy. A confirmed
entry shows its TypeScript declaration beside the corresponding public Lean
type. Candidates remain labeled unconfirmed and are not displayed as bindings.
Use **Shipped VIR surface** for the reverse map of all generated host
boundaries, including operations without a one-to-one upstream declaration.
Each row identifies its evidence class, generated policy, provider, public Lean
entry point, and compiled call path.

Use **Author actions** for required intervention. Each row describes one
precise action and shows the upstream declaration, current public Lean evidence,
compiled call path, and provider when available. Convenience wrappers are not
shown as upstream operations.

Unselected upstream entries contribute to coverage totals but are not issues.
Explicitly unsupported selected entries appear under `report.json`'s roadmap;
only compiler, provider, reachability, and semantic comparison failures are
issues.

`build/bindings/shipped-v1.coverage.json` and
`build/bindings/shipped-v1.dashboard.html` are lower-level reconciliation
artifacts. Focused type-anchor rendering remains an explicit fixture-debugging
command and is not part of the default binding generation or check workflow.
