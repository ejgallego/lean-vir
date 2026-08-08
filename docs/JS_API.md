# JavaScript Runtime API

`web/src/vir-runtime.js` loads `vir-upstream.wasm`, loads a non-empty set of
manifest-bearing `.irpkg` members, and exposes their aggregate Lean declarations
through a generic JavaScript call API without requiring callers to manage WASM
memory. A focused `.irpkg` is loaded as a one-member set.

For the end-to-end "my Lean function from my JavaScript code" workflow, start
with `docs/CALL_LEAN_FROM_JS.md`.

The module is also exposed through the package entry point:

```js
import { createVirRuntime, VirCallback, VIR_HOST_DISPOSE } from "lean-vir";
```

Node tests and command-line tools that need `Lean.Vir.Browser.Document` calls
can import the Node wrapper:

```js
import {
  createVirRuntime,
  createVirtualElementState,
  createVirtualEventState,
  ensureVirtualElementState,
  findVirtualReactElementById,
  virtualReactElementById,
} from "lean-vir/vir-runtime-node";
```

Custom hosts can import the built-in binding factories directly:

```js
import {
  createBrowserDocumentHostBindings,
  createBrowserElementHostBindings,
  createHostResourceState,
} from "lean-vir/host-bindings";
```

Browser apps that render `Lean.Vir.React.Node` import the React binding factory
from the separate React entry point:

```js
import { createBrowserReactHostBindings } from "lean-vir/react-host-bindings";
```

When composing low-level browser binding groups, pass the same
`createHostResourceState()` result to each group so opaque resources returned
by one group are live in the others.

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
  irPackageSetBytes: [await fetchBytes("fixtures-basic.irpkg")],
});
```

When `debugWasm` is true, the runtime derives `*.dev.wasm` from `wasmUrl`.
Pass `wasmDebugUrl` when the debug artifact lives at a different URL. If no
`wasmUrl` is supplied, the factory defaults to `vir-upstream.wasm`.

## Runtime Module Map

The browser app, Node wrapper, and SDK artifact share these JavaScript modules:

| Module | Role |
| --- | --- |
| `vir-runtime.js` | Public runtime facade, WASM instantiation, package loading helpers, and host import wiring. |
| `vir-runtime-node.js` | Node wrapper that installs virtual browser and React host bindings for tests/tools. |
| `runtime/call-timing.js` | Internal accumulator for opt-in synchronous runtime call phase attribution. |
| `runtime/callbacks.js` | JavaScript callable Lean closure wrappers, callback state tracking, release, and disposal helpers. |
| `runtime/cleanup.js` | Cleanup error collection with deterministic single-error and aggregate reporting. |
| `runtime/core.js` | Package loading, manifest export tables, call resolution, memory helpers, and runtime/callback lifecycle. |
| `runtime/object-values.js` | Object ABI lowering and lifting between JavaScript values and owned Lean objects. |
| `runtime/vir-codec.js` | Binary reader/writer and interface type descriptor codec. |
| `runtime/host-state.js` | Host import dispatch state, externref roots, host-binding lookup, and disposal. |
| `runtime/object-abi.js` | Object ABI support checks, layout planning, scalar packing, and unpacking helpers. |
| `runtime/object-abi-exports.js` | Shared object ABI export-name manifest used by runtime checks and Wasm linker tooling. |
| `runtime/vir-value-normalizers.js` | Input normalization helpers used by object ABI lowering. |
| `vir-host-bindings.js` | Public common/browser host binding factories and stable re-exports. |
| `host-resource.js` | Opaque host-resource objects and externref root tables. |
| `host/vir-host-resources.js` | Host-resource store, liveness, teardown, timers, callbacks, and shared binding helpers. |
| `host/vir-virtual-host-bindings.js` | Virtual document/event/React host bindings for Node tests/tools. |
| `react/vir-react-node.js` | React Node tree validation, conversion, callback release, and virtual text helpers. |
| `react/vir-react-hooks.js` | Shared React component hook runtime and typed state setter host bindings. |
| `vir-react-host-bindings.js` | Browser React root/component/hook bindings; imports `react` and `react-dom/client`. |
| `runtime/interface-manifest.js` | Manifest validation, diagnostics, and type formatting helpers. |
| `runtime/interface-tags.js` | Shared interface descriptor tag constants and JSON-input tag set. |

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
bindings by default. The complete target map, factory list, virtual Node
helpers, custom binding rules, and cleanup behavior are documented in
`docs/HOST_BINDINGS.md`.

`defaultHostBindings` may be either a binding map or a function returning a
binding map. To enable browser React roots while keeping non-React imports free
of React dependencies, compose the React binding group explicitly:

```js
import { createVirRuntimeFactory } from "lean-vir";
import {
  createBrowserHostBindings,
  createHostResourceState,
} from "lean-vir/host-bindings";
import { createBrowserReactHostBindings } from "lean-vir/react-host-bindings";

const factory = createVirRuntimeFactory({
  wasmUrl: "vir-upstream.wasm",
  defaultHostBindings: () => {
    const resources = createHostResourceState();
    return createBrowserHostBindings({
      resources,
      reactHostBindings: createBrowserReactHostBindings(resources),
    });
  },
});
```

## Browser Usage

```js
import { createVirRuntime, fetchBytes } from "./src/vir-runtime.js";

const createForMember = async (path) => createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageSetBytes: [await fetchBytes(path)],
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
console.log(prettyVir.call("Vir.Fixtures.FormatPretty.formatPrettyCaseAtWidth", "list", 12));
console.log(leanVir.call("Vir.Fixtures.ExprPrinter.exprKindScore", { kind: "bvar", index: 4 }));
```

There is also a minimal browser page at `/runtime-example.html` that imports the
runtime directly and prints sample calls.

## Module Package Sets

Lake's `:vir` facet writes a package-set descriptor whose members are
ordered dependencies first and public root last. Load it directly by URL:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageSetUrl: "ModuleSetFixture/Root.irpkg-set.json",
});

console.log(vir.packageInfo.packageCount);
console.log(vir.call("ModuleSetFixture.Root.answer"));
```

Hosts that already have the bytes can pass `irPackageSetBytes`, a non-empty
array in descriptor order. On an existing factory-managed runtime,
`vir.loadIrPackageSetBytes(members)` validates the complete set in a fresh WASM
instance before handover. `packageInfo.count` is the aggregate declaration count;
`packageInfo.byteLength` is the sum of all members.

To separate transport from runtime creation, use the factory fetch API:

```js
const factory = createVirRuntimeFactory({ wasmUrl: "vir-upstream.wasm" });
const members = await factory.fetchIrPackageSet(
  "ModuleSetFixture/Root.irpkg-set.json",
);
const vir = await factory.createRuntime({ irPackageSetBytes: members });
```

`fetchIrPackageSet` validates the descriptor, resolves member paths relative to
the descriptor URL, and fetches them in parallel while preserving descriptor
order. A custom `fetchBytes` factory option can provide filesystem, cache, or
authenticated transport semantics.

The browser and Node runtime entry points also export
`IR_PACKAGE_SET_FORMAT` and `IR_PACKAGE_SET_VERSION` for tooling that inspects
or produces descriptors. Applications that only consume Lake-generated sets do
not need to use these constants directly.

## Reusing The Compiled Module

Use a factory when creating multiple fresh interpreter instances from the same
WASM module:

```js
import { createVirRuntimeFactory, fetchBytes } from "./src/vir-runtime.js";

const factory = createVirRuntimeFactory({ wasmUrl: "vir-upstream.wasm" });
const packageMemberBytes = await fetchBytes("fixtures-basic.irpkg");

const first = await factory.createRuntime({ irPackageSetBytes: [packageMemberBytes] });
const second = await factory.createRuntime({ irPackageSetBytes: [packageMemberBytes] });
```

## Replacing A Package Set

`vir.loadIrPackageSetBytes(members)` is synchronous once the Wasm module has been
compiled. Calling it on a loaded, factory-managed runtime preserves the public
`vir` object but replaces its underlying Wasm instance:

```js
const factory = createVirRuntimeFactory({ wasmUrl: "vir-upstream.wasm" });
const vir = await factory.createRuntime({ irPackageSetBytes: firstPackageMembers });

vir.loadIrPackageSetBytes(secondPackageMembers);
console.log(vir.call("SecondPackage.entry"));
```

The second package set is loaded, initialized, and manifest-validated in a fresh
candidate instance before handover. If that work fails, the candidate is
disposed and the first package remains usable. After a successful handover,
old object pointers, `VirCallback` objects, host-resource roots, and resolved
call slots are invalid. The runtime releases the old set's resources once,
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
  package format version, Lean toolchain, generation time, source targets, and
  resolved roots.
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
`js.leanRef`/`js.leanRef.value`/`js.leanRef.retain`/`js.leanRef.release`
object-handle boundary, which stores the Lean object behind a
`Lean.Vir.JSL α` resource instead of decoding it to JavaScript.
`LeanRef.retainJSL` creates an independent alias and `LeanRef.releaseJSL`
deterministically releases only that alias; dropping the Lean wrapper releases
its alias automatically. Host imports may additionally receive Lean function values as
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

Nullary inductive enums are accepted as constructor names, generated JavaScript
names, or constructor indexes. Results are returned as the constructor's
generated JavaScript name.

Options are accepted as `null`, `{ kind: "none" }`, `{ kind: "some", value }`,
`{ some: value }`, or the bare inner value. Option results are returned as
`null` or the inner value. Product inputs are accepted as `{ fst, snd }` or
two-element arrays, and results are returned as `{ fst, snd }`.
`Sum`/`Except` inputs are accepted as `{ kind, value }`, `{ tag, value }`, or
single-constructor-key objects such as `{ inl: 4 }` and `{ ok: value }`;
results are returned as `{ kind, value }`. Non-indexed custom inductives use
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
The `{ tag, value }` and single-constructor-key input aliases are only for
`Sum`/`Except`, not for custom inductives.

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
  Lean.Vir.Browser.Document.setTitle title
  Lean.Vir.Browser.Document.getTitle
```

The full Lean-side declaration list is maintained in
`docs/LEAN_VIR_LIBRARY.md`. The JavaScript target map, custom binding examples,
virtual Node helpers, and resource lifetime rules are maintained in
`docs/HOST_BINDINGS.md`.

The built-in `common.*` and `browser.*` targets do not require a
`hostBindings` option:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageSetBytes: [await fetchBytes("demo-host.irpkg")],
});

console.log(vir.call("HostInterop.titleHandshake", "browser handshake"));
```

Browser React root, native Node construction, component, and hook targets are
provided by `lean-vir/react-host-bindings`.
Use the `defaultHostBindings` composition shown above when a browser package
calls `Lean.Vir.React.Root.*`, `Lean.Vir.React.Node.*`, or
`Lean.Vir.React.Hooks.*`. The browser runtime requires `globalThis.document`
for `browser.document.*` targets. In Node, use `lean-vir/vir-runtime-node` or
pass explicit `hostBindings`; the Node wrapper provides virtual document,
event, ReactNode, and React state for tests/tools.

Custom target bindings are passed through `hostBindings`; user bindings
override defaults. Bindings receive decoded JavaScript values and return a value
matching the manifest host boundary mode. Ordinary host imports receive
resource values, including `Js.Nullable` wrapper resources for nullable
arguments/results; explicit conversion imports receive or return decoded scalar
values for that converter. Host imports are synchronous; returning a
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
default `common.*`, `browser.*`, and `react.*` bindings, including selector
helpers such as `react.root.renderComponentIntoSelector`:

```js
const resources = createHostResourceState();
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageSetBytes: [await fetchBytes("custom.irpkg")],
  defaultHostBindings: createBrowserHostBindings({ resources }),
  hostBindings: {
    "demo.bumpNat": (n) => resources.resourceForValue(resources.resolveResource(n, "JsNat") + 1n),
  },
});

console.log(vir.call("bumpFromJs", 41)); // "42"
```

Bindings receive decoded JavaScript values and return a value matching the Lean
result type. Resource-shaped custom bindings that interoperate with built-in
`JsValue.to*` conversions should share the same `HostResourceState` as the
default bindings. `Unit` returns use `undefined` or `null`. Function-valued
Lean arguments are decoded as callable `VirCallback` objects. A host binding
receives one transferable callback lease and must eventually call
`callback.release()` if it stores that lease. A binding with multiple
independent owners calls `callback.retain()` once for each additional owner;
each returned lease is a distinct callable object with an idempotent
`release()`. Host imports are synchronous; returning a `Promise` is an error.
If argument conversion, the binding itself, the synchronous-result check, or
result conversion fails, the runtime revokes the callback root and every lease
created from it during that failed call. A successful nested host call keeps
its independently transferred callback roots.
Object-style
`imports` factory options are treated as overrides on top of the generated
import table. If you provide a custom `imports` function to
`createVirRuntimeFactory`, call `createVirImports(module, overrides, hostState)`
or otherwise install `env.vir_js_call_objects` plus the resource-root imports.

## Closure And Resource Lifetime

`VirCallback` is the JavaScript wrapper for a rooted Lean closure:

```js
hostBindings: {
  "demo.withCallback": (callback) => {
    try {
      return callback(41);
    } finally {
      callback.release();
    }
  },
}
```

Callbacks are idempotently releasable through `callback.release()` or
`callback.dispose()`. `callback.retain()` returns a new callable lease over the
same rooted Lean closure. Releasing one lease does not invalidate its siblings;
the runtime calls `vir_closure_release` only after the last lease is released.
Calling an individually released lease throws. JavaScript-provided function
values are not accepted as Lean arguments in this phase; function values flow
from Lean to JavaScript as callable `VirCallback` objects backed by internal
closure root ids. `VirCallback` objects intentionally do not expose a numeric
root id.

For example, a binding that installs two independent registrations can split
the transferred lease explicitly:

```js
"demo.subscribeTwice": (callback) => {
  const first = callback.retain();
  const second = callback.retain();
  callback.release(); // relinquish the incoming transfer lease
  firstRegistration.install(first);
  secondRegistration.install(second);
}
```

Each registration releases only its own lease when removed. The built-in DOM,
timer, animation, asynchronous RPC, and React owners use this same pattern
internally, so Lean callers do not manage these leases themselves.

Synchronous JavaScript exceptions raised by a host binding are recorded by the
Wasm import boundary and consumed by the owning call. This applies equally to
top-level exports and retained callbacks: the original host error is thrown
once before any placeholder interpreter result can be treated as success.

`vir.dispose()` force-revokes any callback roots still tracked by the runtime,
marking every outstanding lease released,
and calls host-binding cleanup hooks. Cleanup is terminal and best-effort: all
binding hooks, resources, Lean object handles, and callbacks are attempted even
if one throws. One cleanup failure is rethrown directly; multiple failures are
reported as an `AggregateError` in cleanup order. The runtime remains disposed,
and a later `dispose()` is a no-op.
Calling `vir.loadIrPackageSetBytes(...)` on a runtime that already has a package
set loaded performs an atomic fresh-instance replacement as described above.
Old package resources are cleaned up only after the candidate set has loaded
successfully. See `docs/HOST_BINDINGS.md`
for the built-in resource cleanup behavior.

See `docs/EVENT_CALLBACK_ROADMAP.md` for the detailed callback ownership
contract and follow-up work.

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
  irPackageSetBytes: [await fetchBytes("/my-package.irpkg")],
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
