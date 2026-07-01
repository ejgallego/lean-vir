# JavaScript Runtime API

`web/src/vir-runtime.js` loads `vir-upstream.wasm`, loads a manifest-bearing
`.irpkg`, and exposes its Lean declarations through a generic JavaScript call
API without requiring callers to manage WASM memory.

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
- `vir-upstream.dev.wasm`: unstripped companion artifact for debugging.

Applications that serve both files beside each other can opt into the debug
artifact by setting `debugWasm: true`:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  debugWasm: true,
  irPackageUrl: "fixtures-basic.irpkg",
});
```

When `debugWasm` is true, the runtime derives `*.dev.wasm` from `wasmUrl`.
Pass `wasmDebugUrl` when the debug artifact lives at a different URL. If no
`wasmUrl` is supplied, the factory defaults to `vir-upstream.wasm`.

## Runtime Module Map

The browser app, Node wrapper, and SDK artifact share these JavaScript modules:

| Module | Role |
| --- | --- |
| `vir-runtime.js` | Public runtime, WASM/package loading, exported Lean calls, callback lifecycle. |
| `vir-runtime-node.js` | Node wrapper that installs virtual browser and React host bindings for tests/tools. |
| `runtime/callbacks.js` | JavaScript callable Lean closure wrappers, callback state tracking, release, and disposal helpers. |
| `runtime/vir-codec.js` | Binary reader/writer and interface type descriptor codec. |
| `runtime/host-state.js` | Host import dispatch state, externref roots, host-binding lookup, and disposal. |
| `runtime/object-abi.js` | Object ABI support checks, layout planning, scalar packing, and unpacking helpers. |
| `runtime/vir-value-normalizers.js` | Input normalization helpers used by object ABI lowering. |
| `vir-host-bindings.js` | Public common/browser host binding factories and stable re-exports. |
| `host-resource.js` | Opaque host-resource objects and externref root tables. |
| `host/vir-host-resources.js` | Host-resource store, liveness, teardown, timers, callbacks, and shared binding helpers. |
| `host/vir-virtual-host-bindings.js` | Virtual document/event/React host bindings for Node tests/tools. |
| `react/vir-react-node.js` | React Node tree validation, conversion, callback release, and virtual text helpers. |
| `react/vir-react-hooks.js` | Shared React component hook runtime and typed state setter host bindings. |
| `vir-react-host-bindings.js` | Browser React root/component/hook bindings; imports `react` and `react-dom/client`. |
| `runtime/interface-manifest.js` | Manifest validation, diagnostics, and type formatting helpers. |
| `runtime/wire-tags.js` | Shared wire tag constants and JSON-input tag set. |

Application code normally imports only `lean-vir`, `lean-vir/vir-runtime-node`,
`lean-vir/host-bindings`, or `lean-vir/react-host-bindings`. React browser
bindings are intentionally exported only from
`lean-vir/react-host-bindings`, keeping `lean-vir/host-bindings` free of React
and `react-dom/client` dependencies.

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
import { createVirRuntime } from "./src/vir-runtime.js";

const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "fixtures-basic.irpkg",
});
const hostVir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "demo-host.irpkg",
});
const prettyVir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "pretty-printer.irpkg",
});
const leanVir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "fixtures-lean.irpkg",
});

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

## Reusing The Compiled Module

Use a factory when creating multiple fresh interpreter instances from the same
WASM module:

```js
import { createVirRuntimeFactory, fetchBytes } from "./src/vir-runtime.js";

const factory = createVirRuntimeFactory({ wasmUrl: "vir-upstream.wasm" });
const irPackageBytes = await fetchBytes("fixtures-basic.irpkg");

const first = await factory.createRuntime({ irPackageBytes });
const second = await factory.createRuntime({ irPackageBytes });
```

## Calls And Manifest

- `vir.interfaceManifest` is the embedded package manifest.
- `vir.packageMetadata` is `vir.interfaceManifest.metadata`, including the
  package format version, Lean toolchain, generation time, source targets, and
  resolved roots.
- `vir.call(name, ...args)` accepts a manifest `id`, `jsName`, or Lean
  declaration name.
- `vir.exportsByName.<jsName>(...args)` exposes valid generated JS names as
  methods.
- `vir.packageInfo.interfaceExports` reports the number of generated exports.
- `vir.packageInfo.hostImports` reports the number of JavaScript host imports.

Supported v1 types are `Unit`, `Nat`, `Int`, `Bool`, `String`, `Float`,
`Float32`, `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`, `ByteArray`,
recursive `Array α`, `List α`, `Option α`, `α × β`, `Sum α β`, and `Except ε α`
shapes over supported types, non-indexed user-defined structures including
parameterized instances, nullary inductive enums, non-indexed custom inductives
with nullary or runtime-payload constructors, opaque host resources, and
`Lean.Expr`. `Lean.Vir.Js α` is an opaque `Js` resource for JavaScript-owned
objects; the `α` parameter is not decoded while the value remains in the JS
object lane. DOM and React object markers such as `Lean.Vir.Browser.Element`
and `Lean.Vir.React.Root` must therefore appear as `Lean.Vir.Js ...` at the
boundary. Host imports may additionally receive Lean function values as
callbacks, including event handlers retained by `Lean.Vir.React.Node` resources
created through `react.node.createElement`. Exported Lean entrypoints and host
imports may be pure or use a recognized synchronous effect. JavaScript
resource/runtime APIs use `Lean.Vir.RuntimeM α`; raw custom host imports can
use `IO α`; DOM and React-root imports use `Lean.Vir.Browser.DomM α`; React
render-construction imports use `Lean.Vir.React.ReactM α`. Effect failures
currently surface as call failures.
The JSON manifest records those as `effect: "pure"`, `"runtime"`, `"io"`,
`"dom"`, or `"react"` for tooling and documentation. The wasm call payload
still lowers them to pure versus effectful execution.

Large exact integer values are returned as decimal strings. ByteArray results
are returned as `Uint8Array`; `Float` and `Float32` values are JavaScript
numbers. Top-level `Float`, `Float32`, `UInt64`, and trivial wrappers over them
use generated Lean `_boxed` declarations automatically.

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
wire tags, duplicate export names, and bad enum constructor metadata are
reported as package-load errors.

## Lean To JavaScript Host Imports

Lean sources can call synchronous JavaScript functions through declarations
marked with `@[vir_js "..."]`. See `docs/LEAN_VIR_LIBRARY.md` for the
Lean-side API reference. Import one of the provided modules:

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
  irPackageUrl: "demo-host.irpkg",
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
matching the Lean result type. Host imports are synchronous in v1; returning a
`Promise` is an error. Object-style `imports` factory options are treated as
overrides on top of the generated import table. If you provide a custom
`imports` function to `createVirRuntimeFactory`, call
`createVirImports(module, overrides, hostState)` or otherwise install
`env.vir_js_call_objects` plus the `env.vir_resource_*` root-table imports.

Custom imports can be declared directly:

```lean
import Vir.Host

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat

def bumpFromJs (n : Nat) : Nat :=
  jsBumpNat n
```

Bind custom targets when constructing the runtime. User bindings override the
default `common.*`, `browser.*`, and `react.*` bindings, including selector
helpers such as `react.root.renderComponentIntoSelector`:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "custom.irpkg",
  hostBindings: {
    "demo.bumpNat": (n) => (BigInt(n) + 1n).toString(),
  },
});

console.log(vir.call("bumpFromJs", 41)); // "42"
```

Bindings receive decoded JavaScript values and return a value matching the Lean
result type. `Unit` returns use `undefined` or `null`. Function-valued Lean
arguments are decoded as callable `VirCallback` objects. A host binding that
stores a callback must eventually call `callback.release()` or rely on
`VirRuntime.dispose()` to release any still-live callback roots. Host imports
are synchronous in v1; returning a `Promise` is an error. Object-style
`imports` factory options are treated as overrides on top of the generated
import table. If you provide a custom `imports` function to
`createVirRuntimeFactory`, call `createVirImports(module, overrides, hostState)`
or otherwise install `env.vir_js_call` and `env.vir_js_call_result_size`.

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
`callback.dispose()`. Calling a released callback throws. JavaScript-provided
function values are not accepted as Lean arguments in this phase; function
values flow from Lean to JavaScript as callable `VirCallback` objects backed by
internal closure root ids. `VirCallback` objects intentionally do not expose a
numeric root id.

`vir.dispose()` releases any `VirCallback` objects still tracked by the runtime
and calls host-binding cleanup hooks. Calling `vir.loadIrPackageBytes(...)` on a
runtime that already has a package loaded performs the same package-resource
cleanup before installing the new manifest. See `docs/HOST_BINDINGS.md` for the
built-in resource cleanup behavior.

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

Serve the generated `.irpkg` next to `vir-upstream.wasm`, or upload it through
`/dev.html` while iterating locally. The runtime only needs URLs or bytes for
the two assets:

```js
const vir = await createVirRuntime({
  wasmUrl: "/vir-upstream.wasm",
  irPackageUrl: "/my-package.irpkg",
});
```

## Current Limits

The runtime uses the single-file declaration package path. It does not load
`.olean`, `.ir`, or full Lean module data in the browser. Unsupported requested
exports fail during package generation instead of being omitted silently, and a
failed package load clears the runtime's package metadata instead of leaving
stale declarations callable. JavaScript host imports are sync-only and limited
to 64 imported declarations with IR arity at most 6; async host calls will need
a later Promise/JSPI-shaped boundary.
