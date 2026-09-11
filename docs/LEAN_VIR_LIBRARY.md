# Vir Library

Import `Vir.*` modules to use APIs in the `Lean.Vir.*` namespace. These APIs
call JavaScript while Lean runs through VIR's Wasm interpreter. This guide
helps choose modules, effects and value representations; use the
[binding reference](SHIPPED_BINDINGS.md) for exact generated signatures and
upstream TypeScript correspondences.

Shipped host declarations are generated from `Vir/**/*.bindings.json` into
`Vir/**/Generated.lean`. Authored modules provide types and Lean helpers.
Change the binding configuration when changing a generated declaration; the
[binding translation contract](BINDING_MODALITIES.md) explains conversions,
effects and reviewed protocol operations.

## Modules And Effects

| Import | Use it for |
| --- | --- |
| `Vir` | The common library, browser/React helpers, ProofWidgets notation and package markers. |
| `Vir.Runtime` | `RuntimeM` and Lean-owned mutable `RuntimeRef` cells. |
| `Vir.Js` | Exact JavaScript values, collections, functions, Promises and explicit conversions. |
| `Vir.Common` | Small environment-neutral helpers such as string echo and natural-number addition. |
| `Vir.Browser` | DOM receivers, events, timers, animation and canvas. |
| `Vir.React` | Native React nodes, roots, components and hooks. |
| `Vir.ProofWidgets` | Optional HTML/JSX notation over native React values. |
| `Vir.Infoview` | The optional widget shell, proof surface, RPC and local editor capabilities. |
| `Vir.Attributes` / `Vir.ExternFallback` | Package markers / explicit use of a Lean extern reference body. |

Choose the effect according to the operation:

| Effect | Operations |
| --- | --- |
| `RuntimeM` | Allocate or inspect JS values, update `RuntimeRef` cells, call state setters and perform runtime bookkeeping. |
| `Browser.DomM` | Read or mutate the DOM, handle events, and manage React roots. |
| `React.ReactM` | Construct React values and use component render APIs. |

`RuntimeM` lifts into both `DomM` and `ReactM`; `ReactM` also lifts into
`DomM`. Use `RuntimeM.run` or `DomM.run` at an explicit exported `IO`
boundary. These effects identify the intended host operations; they do not
enforce React purity or hook ordering.

`RuntimeRef α` holds Lean-owned mutable state shared by callbacks. Its
`new`, `get`, `set`, `modify` and `modifyGet` operations run in
`RuntimeM`; replacing the contents follows Lean reference counting.

Repository package commands build the core library automatically.
The optional infoview integration requires `lake build VirInfoview` and the
repository npm dependencies because it generates a JavaScript bundle. For a
downstream project, follow [Lake integration](PACKAGES.md).

## JavaScript Values And Collections

`Js α` carries an exact JavaScript value. Its phantom parameter describes
the expected shape; it neither decodes that value as Lean `α` nor validates
an arbitrary incoming value. DOM markers therefore appear as `Js Element`
or `Js Event`, rather than naked Lean marker types.

Use `JSL α` when JavaScript should store an opaque Lean-owned value.
`LeanRef.toJSL` creates this carrier and `LeanRef.fromJSL` recovers the
Lean value. `JSL α` abbreviates `Js (LeanRef.Handle α)`: a `JSL String`
stores a Lean string, whereas `Js String` is a JavaScript string. Frameworks
store these carriers as ordinary JS objects. The
[host lifetime contract](HOST_BINDINGS.md#lean-backed-javascript-values)
owns foreign-root retention, collection, invalidation and disposal.

Collection parameters have two conventions. For the same DOM elements:

| Type | Container and entries |
| --- | --- |
| `Js.Array Element` | Native JavaScript array; insertion and indexing use `Js Element`. |
| `Js.NodeList (Js Element)` | Native DOM NodeList; its parameter is the complete Lean view of an entry. |
| `Array (Js Element)` | Lean-owned array containing handles to the exact JS elements. |

`Js.NodeList.toArray` copies the JavaScript container into a `Js.Array α`;
it does not materialize a Lean array. `Js.Array.toLeanArray` and
`Js.NodeList.toLeanArray` explicitly produce `Array (Js α)`. The resulting
entry handles remain usable when the source collection is no longer reachable.

Use `Js.Array.getJs` with a JavaScript number index for native indexing.
Its result type follows the array's element parameter. The Lean `item` helper
takes a `Nat` index and returns `none` outside the current length; an in-bounds
sparse slot still contains native `undefined`. Code using the old
`Js.Array.getAs` or `Js.Array (Js α)` spelling should use `getJs` and
`Js.Array α`. The `Js.NodeList (Js α)` and Lean `Array (Js α)` forms
are unchanged.

## Explicit Conversions

`JsValue` converts between Lean values and their JavaScript representations.
All of these conversion pairs run in `RuntimeM`:

| Lean value | JavaScript value | Conversion pair |
| --- | --- | --- |
| `String` | Primitive string | `ofString` / `toString` |
| `Nat` | Nonnegative `bigint` | `ofNat` / `toNat` |
| `Bool` | Boolean | `ofBool` / `toBool` |
| `Float` | Number | `ofFloat` / `toFloat` |

`JsValue.ofNat` preserves arbitrary precision as a JavaScript `bigint`.
`toNat` requires that representation and rejects JavaScript numbers and
negative bigints. Plain `JSON.stringify` rejects bigint values, including
inside records; they are not JSON wire numbers. When an API requires a number,
check its range before converting to `Float`: `ofFloat n.toFloat` alone
does not preserve arbitrary `Nat` precision.

`JsValue.ofNatNumber? : Nat → RuntimeM (Option (Js Float))` returns `some`
of the exact JavaScript number for `0..9007199254740991`, and `none` above
that range. It checks the bound in `Nat` before Float conversion, rejecting
even exactly representable larger integers because they exceed the
safe-integer range.

The infoview `documentPosition` adapter checks coordinates against
`0..Number.MAX_SAFE_INTEGER` before converting accepted bigints to numbers.
It rejects out-of-range coordinates instead of rounding or clamping them.
These host-value conversions are distinct from the
[structural export representation](JS_API.md#calls-and-manifest) used when
JavaScript calls a Lean entrypoint.

For values whose shape is unknown, `Js.erase` forgets only the phantom type
and returns the same value as `Js.Any`, including JS primitives, `null` and
`undefined`. `Js.cast` uses the predicate and effect selected by a `Js.Cast`
instance; its result is `Except Js.TypeConvError (Js target)` inside that
effect. A successful check preserves identity.

Dynamic `Js.Object.get` returns `Js.Any`, including `undefined` for a
missing property. Prefer a generated getter for a known field contract.
For a primitive string, `Js.String.fromAny` checks the exact value and throws
`TypeError` on other kinds, including boxed strings; it does not coerce.

`Js.Nullable α` represents native `null` or a `Js α` value.
`Js.Nullable.toOption` and `ofOption` explicitly convert that view at the
Lean API edge.

`Js.Function1 argument result` describes an exact unary JavaScript function.
Native functions need no conversion; `Js.Function.call` and `callVoid`
invoke them. Use `Js.Function.ofLean` or `ofLeanVoid` when converting a
Lean closure into a JavaScript function. The call-shape parameters describe
Lean boundary views, such as `Js α` and `Unit`.

`Js.Promise.catchValue` receives a `Js.Any` rejection value and recovers
to the original Promise's result type. Check rejection values before typed
use. See the [RPC and Promise guide](INFOVIEW.md) for
continuations, cancellation and exact server-reference graphs.

## Packages And Host Imports

`@[vir_export]` selects a declaration for JavaScript calls;
`@[vir_startup]` selects an exported zero-argument, `Unit`-returning
startup hook. Import `Vir.Attributes` directly or through `Vir`.
[Packages](PACKAGES.md) covers registration, marker validation, visibility,
generation and loading; [module inputs](GENERATE_PACKAGE.md#input-contract)
explains compiled and live snapshots.

`Vir.ExternFallback` provides `vir_extern_fallback` for explicitly packaging
a transparent extern's Lean reference body without changing native compilation.
Use the [fallback workflow](PACKAGES.md#use-a-lean-extern-reference-body)
for its restrictions and ownership rules.

Exported Lean functions may use the supported
[structural interface types](IRPKG_FORMAT.md#interface-descriptors).
Ordinary `@[vir_js "target.name"]` host imports have a narrower boundary:
`Unit`, exact `Js`/nullable values, and top-level Lean callback arguments
whose own arguments and result are `Unit` or JS values. Nested callbacks
and polymorphic callback signatures are unsupported. Conversion operations are
separately marked with `@[vir_js_explicit_conversion]`; ordinary bindings
cannot silently decode raw Lean scalars or structures.

Leading erased type parameters are allowed on host imports and are skipped
before dispatch to JavaScript. They still count toward the IR arity limit of
six, as does the world token of an effectful call. A package supports at most
128 host imports. Exported entrypoints with erased type parameters require a
concrete wrapper.

Host calls execute synchronously. A native Promise can cross as an exact
`Js` result, but the dispatcher does not await it. A host import is separate
from a native extern registration: its target must match a JavaScript provider
key. Follow [custom host targets](HOST_BINDINGS.md#custom-targets) and
[JavaScript runtime composition](JS_API.md#host-bindings) for provider setup.
[HostInterop](../examples/HostInterop.lean) supplies executable Lean examples.

## Browser And Widget Workflows

Browser methods take explicit JS receivers. `Document.current` and
`Console.current` separately obtain host-global objects; helpers ending in
`String` convert Lean text while keeping receiver selection explicit.
Checked operations such as `EventTarget.asElement`,
`KeyboardEvent.fromEvent` and `ElementCSSInlineStyle.fromElement` preserve
the input identity on success. See the [binding reference](SHIPPED_BINDINGS.md)
for the full DOM and canvas surface.

`AbortController.create`, `getSignal` and `abort` expose the native
controller, signal and no-reason abort operation. Dropping a handle or disposing
VIR does not abort the controller. Applications also remove native DOM listeners
using their exact receiver, event name and function identity; see
[active-resource ownership](HOST_BINDINGS.md#active-resources).

The [React guide](REACT.md) owns nodes, roots, component identity and hooks;
[ReactCounter](../examples/tutorials/ReactCounter.lean) is the small executable
introduction. React providers require the real browser host. The Node wrapper
provides environment-neutral JavaScript-value and console operations only.

For `Vir.Infoview`, follow [Infoview widgets](INFOVIEW.md#widget-activation)
for activation and the [RPC tutorial](../examples/tutorials/RpcReferenceWidget.md)
for server calls. Its clipboard and editor-command helpers expose local
synchronous capabilities with Lean `Bool` results. In particular,
`Infoview.Clipboard.writeText` does not claim the asynchronous browser
Clipboard API contract; native RPC calls return exact Promises.

## Troubleshooting

Inspect the generated package report when generation fails:

| Report section or symptom | What to check |
| --- | --- |
| `JavaScript Host Imports` | The required declaration and target were collected. |
| `Package Diagnostics` | Argument/result types and callback shapes fit the supported boundary. |
| `Missing Native Extern Registrations` | The Lean IR closure reached a missing native primitive; adding a JS provider does not supply it. |
| Missing host import at runtime | The manifest target string exactly matches its `hostBindings` key and the correct browser/React host is installed. |
| A returned Promise is rejected during lowering | Declare an exact `Js` result; structural or immediate results cannot await settlement in the synchronous dispatcher. |

Use [HARNESS.md](HARNESS.md) to select the relevant check and its prerequisites.
