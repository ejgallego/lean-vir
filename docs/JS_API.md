# JavaScript Runtime API

`web/src/vir-runtime.js` loads `vir-upstream.wasm`, loads a non-empty set of
manifest-bearing `.irpkg` members, and exposes their aggregate Lean declarations
through a generic JavaScript call API without requiring callers to manage WASM
memory. A focused `.irpkg` is loaded as a one-member set.

For the end-to-end "my Lean function from my JavaScript code" workflow, start
with `docs/CALL_LEAN_FROM_JS.md`.

The module is also exposed through the package entry point:

```js
import { createVirRuntime, VIR_HOST_DISPOSE } from "lean-vir";
```

Node tests and command-line tools can import the environment-neutral wrapper:

```js
import {
  createVirRuntime,
} from "lean-vir/vir-runtime-node";
```

It does not emulate a DOM or React. Packages with browser imports must run in a
browser or receive an explicit external `hostBindings` implementation.

Custom hosts can import the built-in binding factories directly:

```js
import {
  createBrowserDocumentHostBindings,
  createBrowserElementHostBindings,
  createHostLifecycle,
} from "lean-vir/host-bindings";
```

Browser apps that render `Lean.Vir.React.Node` import the React binding factory
from the separate React entry point:

```js
import { createBrowserReactHostBindings } from "lean-vir/react-host-bindings";
```

When composing groups that create active registrations, pass the same
`createHostLifecycle()` so runtime disposal can terminate them together.
Passive JavaScript values need no shared store.

## WASM Artifact Selection

Distribution builds ship two interpreter artifacts:

- `vir-upstream.wasm`: stripped release artifact, used by default.
- `vir-upstream.dev.wasm`: optimized, unstripped companion artifact for
  debugging. It is not an `-O0` build.

Applications that serve both files beside each other can opt into the debug
artifact by setting `debugWasm: true`:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  debugWasm: true,
  irPackageSet: [await fetchBytes("fixtures-basic.irpkg")],
});
```

When `debugWasm` is true, the runtime derives `*.dev.wasm` from `wasmUrl`.
Pass `wasmDebugUrl` when the debug artifact lives at a different URL. If no
`wasmUrl` is supplied, the factory defaults to `vir-upstream.wasm`.

## Runtime Module Map

The browser app, Node wrapper, and SDK artifact share these JavaScript modules:

| Module                               | Role                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `vir-runtime.js`                     | Public runtime facade, WASM instantiation, package loading helpers, and host import wiring.               |
| `vir-runtime-node.js`                | Node wrapper with environment-neutral JavaScript value and console bindings.                             |
| `runtime/call-timing.js`             | Internal accumulator for opt-in synchronous runtime call phase attribution.                               |
| `runtime/callbacks.js`               | Private Lean closure roots associated with ordinary JavaScript functions.                                 |
| `runtime/cleanup.js`                 | Cleanup error collection with deterministic single-error and aggregate reporting.                         |
| `runtime/core.js`                    | Package loading, manifest export tables, call resolution, memory helpers, and runtime/callback lifecycle. |
| `runtime/object-values.js`           | Object ABI lowering and lifting between JavaScript values and owned Lean objects.                         |
| `runtime/vir-codec.js`               | Binary reader/writer and interface type descriptor codec.                                                 |
| `runtime/host-state.js`              | Host import dispatch, exact-value externref roots, binding lookup, and disposal.                          |
| `runtime/object-abi.js`              | Object ABI support checks, layout planning, scalar packing, and unpacking helpers.                        |
| `runtime/object-abi-exports.js`      | Shared object ABI export-name manifest used by runtime checks and Wasm linker tooling.                    |
| `runtime/vir-value-normalizers.js`   | Input normalization helpers used by object ABI lowering.                                                  |
| `vir-host-bindings.js`               | Public common/browser host binding factories and stable re-exports.                                       |
| `host-boundary.js`                   | Exact-value externref roots and host-call rollback transactions.                                          |
| `host/vir-active-host-bindings.js`   | Shared active lifecycle plus schedule and frame teardown.                                                 |
| `host/vir-infoview-host-bindings.js` | Repository-owned infoview/ProofWidgets command protocol and validation.                                   |
| `react/vir-react-root.js`            | Exact React root creation, rendering, and teardown forwarding.                                            |
| `vir-react-host-bindings.js`         | Browser React root/component/hook bindings; imports `react` and `react-dom/client`.                       |
| `runtime/interface-manifest.js`      | Manifest validation, diagnostics, and type formatting helpers.                                            |
| `runtime/interface-tags.js`          | Shared interface descriptor tag constants and JSON-input tag set.                                         |

Application code normally imports only `lean-vir`, `lean-vir/vir-runtime-node`,
`lean-vir/host-bindings`, or `lean-vir/react-host-bindings`. React browser
bindings are intentionally exported only from
`lean-vir/react-host-bindings`, keeping `lean-vir/host-bindings` free of React
and `react-dom/client` dependencies.
The SDK archive also contains the nested `runtime/`, `host/`, and `react/`
modules because those public entry files use relative imports. Treat those
nested modules as revision-locked internals unless this document explicitly
names an entry point above.

## Host Bindings

The browser runtime installs the built-in `common.*` and `browser.*` host
bindings by default. The complete target map, factory list, custom binding
rules, and cleanup behavior are documented in
`docs/HOST_BINDINGS.md`.

`defaultHostBindings` may be either a binding map or a function returning a
binding map. To enable browser React roots while keeping non-React imports free
of React dependencies, compose the React binding group explicitly:

```js
import { createVirRuntimeFactory } from "lean-vir";
import { createBrowserHostBindings } from "lean-vir/host-bindings";
import { createBrowserReactHostBindings } from "lean-vir/react-host-bindings";

const factory = createVirRuntimeFactory({
  wasmUrl: "vir-upstream.wasm",
  defaultHostBindings: () =>
    createBrowserHostBindings({
      reactHostBindings: createBrowserReactHostBindings,
    }),
});
```

The `reactHostBindings` option is deliberately a factory. The browser host
passes its own lifecycle to that factory so runtime disposal reaches every
React root; preconstructed binding maps are rejected.

## Browser Usage

```js
import { createVirRuntime, fetchBytes } from "./src/vir-runtime.js";

const createForMember = async (path) =>
  createVirRuntime({
    wasmUrl: "vir-upstream.wasm",
    irPackageSet: [await fetchBytes(path)],
  });

const vir = await createForMember("fixtures-basic.irpkg");
const hostVir = await createForMember("demo-host.irpkg");
const prettyVir = await createForMember("pretty-printer.irpkg");
const leanVir = await createForMember("fixtures-lean.irpkg");

console.log(vir.call("fib", 12));
console.log(vir.exportsByName.SortDemo_demo());
console.log(vir.exportsByName.SortDemo_demoFromArray([4, 1, 3, 2]));
console.log(vir.call("Vir.Fixtures.Basic.stringUtf8RoundtripScore", "Aé∀Z"));
console.log(vir.call("Vir.Fixtures.Basic.byteArrayInputScore", [65, 66, 67]));
console.log(hostVir.call("HostInterop.titleHandshake", "browser handshake"));
console.log(
  prettyVir.call(
    "Vir.Fixtures.FormatPretty.formatPrettyCaseAtWidth",
    "list",
    12,
  ),
);
console.log(
  leanVir.call("Vir.Fixtures.ExprPrinter.exprKindScore", {
    kind: "bvar",
    index: 4,
  }),
);
```

There is also a minimal browser page at `/runtime-example.html` that imports the
runtime directly and prints sample calls.

## Module Package Sets

Lake's `:vir` facet writes a package-set descriptor whose members are
ordered dependencies first and public root last. Load it directly by URL:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageSet: "ModuleSetFixture/Root.irpkg-set.json",
});

console.log(vir.packageInfo.packageCount);
console.log(vir.call("ModuleSetFixture.Root.answer"));
```

`irPackageSet` accepts a descriptor URL, the structured value returned by
`fetchIrPackageSet`, or a non-empty array of member bytes in descriptor order.
On an existing factory-managed runtime,
`vir.loadIrPackageSetBytes(members)` validates the complete set in a fresh WASM
instance before handover. `packageInfo.count` is the aggregate declaration count;
`packageInfo.byteLength` is the sum of all members.

To separate transport from runtime creation, use the factory fetch API:

```js
const factory = createVirRuntimeFactory({ wasmUrl: "vir-upstream.wasm" });
const packageSet = await factory.fetchIrPackageSet(
  "ModuleSetFixture/Root.irpkg-set.json",
);
const vir = await factory.createRuntime({ irPackageSet: packageSet });
```

`fetchIrPackageSet` validates the descriptor, resolves normalized relative
member paths, fetches them in parallel, and verifies every declared byte length
and SHA-256. Runtime creation then parses every member before Wasm instantiation,
binds its embedded `packageSetMember` module and role to the descriptor entry,
requires dependency-first/root-last order, and rejects mixed Lean toolchain or
format identities. It returns `{ format, version, descriptorUrl, members }`; each
member preserves its `module`, `role`, resolved `url`, integrity metadata, and
`bytes`. Passing that structured value as `irPackageSet` keeps transport
identity in `vir.packageInfo.packageSet`; runtime metadata omits the member
bytes. Passing a byte array is the low-level form for hosts that intentionally
manage descriptor transport themselves; embedded member identities, order, and
toolchain consistency are still validated, and `packageInfo.packageSet` is
`null`. A custom `fetchBytes` factory option can
provide filesystem, cache, or authenticated transport semantics.

The runtime validates or fetches `irPackageSet` before instantiating Wasm. An
invalid descriptor object, empty byte array, or failed member integrity check
therefore cannot allocate a throwaway interpreter instance.

The browser and Node runtime entry points also export
`IR_PACKAGE_SET_FORMAT`, `IR_PACKAGE_SET_VERSION`, `PACKAGE_TARGET_MODE`, and
the package-target label/format helpers for tooling that inspects or presents
these contracts. Applications that only consume Lake-generated sets do not
need to use these constants directly.

## Reusing The Compiled Module

Use a factory when creating multiple fresh interpreter instances from the same
WASM module:

```js
import { createVirRuntimeFactory, fetchBytes } from "./src/vir-runtime.js";

const factory = createVirRuntimeFactory({ wasmUrl: "vir-upstream.wasm" });
const packageMemberBytes = await fetchBytes("fixtures-basic.irpkg");

const first = await factory.createRuntime({
  irPackageSet: [packageMemberBytes],
});
const second = await factory.createRuntime({
  irPackageSet: [packageMemberBytes],
});
```

## Replacing A Package Set

`vir.loadIrPackageSetBytes(members)` is synchronous once the Wasm module has been
compiled. Calling it on a loaded, factory-managed runtime preserves the public
`vir` object but replaces its underlying Wasm instance:

```js
const factory = createVirRuntimeFactory({ wasmUrl: "vir-upstream.wasm" });
const vir = await factory.createRuntime({
  irPackageSet: firstPackageMembers,
});

vir.loadIrPackageSetBytes(secondPackageMembers);
console.log(vir.call("SecondPackage.entry"));
```

The second package set is loaded and prepared, then manifest-validated before
its initializers run in a fresh candidate instance. If that work fails, the candidate is
disposed and the first package remains usable. After a successful handover,
old object pointers, Lean-backed callback/JSL roots, externref roots, active
registrations, and resolved call slots are invalid. The runtime releases the old set's resources once,
reattaches the new host state to the same public wrapper, and rebuilds its
manifest lookup and call caches.

If cleanup of the old instance throws during handover, cleanup still attempts
every old resource and callback, the candidate is discarded, and the public
wrapper becomes disposed. This avoids exposing either a partially torn-down
old instance or a partially adopted replacement.

Factories reuse the compiled `WebAssembly.Module`, not interpreter state.
User-supplied binding maps shared across a handover are reference-leased so
their cleanup hook runs once when the final runtime using the map is disposed.

## Calls And Manifest

- `vir.interfaceManifest` is the embedded package manifest. Treat it and its
  nested type descriptors as read-only after installation: the runtime caches
  derived export, layout, and normalization plans for the loaded package.
- `vir.packageMetadata` is `vir.interfaceManifest.metadata`, including the
  package format version, Lean toolchain, source targets, and resolved roots.
  Wall-clock generation time is intentionally confined to diagnostic reports.
- `vir.call(name, ...args)` accepts a manifest `id`, `jsName`, or Lean
  declaration name.
- `vir.callTimed(name, ...args)` performs the same call and returns
  `{ value, timings }` for opt-in phase attribution.
- `vir.exportsByName.<jsName>(...args)` exposes valid generated JS names as
  methods.
- `vir.runStartupEntries()` invokes zero-argument exports whose manifest entry
  has `startup: true`, in manifest order. Successful hooks run once per loaded
  package; a failed call can be retried without repeating earlier hooks.
- `vir.interfaceManifest.exports[].startup` distinguishes `@[vir_startup]`
  hooks from ordinary `@[vir_export]` calls.
- `vir.packageInfo.interfaceExports` reports the number of generated exports.
- `vir.packageInfo.hostImports` reports the number of JavaScript host imports.
- `vir.packageInfo.packageCount` reports the package-set member count.

`callTimed` reports successful synchronous calls with this stable timing shape:

```js
const { value, timings } = vir.callTimed("MyPackage.render", input);

console.log(value);
console.log(timings);
// {
//   marshalMs: 0.12,
//   executeMs: 1.84,
//   decodeMs: 0.31,
//   hostMs: 0.27,
//   totalMs: 2.34,
// }
```

The phase boundaries are runtime-internal:

- `marshalMs` measures descriptor-guided argument lowering plus construction of
  the object-pointer `argv` array in Wasm memory.
- `executeMs` measures precisely the synchronous
  `vir_call_resolved_objects(...)` export invocation. JavaScript host imports
  reached by the interpreter therefore remain inside this phase.
- `decodeMs` begins after that export returns and includes host/runtime error
  checks, result lifting and copying, temporary `argv` release, and result
  object release.
- `hostMs` is nested attribution for synchronous application host imports
  handled by `vir_js_call_objects`. It is part of `executeMs`, not a fourth
  sequential phase, and does not include later asynchronous work or rendering.
- `totalMs` is measured independently around the complete public call, from
  name lookup through cleanup. Manifest checks, cached-plan lookup, call-slot
  resolution, and instrumentation overhead can therefore appear only in the
  difference between `totalMs` and the sequential phases.

The timing fields are not generally additive. `hostMs` overlaps `executeMs`,
and `totalMs` is an independent wall measurement rather than the sum of the
other fields. Across repeated samples, each phase median is also computed
independently, so phase medians need not sum to the median `totalMs`.

The method throws the same errors as `call`; failed calls do not return a
partial timing report. Ordinary `call` and generated `exportsByName` methods do
not read the clock. Application projection, JSON conversion, DOM/render work,
and reporting UI remain consumer-owned and should be timed outside this API.
This is a JavaScript runtime API addition; it requires no Wasm ABI, `.irpkg`
package-format, or Lean toolchain version change.

Supported interface types are `Unit`, `Nat`, `Int`, `Bool`, `String`, `Float`,
`Float32`, `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`, `ByteArray`,
recursive `Array α`, `List α`, `Option α`, `α × β`, `Sum α β`, and `Except ε α`
shapes over supported types, non-indexed user-defined structures including
parameterized instances, nullary inductive enums, non-indexed custom inductives
with nullary or runtime-payload constructors, opaque host resources, and
`Lean.Expr`. `Lean.Vir.Js α` is an opaque `Js` resource for JavaScript-owned
objects; the `α` parameter is not decoded while the value remains in the JS
object lane. DOM and React object markers such as `Lean.Vir.Browser.Element`
and `Lean.Vir.React.Root` must therefore appear as `Lean.Vir.Js ...` at the
boundary.

The broad structural surface above is the descriptor-guided object lowering
surface for JavaScript-to-Lean export calls. Host imports are narrower than exports:
low-level JavaScript imports use `Unit`, `Lean.Vir.Js α` resources,
`Lean.Vir.Js.Nullable α` resources for JavaScript `null`, callback arguments
whose own arguments/results are `Unit` or resources, or explicit conversion targets such as
`js.nat.value`; concrete Lean-owned values can also opt into the
`js.leanRef`/`js.leanRef.value` object-handle boundary, which stores the Lean
object behind a `Lean.Vir.JSL α` resource instead of decoding it to JavaScript.
The JSL payload is an ordinary self-owning JavaScript object.
Ordinary Lean references and JavaScript references use their respective native
reachability rules; VIR does not expose a separate JSL retain/release protocol.
The retained Lean value is released when JavaScript collects the object on a
host with finalization support, or synchronously when the package/runtime is
disposed. Host imports may additionally receive Lean function values as
callbacks, including event handlers retained by `Lean.Vir.React.Node` resources
created through `react.node.createElement`.
Other raw Lean scalar, structure, array, list, option, and product imports are
rejected by package generation.
Exported Lean entrypoints and host imports may be pure or use a
recognized synchronous effect. JavaScript resource/runtime APIs use
`Lean.Vir.RuntimeM α`; DOM and React-root imports use
`Lean.Vir.Browser.DomM α`; React render-construction imports use
`Lean.Vir.React.ReactM α`. Effect failures currently surface as call failures.
The JSON manifest records those as `effect: "pure"`, `"runtime"`, `"io"`,
`"dom"`, or `"react"` for tooling and documentation. The wasm call payload
still lowers them to pure versus effectful execution.

Large exact integer values are returned as decimal strings. ByteArray results
are returned as `Uint8Array`; `Float` and `Float32` values are JavaScript
numbers. Top-level `Float`, `Float32`, `UInt64`, and trivial wrappers over them
use generated Lean `_boxed` declarations automatically.

`Lean.Vir.JsValue.ofFloat` and `Lean.Vir.JsValue.toFloat` also accept every
JavaScript number and preserve NaN, infinities, and signed zero across the
opaque `Lean.Vir.Js Float` resource boundary.

Nullary inductive enums use their generated JavaScript constructor name in both
directions.

Options use `null` for `none` and the bare inner value for `some`. Products use
`{ fst, snd }` in both directions. Arrays and lists use JavaScript arrays,
`ByteArray` uses `Uint8Array`, floats use JavaScript numbers, and `Sum`/`Except`
values use `{ kind, value }`.
Lowering accepts the same canonical shapes that lifting returns; text parsing
and other UI conveniences belong in application code. Non-indexed custom inductives use
canonical constructor objects only: nullary constructors accept and return
`{ kind }`, single-field constructors accept and return `{ kind, value }`,
and multi-field constructors accept and return `{ kind, fields }`.
Constructor fields whose Lean type is `optParam α default` use the same
JavaScript representation as `α`; they are still explicit fields in the
canonical constructor object when the runtime constructor stores them.
For example, a recursive `Tree Nat` value with constructors
`leaf (value : Nat)` and `branch (left right : Tree Nat)` is:

```js
{
  kind: "branch",
  fields: {
    left: { kind: "leaf", value: 4 },
    right: { kind: "leaf", value: 5 },
  },
}
```

For a custom inductive with a nullary constructor and a recursive single-field
constructor, use `{ kind: "null" }` and `{ kind: "array", value: [...] }`.
Tagged unions use their canonical `{ kind, value }` representation in both
directions; alternate tag fields and single-constructor-key objects are not
accepted.

Non-indexed structures, including parameterized instances like `Box Nat` and
`Tagged (Array String)`, are accepted and returned as objects keyed by their
Lean field names; inherited parent fields are accepted and returned as flattened
object keys. A direct recursive structure such as
`{ label : String, next : Option Chain }` uses a normal nested record:

```js
{ label: "root", next: { label: "leaf", next: null } }
```

Direct `Bool`, `UInt*`, `USize`, and enum fields, including single-field
wrappers such as `Box UInt32`, use the same JS values as standalone
arguments/results. These shapes can be nested, for example `Option (Array Nat)`,
`List (Nat × String)`, `Except String (Option (Sum Nat Nat))`, a structure
containing another structure, and `Array Lean.Expr`.

Lean declarations use the real `Lean.Expr` type directly. At the JavaScript
boundary, `Lean.Expr` values use structural objects such as
`{ kind: "const", name: "Nat", levels: [] }`,
`{ kind: "app", fn, arg }`, or `{ kind: "bvar", index: 0 }`. Level values use
the same shape with `kind` values `zero`, `succ`, `max`, `imax`, `param`, and
`mvar`. Resolved calls lower these values through the object ABI into real Lean
expression objects. Metadata expression inputs are accepted by lowering their
inner expression; metadata results preserve a structural `mdata` wrapper.

Package loading validates the embedded interface manifest before any generated
entry is exposed. Malformed type trees, invalid structure layouts, unsupported
interface descriptor tags, duplicate export names, and bad enum constructor
metadata are reported as package-load errors.

## Lean To JavaScript Host Imports

Lean sources can call synchronous JavaScript functions through declarations
marked with `@[vir_js "..."]`. See `docs/LEAN_VIR_LIBRARY.md` for the
Lean-side API reference. The host-import boundary is deliberately narrower than
the exported-call boundary: custom `@[vir_js]` declarations should use
`Unit`, `Lean.Vir.Js α` resources, `Lean.Vir.Js.Nullable α` resources for
JavaScript `null`, and callback arguments whose own arguments/results are
`Unit` or resources. Nested callbacks are rejected. Raw Lean scalars,
structures, arrays, lists, options, and products are rejected unless the
declaration is an explicit conversion target such as `js.string.value` or
`js.nat.value`.

Import one of the provided modules:

```lean
import Vir.Browser

def titleRoundtrip (title : String) : Lean.Vir.Browser.DomM String := do
  let document ← Lean.Vir.Browser.Document.current
  Lean.Vir.Browser.Document.setTitle document (← Lean.Vir.JsValue.ofString title)
  Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Document.getTitle document)
```

`Document.title` is exposed as the faithful `getTitle`/`setTitle` property
pair with an explicit `Js Document` receiver. `Document.current` separately
retrieves the host-global document as an exact JavaScript value. Applications
choose where to place conversions or other policy; the binding layer does not
hide global receiver selection inside the upstream operation.

The full Lean-side declaration list is maintained in
`docs/LEAN_VIR_LIBRARY.md`. The JavaScript target map, custom binding examples,
and resource lifetime rules are maintained in `docs/HOST_BINDINGS.md`.

The built-in `common.*` and `browser.*` targets do not require a
`hostBindings` option:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageSet: [await fetchBytes("demo-host.irpkg")],
});

console.log(vir.call("HostInterop.titleHandshake", "browser handshake"));
```

Browser React root, native Node construction, component, and hook targets are
provided by `lean-vir/react-host-bindings`.
Use the `defaultHostBindings` composition shown above when a browser package
calls `Lean.Vir.React.Root.*`, `Lean.Vir.React.Node.*`, or
`Lean.Vir.React.Hooks.*`. `Document.current` requires `globalThis.document` in
the browser host. The Node wrapper does not provide document, event, or React
operations. Supply an external host explicitly when a non-browser environment
can implement them.

Custom target bindings are passed through `hostBindings`; user bindings
override defaults. Bindings receive the exact JavaScript values and return a
value matching the manifest host boundary mode. `Js.Nullable` is the actual
value or `null`; it is not a wrapper. Explicit conversion imports receive or
return decoded scalar values for that named converter. Host imports are
synchronous; returning a
`Promise` is an error. Object-style `imports` factory options are treated as
overrides on top of the generated import table. If you provide a custom
`imports` function to `createVirRuntimeFactory`, call
`createVirImports(module, overrides, hostState)` or otherwise install
`env.vir_js_call_objects` plus the `env.vir_resource_*` root-table imports.

Custom imports can be declared directly:

```lean
import Vir.Js

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : @& Lean.Vir.Js Nat) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

def bumpFromJs (n : Nat) : Lean.Vir.RuntimeM Nat := do
  let input ← Lean.Vir.JsValue.ofNat n
  let output ← jsBumpNat input
  Lean.Vir.JsValue.toNat output
```

Bind custom targets when constructing the runtime. User bindings override the
default `common.*`, `browser.*`, and `react.*` bindings:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageSet: [await fetchBytes("custom.irpkg")],
  hostBindings: {
    "demo.bumpNat": (n) => n + 1n,
  },
});

console.log(vir.call("bumpFromJs", 41)); // "42"
```

Bindings receive decoded JavaScript values and return a value matching the Lean
result type. `Unit` returns use `undefined`. Function-valued Lean arguments are
ordinary callable JavaScript functions. Store and invoke them exactly as in
JavaScript; there is no public retain/release protocol. JavaScript reachability
keeps their private Lean roots alive, with runtime disposal as the deterministic
cleanup boundary. If argument conversion, binding execution, synchronous-result
validation, or result conversion fails, the runtime releases callbacks lifted
for that failed call. Built-in active-resource creators also roll back a newly
installed timer, animation frame, or React root when the result cannot be
published to Lean.
Object-style
`imports` factory options are treated as overrides on top of the generated
import table. If you provide a custom `imports` function to
`createVirRuntimeFactory`, call `createVirImports(module, overrides, hostState)`
or otherwise install `env.vir_js_call_objects` plus the resource-root imports.

## Closure And Resource Lifetime

JavaScript values returned by VIR are the actual values, not releasable runtime
wrappers. Ordinary values follow JavaScript reachability. A host
binding can store and invoke a Lean callback like any other function:

```js
hostBindings: {
  "demo.withCallback": (callback) => callback(41),
}
```

Lean callbacks and JSL objects have private WeakMap state that roots their Lean
payload. `FinalizationRegistry` is a best-effort abandonment backstop; its
schedule is not deterministic. `vir.dispose()` is the deterministic boundary:
it releases remaining Lean roots and invalidates subsequent callback calls.

Timers, frames, and React roots are active resources with explicit platform
termination. Each built-in `HostLifecycle` entry stores its exact cleanup
function; it does not infer cleanup from methods on the JavaScript value. A
private host-call transaction also rolls back a newly created active resource
if result lowering fails. Passive values and native event listeners are never
inserted into this lifecycle; the DOM retains a listener until the caller
removes that exact function or the target becomes unreachable.

Synchronous JavaScript exceptions raised by a host binding are recorded by the
Wasm import boundary and consumed by the owning call. This applies equally to
top-level exports and callback calls: the original host error is thrown once
before any placeholder interpreter result can be treated as success.

Cleanup is terminal and comprehensive: all binding hooks, active resources,
Lean object handles, JSL cells, and callbacks are attempted even if one throws.
One cleanup failure is rethrown directly; multiple failures are reported as an
`AggregateError` in cleanup order. The runtime remains disposed, and a later
`dispose()` is a no-op.
Calling `vir.loadIrPackageSetBytes(...)` on a runtime that already has a package
set loaded performs an atomic fresh-instance replacement as described above.
Old package resources are cleaned up only after the candidate set has loaded
successfully. See [host bindings](HOST_BINDINGS.md) for the complete boundary
contract and the
[event callback roadmap](EVENT_CALLBACK_ROADMAP.md) for callback-specific
follow-up work.

## Trust Boundary

The current `.irpkg` loader is intended for generated project artifacts and
local developer experiments. It treats the package bytes and the embedded
interface manifest as trusted inputs: the manifest describes the Lean
declarations, runtime layouts, and JavaScript-callable ABI that the WASM shim
uses when it builds Lean objects and decodes results.

The browser's WASM sandbox still contains the loaded code, but it does not make
malformed or hostile packages a supported public input format. A bad package may
trap the interpreter, exhaust the small demo memory budget, hang the current
tab, or produce invalid results if its manifest lies about declaration types or
runtime layouts. The hosted `/dev.html` runner is therefore a convenience tool
for trusted packages, not a hardened service for arbitrary third-party
packages.

Before treating `.irpkg` files as untrusted user content, the runtime should
move ABI lookup into the package provider, validate layouts in the WASM shim,
add package size and descriptor-depth limits, and run calls in a recoverable
worker context.

## Generate A Local Package

Generate a package from one Lean file and one or more root declarations:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg SortDemo.demo
```

Omit roots to auto-discover public source definitions:

```bash
npm run generate:irpkg -- examples/Fib.lean build/generated/fib.irpkg
```

The command prints the package path, report path, package format, toolchain,
declaration count, interface export count, JavaScript host import count, and
target roots. The same summary is embedded in the manifest metadata so
JavaScript and `/dev.html` can show exactly what was loaded.

Inspect the embedded manifest without loading the browser:

```bash
npm run inspect:irpkg -- build/generated/fib.irpkg
```

The inspector also prints the package section directory so the binary envelope,
manifest, and loader-visible payloads can be reviewed together.

Serve the generated `.irpkg` next to `vir-upstream.wasm`, or upload it through
`/dev.html` while iterating locally. The runtime only needs URLs or bytes for
the two assets:

```js
const vir = await createVirRuntime({
  wasmUrl: "/vir-upstream.wasm",
  irPackageSet: [await fetchBytes("/my-package.irpkg")],
});
```

## Current Limits

The browser loads descriptor-ordered sets of format-10 `.irpkg` members. A
focused package is represented as a one-member set. It does not load `.olean` or
Lean's raw `.ir` format in the browser. Unsupported requested
exports fail during package generation instead of being omitted silently, and a
failed package load clears the runtime's package metadata instead of leaving
stale declarations callable. JavaScript host imports are sync-only and limited
to 128 imported declarations with IR arity at most 6; async host calls will need
a later Promise/JSPI-shaped boundary.
