# JavaScript Runtime API

The [support scope](../SUPPORT.md) covers runtime loading, object ownership and
minimal two-way interop. This reference also describes experimental DOM/UI
providers and automatic conversion of records and custom inductives. The default
browser entry includes experimental providers; using that entry does not expand
official support.

`web/src/vir-runtime.js` loads `vir-upstream.wasm`, loads a non-empty set of
manifest-bearing `.irpkg` members, and exposes their aggregate Lean declarations
through a generic JavaScript call API without requiring callers to manage WASM
memory. A focused `.irpkg` is loaded as a one-member set.

Applications use `createProgram` with library-prepared runtime and program
manifests; start with [application setup](EMBEDDED_RESOURCES.md).
This page documents the underlying runtime API for contributors and existing
hosts. [Direct runtime calls](CALL_LEAN_FROM_JS.md) is a repository development
example, not another application workflow.

## Entry points and distribution

The resource loader and the SDK expose different interfaces to the same
interpreter:

| Distribution | JavaScript entry | Available interface |
| --- | --- | --- |
| Library-prepared application resources | The runtime bundle's `runtime.js` | `createProgram` loads runtime/program manifests and returns `status`, `call` and `dispose`. |
| SDK archive for custom hosts and existing integrations | `js/vir-runtime.js` or `js/vir-runtime-node.js` | `createVirRuntime` and `createVirRuntimeFactory`, with the direct call, host-binding and object APIs documented below. |

The current `createProgram` facade does not expose the underlying runtime or
accept custom `hostBindings`. A host needing those APIs uses the SDK entry
points and supplies a matching Wasm and package set. See
[SDK acquisition](PACKAGES.md#install-the-browser-sdk) for its prerequisites.
Official support still follows the [support scope](../SUPPORT.md) within each
interface; experimental providers remain experimental in either distribution.

### Imports from the checkout or SDK

The module is also exposed through this checkout's package entry point. The
repository npm package is private; the specifiers below assume a local package
or a host-configured mapping, not an `npm install lean-vir` distribution. Prepared
application assets use the loader described in the application guide.

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
`createHostLifecycle()` so their owner can terminate them together. Return the
composed map from a per-runtime `defaultHostBindings` function to transfer its
cleanup to VIR; an application that supplies a preconstructed map owns its cleanup.
Passive JavaScript values need no shared store.

## WASM Artifact Selection

SDK archives ship two interpreter artifacts under `wasm/`:

- `vir-upstream.wasm`: stripped release artifact, used by default.
- `vir-upstream.dev.wasm`: optimized, unstripped companion artifact for
  debugging. It is not an `-O0` build.

The application resource pack contains its selected release interpreter as
`runtime.wasm`. Its `createProgram` loader has no `debugWasm` option; the debug
selection below belongs to the SDK API.

Hosts that serve both SDK files beside each other can opt into the debug
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
| `vir-runtime.js`                     | Public browser entry point selecting default host providers.               |
| `vir-runtime-node.js`                | Node wrapper with environment-neutral JavaScript value and console bindings.                             |
| `runtime/factory.js`               | Shared acquisition, WASM instantiation, package input validation and host import wiring. |
| `host/vir-common-host-bindings.js` | Environment-neutral JavaScript value and console providers. |
| `runtime/call-timing.js`             | Internal accumulator for opt-in synchronous runtime call phase attribution.                               |
| `runtime/callbacks.js`               | Private Lean closure roots associated with ordinary JavaScript functions.                                 |
| `runtime/cleanup.js`                 | Cleanup error collection with deterministic single-error and aggregate reporting.                         |
| `runtime/core.js`                    | Package loading, manifest export tables, call resolution, memory helpers, and runtime/callback lifecycle. |
| `runtime/object-values.js`           | Object ABI lowering and lifting between JavaScript values and owned Lean objects.                         |
| `runtime/vir-codec.js`               | Byte normalization, contract writer and live descriptor accessors.                                                 |
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
| `runtime/interface-tags.js`          | Shared interface descriptor tag constants.                                         |

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

The browser runtime installs the built-in JavaScript value, browser and Infoview
host bindings by default. The complete target map, factory list, custom binding
rules, and cleanup behavior are documented in the
[host bindings reference](../reference/HOST_BINDINGS.md#active-resources).

Preconstructed `hostBindings` and `defaultHostBindings` maps are application-owned.
A `defaultHostBindings` function transfers ownership of each fresh provider and
its cleanup scope to VIR. Use a map for shared services and a builder for
per-runtime providers; the browser and Node entry points accept both forms.

To enable browser React roots while keeping non-React imports free
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
`factory.createRuntime()` may also omit `irPackageSet`; in that case,
`vir.loadIrPackageSetBytes(members)` installs the first package set after the
Wasm module has been compiled. A runtime owns at most one package generation.
Calling the method after a successful installation throws before changing the
installed generation; create another runtime from the same factory instead.
`packageInfo.count` is the aggregate declaration count; `packageInfo.byteLength`
is the sum of all members.

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
Runtime creation snapshots caller-provided member bytes before asynchronous
verification and Wasm acquisition. Later mutations to the supplied arrays do
not change the package being installed.

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

## Runtime Generations

Use a factory to create a fresh runtime for each package generation. The
compiled `WebAssembly.Module` is reused, while interpreter state, callbacks,
handles, runtime-created host resources and package-local caches remain
generation-local:

```js
const factory = createVirRuntimeFactory({ wasmUrl: "vir-upstream.wasm" });
let vir = await factory.createRuntime({
  irPackageSet: firstPackageMembers,
});

const next = await factory.createRuntime({
  irPackageSet: secondPackageMembers,
});
const previous = vir;
vir = next;
previous.dispose();
console.log(vir.call("SecondPackage.entry"));
```

If creation of `next` fails, the existing `vir` remains usable because it has
not been disposed. Dispose a generation only when its callbacks, handles and
runtime-owned host resources should become invalid. Select the new generation
before disposing the previous one, so a cleanup error propagates while the caller
still owns `vir`. User-supplied binding maps shared by multiple runtimes retain
application ownership: VIR does not dispose supplied maps when runtimes shut down.

## Calls And Manifest

- `vir.interfaceManifest` is the embedded package manifest. The runtime freezes
  this internally owned JSON tree, including nested type descriptors, on
  installation so cached export, layout, and normalization plans cannot drift.
  Use `structuredClone(vir.interfaceManifest)` for editable inspection data.
  This does not freeze application values passed through host bindings.
- `vir.packageMetadata` is `vir.interfaceManifest.metadata`, including the
  package format version, Lean toolchain, source targets, and resolved roots.
  Wall-clock generation time is intentionally confined to diagnostic reports.
- `vir.call(name, ...args)` accepts a manifest `entry`, `id`, or `jsName`.
  These share one alias namespace: multiple
  spellings may identify the same export, but a spelling cannot identify two
  different exports. Ambiguous manifests are rejected before initialization.
- `vir.callTimed(name, ...args)` performs the same call and returns
  `{ value, timings }` for opt-in phase attribution.
- `vir.exportsByName.<jsName>(...args)` exposes valid generated JS names as
  methods.
- `vir.runStartupEntries()` invokes zero-argument exports whose manifest entry
  has `startup: true`, in manifest order, once per runtime. After success,
  repeated calls do nothing. Failure stops the sequence and throws the error;
  later startup calls report failure without invoking any hooks. Effects already
  performed are not rolled back. Ordinary exported calls can still return
  recoverable errors; a fatal host failure or Wasm trap retires the runtime.
  Synchronous reentry from a host callback leaves the active startup traversal
  in charge; it does not invoke hooks recursively.
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

The types below describe what the current marshaller accepts. Automatic array
conversion is supported when its element representation is supported, such as
`Array Nat`. Automatic conversion of records and custom inductives remains
experimental even when package generation accepts its descriptor. See
[choosing a representation](LEAN_VIR_LIBRARY.md#choose-a-boundary-representation)
for minimal reference interop.

Implemented interface types are `Unit`, `Nat`, `Int`, `Bool`, `String`, `Float`,
`Float32`, `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`, `ByteArray`,
recursive `Array α`, `List α`, `Option α`, `α × β`, `Sum α β`, and `Except ε α`
shapes over accepted types, non-indexed user-defined structures including
parameterized instances, nullary inductive enums, non-indexed custom inductives
with nullary or runtime-payload constructors, opaque host resources, and
`Lean.Expr`. `Lean.Vir.Js α` is an opaque `Js` resource for JavaScript-owned
objects; the `α` parameter is not decoded while the value remains in the JS
object lane. DOM and React object markers such as `Lean.Vir.Browser.Element`
and `Lean.Vir.React.Root` must therefore appear as `Lean.Vir.Js ...` at the
boundary.

The explicitly invoked [JSON converter API](../SUPPORT.md#planned-for-011) is
planned for 0.1.1; it is separate from this automatic marshaling.

This surface is the descriptor-guided object lowering
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

Bound-variable indices must be in `0..1048574`: the pinned kernel stores
`index + 1` in a 20-bit range. Larger indices reject before Wasm execution.
This limit does not restrict arbitrary-precision Nat literals or projection indices.

Names inside these structural expression and level values use a restricted
text spelling: non-empty Lean identifier components separated by single dots.
Unicode components accepted by the pinned Lean identifier predicates are
supported, such as `café` and `αβ₁`; these predicates differ from JavaScript's
Unicode identifier grammar. JavaScript checks well-formed Unicode and rejects
numeric, empty and escaped components such as `A.«B.C»`. The Wasm constructors
and getters apply the pinned Lean identifier predicates to the remaining
components. Unsupported spellings fail conversion instead of being normalized
into a different `Lean.Name`; ordinary conversion failures leave the runtime
usable.
The empty string and `[anonymous]` are retained as explicit spellings for the
anonymous name. Package and manifest names have their separate structural
identity contract; this restriction applies only to the specialized Expr and
Level adapter.

Package loading validates the embedded interface manifest before any generated
entry is exposed. Malformed type trees, invalid structure layouts, unsupported
interface descriptor tags, duplicate export names, and bad enum constructor
metadata are reported as package-load errors.

## Lean To JavaScript Host Imports

Lean sources can call synchronous JavaScript functions through declarations
marked with `@[vir_js "..."]`. See `docs/guides/LEAN_VIR_LIBRARY.md` for the
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
`docs/guides/LEAN_VIR_LIBRARY.md`. The JavaScript target map, custom binding examples,
and resource lifetime rules are maintained in `docs/reference/HOST_BINDINGS.md`.

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

The entry points select their default providers; acquisition and instantiation
share an environment-neutral factory. Importing the Node entry does not load
DOM, timer, animation, Infoview or React providers.

Custom target bindings are passed through `hostBindings`; user bindings
override defaults. Bindings receive the exact JavaScript values and return a
value matching the manifest host boundary mode. `Js.Nullable` is the actual
value or `null`; it is not a wrapper. Explicit conversion imports receive or
return decoded scalar values for that named converter. Host imports are
synchronous; returning a
`Promise` is an error unless the declared result is an exact `Js` resource, in
which case the native Promise object crosses synchronously without being
awaited. Object-style `imports` factory options are treated as
overrides on top of the generated import table. If you provide a custom
`imports` function to `createVirRuntimeFactory`, call
`createVirImports(module, overrides, hostState)` or otherwise install
`env.vir_js_call_objects` plus the `env.vir_resource_*` root-table imports.

The default import table recognizes the VIR hooks and the Preview 1 imports
linked by the shipped reactor. It provides no WASI process arguments,
environment, clock, file descriptors or polling service: these calls return
`NOSYS` or `BADF`; `sched_yield` succeeds and `proc_exit` throws. Supply explicit
overrides when an extension needs these services. Any other unresolved import
is rejected by name before instantiation. Hostless low-level linking is allowed,
but calling a VIR hook without an attached host state throws.

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

For callback ownership, failed-call rollback and exception propagation, see
[HOST_BINDINGS.md](../reference/HOST_BINDINGS.md#active-resources).

## Closure And Resource Lifetime

Ordinary JavaScript results follow JS reachability. Converted Lean callbacks and
JSL values retain their original runtime; `vir.dispose()` invalidates those values
and attempts all runtime-owned cleanup. Disposal is terminal even if cleanup
throws, and subsequent disposal is a no-op.

Unmount owned React UI before explicitly disposing its runtime, so effect cleanup
can still enter Lean. Normal infoview shell unmount instead releases UI ownership
without hard disposal. The full rules, including failure teardown and collection
limits, live in [HOST_BINDINGS.md](../reference/HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal).

Each runtime generation is a separate operation. Disposal invalidates that
generation's callbacks and handles; it does not transfer them to another
runtime.

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

Package-provider lookup and ordered binary/manifest export and host-import
checks already run at loading. They check metadata agreement, not whether
declared types and layouts describe the actual Lean objects. Supporting
untrusted input still requires layout validation, package-size and
descriptor-depth limits, and a recoverable execution context.

## Generate A Local Package

Follow [Packages](PACKAGES.md#generate-a-local-package) for module registration,
root selection, configuration, inspection and the development runner. Supply
the resulting bytes or descriptor URL through `irPackageSet`, as described in
[Module Package Sets](#module-package-sets).

## Errors and recovery

Ordinary Lean IO errors in an installed package report their message and leave
the runtime reusable. Unexpected JavaScript host exceptions abort the owning
JavaScript invocation: the original `Error` is preserved, and other thrown
values are wrapped with their raw value as `cause`, without coercing objects.
Cleanup aggregation preserves raw thrown values without inspecting them; the
owning error boundary normalizes only after committing quarantine or retirement.
Effectful host imports transport the exception as an IO error, but this is not
Lean-side recovery: even if Lean catches it, further host work in that invocation
is blocked. A later pure import has no error carrier and traps, retiring the
instance. A later JavaScript call may proceed if no exceptional Wasm unwind
occurred. Expected host-domain failures should use explicit result values.

A failed **pure** host import or an exception escaping Wasm execution makes the
runtime unusable. Synchronous calls, callbacks, startup and package installation
then throw; asynchronous factory creation rejects. Create a fresh runtime from
the factory to recover. Catching a nested fatal callback in a host binding does
not let the outer Lean call continue. Other runtime instances remain usable.

`runtime.failure` is a read-only `Error | null` diagnostic. It is `null` while
the runtime is healthy or after a recoverable effect failure; after a fatal
host/Wasm failure it retains the original error when available. Guarded runtime
methods still throw after the failure, so inspect this property for diagnostics
and create a fresh runtime for continued execution. Failure state is private and
cannot be reset through a public boundary object.

`runtime.onFailure(listener)` returns an idempotent unsubscribe function. The
listener receives the first failure once, in a microtask after the active call
stack. Subscribing to an already failed runtime also schedules notification;
unsubscribing before delivery cancels it. Listener exceptions are reported to
`console.error` and cannot replace the original failure. Unsubscribe when an
integration releases its runtime. Notification reports retirement even when the
caller catches the exception locally; it does not perform recovery.

Package initialization has a stricter lifetime boundary. Decode, preparation
and manifest failures before initializers run may be retried on an empty
runtime. Any failure after initialization begins requires a fresh instance,
including ordinary Lean IO errors: initialization can publish persistent values
and opaque handles before failing. The factory can reuse its compiled Wasm
module while creating a fresh instance.

`dispose()` remains idempotent after failure. It releases JavaScript-owned host
resources and invalidates callbacks/handles without re-entering failed Wasm.
Traps do not unwind the interpreter's C++ frames: its remaining allocations are
reclaimed with the Wasm instance when no references retain it. Keep the
runtime-owned `exports` facade intact; replacing it bypasses these guards.

## Current Limits

The browser loads descriptor-ordered sets of format-11 `.irpkg` members. A
focused package is represented as a one-member set. It does not load `.olean` or
Lean's raw `.ir` format in the browser. Unsupported requested
exports fail during package generation instead of being omitted silently.
A failed first installation leaves the deferred runtime without a package;
failed creation exposes no runtime to the caller. A failed new-generation
creation leaves an already-owned runtime unchanged.
JavaScript host imports execute synchronously and
are limited to 128 imported declarations with IR arity at most 6. Native
Promises may cross as exact `Js` values and be observed with ordinary Promise
continuations. Those operations accept exact `Js.Function1` values; turning a
Lean closure into one is an explicit `Js.Function.ofLean` conversion.
Suspending a Lean call on a Promise still needs a later JSPI-shaped boundary.
