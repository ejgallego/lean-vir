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
import { createVirRuntime } from "lean-vir/vir-runtime-node";
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
parameterized instances, nullary inductive enums, opaque host resources, and
`Lean.Expr`. Host imports may additionally receive Lean function values as
callbacks. Exported Lean entrypoints and host imports may be pure or `IO α`;
`IO` failures currently surface as call failures.

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
results are returned as `{ kind, value }`. Non-indexed
structures, including parameterized instances like `Box Nat` and
`Tagged (Array String)`, are accepted and returned as objects keyed by their
Lean field names; inherited parent fields are accepted and returned as flattened
object keys. Direct `Bool`, `UInt*`, `USize`, and enum fields, including
single-field wrappers such as `Box UInt32`, use the same JS values as standalone
arguments/results. These shapes can be nested, for example `Option (Array Nat)`,
`List (Nat × String)`, `Except String (Option (Sum Nat Nat))`, a structure
containing another structure, and `Array Lean.Expr`.

`Lean.Expr` values use structural JavaScript objects such as
`{ kind: "const", name: "Nat", levels: [] }`,
`{ kind: "app", fn, arg }`, or `{ kind: "bvar", index: 0 }`. Level values use
the same shape with `kind` values `zero`, `succ`, `max`, `imax`, `param`, and
`mvar`. Metadata expression inputs are accepted by decoding their inner
expression; metadata results preserve a structural `mdata` wrapper.

Package loading validates the embedded interface manifest before any generated
entry is exposed. Malformed type trees, invalid structure layouts, unsupported
wire tags, duplicate export names, and bad enum constructor metadata are
reported as package-load errors.

## Lean To JavaScript Host Imports

Lean sources can call synchronous JavaScript functions through declarations
marked with `@[vir_js "..."]`. See `docs/LEAN_VIR_LIBRARY.md` for the
Lean-side API reference. Import one of the provided modules:

```lean
import Lean.Vir.Browser

def titleRoundtrip (title : String) : IO String := do
  Lean.Vir.Browser.Document.setTitle title
  Lean.Vir.Browser.Document.getTitle
```

The first library surface is:

- `Lean.Vir.Common.echoString : @& String -> String`
- `Lean.Vir.Common.addNat : Nat -> Nat -> Nat`
- `Lean.Vir.Browser.Console.log : @& String -> IO Unit`
- `Lean.Vir.Browser.Document.getTitle : IO String`
- `Lean.Vir.Browser.Document.setTitle : @& String -> IO Unit`
- `Lean.Vir.Browser.Document.querySelector : @& String -> IO (Option Lean.Vir.Browser.Element)`
- `Lean.Vir.Browser.Element.getTextContent : @& Lean.Vir.Browser.Element -> IO String`
- `Lean.Vir.Browser.Element.setTextContent : @& Lean.Vir.Browser.Element -> @& String -> IO Unit`
- `Lean.Vir.Browser.Element.getAttribute : @& Lean.Vir.Browser.Element -> @& String -> IO (Option String)`
- `Lean.Vir.Browser.Element.setAttribute : @& Lean.Vir.Browser.Element -> @& String -> @& String -> IO Unit`
- `Lean.Vir.Browser.Element.addEventListener : @& Lean.Vir.Browser.Element -> @& String -> (Lean.Vir.Browser.Event -> IO Unit) -> IO Lean.Vir.Browser.EventListener`
- `Lean.Vir.Browser.Element.removeEventListener : @& Lean.Vir.Browser.EventListener -> IO Unit`
- `Lean.Vir.Browser.HTMLInputElement.fromElement : @& Lean.Vir.Browser.Element -> IO (Option Lean.Vir.Browser.HTMLInputElement)`
- `Lean.Vir.Browser.HTMLInputElement.getChecked : @& Lean.Vir.Browser.HTMLInputElement -> IO Bool`
- `Lean.Vir.Browser.HTMLInputElement.setChecked : @& Lean.Vir.Browser.HTMLInputElement -> Bool -> IO Unit`
- `Lean.Vir.Browser.HTMLInputElement.getValue : @& Lean.Vir.Browser.HTMLInputElement -> IO String`
- `Lean.Vir.Browser.HTMLInputElement.setValue : @& Lean.Vir.Browser.HTMLInputElement -> @& String -> IO Unit`
- `Lean.Vir.Browser.Timer.setTimeout : UInt32 -> IO Unit -> IO Lean.Vir.Browser.Timeout`
- `Lean.Vir.Browser.Timer.clearTimeout : @& Lean.Vir.Browser.Timeout -> IO Unit`
- `Lean.Vir.Browser.Animation.requestAnimationFrame : (Float -> IO Unit) -> IO Lean.Vir.Browser.AnimationFrame`
- `Lean.Vir.Browser.Animation.cancelAnimationFrame : @& Lean.Vir.Browser.AnimationFrame -> IO Unit`

The built-in `common.*` and `browser.*` targets do not require a `hostBindings`
option:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "demo-host.irpkg",
});

console.log(vir.call("HostInterop.titleHandshake", "browser handshake"));
```

`Lean.Vir.Browser.Console.log` maps to `console.log`, title calls map to
`document.title`, `Document.querySelector` returns an opaque element resource,
`Element` calls use DOM element properties/methods, event listeners call
retained Lean closures with an opaque `Event` resource, timers map to
`setTimeout`, animation frames map to
`requestAnimationFrame`, and `HTMLInputElement` calls first narrow an element
before reading or writing `checked` and `value`.
The browser runtime requires `globalThis.document` for `browser.document.*`
targets. In Node, use `lean-vir/vir-runtime-node` or pass explicit
`hostBindings`; the Node wrapper provides virtual document and element state for
these built-in browser targets. No extra `createVirRuntime` option is needed for
the built-in `common.*` or `browser.*` imports. See MDN for the underlying
browser APIs:

- [MDN `console.log`](https://developer.mozilla.org/en-US/docs/Web/API/console/log_static)
- [MDN `Document.title`](https://developer.mozilla.org/en-US/docs/Web/API/Document/title)
- [MDN `Document.querySelector`](https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector)
- [MDN `Node.textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent)
- [MDN `Element.getAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getAttribute)
- [MDN `Element.setAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setAttribute)
- [MDN `Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event)
- [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)
- [MDN `EventTarget.removeEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/removeEventListener)
- [MDN `HTMLInputElement.checked`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checked)
- [MDN `HTMLInputElement.value`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/value)
- [MDN `setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout)
- [MDN `clearTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/clearTimeout)
- [MDN `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)
- [MDN `cancelAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/cancelAnimationFrame)

Custom imports can be declared directly:

```lean
import Lean.Vir.Host

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat

def bumpFromJs (n : Nat) : Nat :=
  jsBumpNat n
```

Bind custom targets when constructing the runtime. User bindings override the
default `common.*` and `browser.*` bindings:

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
values flow from Lean to JavaScript as callback handles.

`vir.dispose()` tears down the runtime-side host state:

- built-in browser bindings remove live event listeners, clear pending timers,
  cancel pending animation frames, and release retained callbacks;
- custom host binding maps can expose `[VIR_HOST_DISPOSE]()` or `dispose()` for
  their own cleanup;
- any `VirCallback` objects still tracked by the runtime are released;
- later calls through `vir.call(...)`, `exportsByName`, or a callback fail with
  a disposed-runtime error.

Calling `vir.loadIrPackageBytes(...)` on a runtime that already has a package
loaded performs the same package-resource cleanup before installing the new
manifest. This keeps old listeners, timers, animation frames, and callback roots
from surviving package reload.

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
to 32 imported declarations with IR arity at most 6; async host calls will need
a later Promise/JSPI-shaped boundary.
