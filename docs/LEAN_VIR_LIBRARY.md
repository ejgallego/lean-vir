# Lean.Vir Library

`Lean.Vir.*` is the Lean-side library for declarations that call back into the
JavaScript host while running through VIR's WASM interpreter.

The library is built locally by:

```bash
npm run build:lean-lib
```

Package generation commands run that step automatically and add
`build/lean-lib` to `LEAN_PATH`, so local `.lean` sources can import the
modules below.

## User Workflow

For the built-in browser and common host imports, the Lean code is the only
piece users need to write. The JavaScript runtime already provides default
bindings for `common.*` and `browser.*` targets.

1. Import the Lean module that provides the host import.

   ```lean
   import Lean.Vir.Browser
   ```

2. Write an exported Lean declaration that calls the host import.

   ```lean
   def titleHandshake (label : String) : IO String := do
     let title := "Lean VIR host: " ++ label
     Lean.Vir.Browser.Document.setTitle title
     Lean.Vir.Browser.Document.getTitle
   ```

3. Generate a package with that declaration as a root.

   ```bash
   npm run generate:irpkg -- MyDemo.lean web/public/my-demo.irpkg titleHandshake
   ```

   The command builds `Lean.Vir.*`, adds `build/lean-lib` to `LEAN_PATH`, writes
   the `.irpkg`, and writes a report next to it. The report should list the
   JavaScript host imports collected from the package.

4. Load the package in `/dev.html`. If it was written under `web/public/`, use a
   package URL. Otherwise, upload the generated `.irpkg` from the page.

   ```text
   dev.html?package=my-demo.irpkg&entry=titleHandshake
   ```

No extra `createVirRuntime` option is needed for the built-in browser imports:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "my-demo.irpkg",
});

vir.call("titleHandshake", "browser handshake");
```

Browser event listeners use the same default bindings. Lean passes a closure
directly with `Element.addEventListener`; the host retains that closure
until the listener is removed or the runtime is disposed.

```lean
import Lean.Vir.Browser

def mountButtonCallback : IO Unit := do
  match ← Lean.Vir.Browser.Document.querySelector "#run" with
  | none => pure ()
  | some button =>
      let _listener ← Lean.Vir.Browser.Element.addEventListener
        button "click" fun _event => do
          Lean.Vir.Browser.Console.log "clicked run"
      pure ()
```

In Node tests or command-line tools, import the Node wrapper instead:

```js
import { createVirRuntime } from "lean-vir/vir-runtime-node";
```

That wrapper uses the same runtime and installs virtual browser bindings for
`Lean.Vir.Browser.Document`, `Lean.Vir.Browser.Element`,
`Lean.Vir.Browser.HTMLInputElement`, timers, and animation frames.

Pass `hostBindings` only for custom targets or to override one of the default
bindings. If a package imports both built-in and custom targets, the custom map
can contain just the custom entries; unresolved keys still fall through to the
default bindings.

For custom JavaScript functions, declare the host import in Lean and bind the
same target string in JavaScript.

```lean
import Lean.Vir.Host

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat

def bumpViaJs (n : Nat) : Nat :=
  jsBumpNat n
```

Generate a package with `bumpViaJs` as a root:

```bash
npm run generate:irpkg -- MyCustom.lean web/public/custom.irpkg bumpViaJs
```

Then provide the matching JavaScript binding when creating the runtime:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "custom.irpkg",
  hostBindings: {
    "demo.bumpNat": (n) => (BigInt(n) + 1n).toString(),
  },
});

vir.call("bumpViaJs", 41);
```

When checking a Lean file outside package generation, use the same library path:

```bash
npm run build:lean-lib
LEAN_PATH="build/lean-lib${LEAN_PATH:+:$LEAN_PATH}" lean MyDemo.lean
```

## Modules

`Lean.Vir.Host` provides the low-level `@[vir_js "..."]` host-import attribute
and the `@[vir_resource "..."]` marker for opaque Lean resource types.

```lean
import Lean.Vir.Host

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat
```

`Lean.Vir.Common` provides small host imports that are useful in browser and
Node-like environments:

- `Lean.Vir.Common.echoString : @& String -> String`
- `Lean.Vir.Common.addNat : Nat -> Nat -> Nat`

`Lean.Vir.Browser` provides the first browser-specific imports:

- `Lean.Vir.Browser.Console.log : @& String -> IO Unit`
- `Lean.Vir.Browser.Element`
- `Lean.Vir.Browser.Event`
- `Lean.Vir.Browser.EventListener`
- `Lean.Vir.Browser.HTMLInputElement`
- `Lean.Vir.Browser.Timeout`
- `Lean.Vir.Browser.AnimationFrame`
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

The browser runtime bindings use standard browser APIs and require
`globalThis.document` for document calls. In non-browser runtimes, use
`lean-vir/vir-runtime-node` or pass explicit `hostBindings`; the Node wrapper
keeps virtual document and element state for the built-in browser APIs. Event
listener, timeout, and animation-frame imports are also virtualized for tests.

External references:

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

## Example

```lean
import Lean.Vir.Browser

namespace HostInterop

def titleHandshake (label : String) : IO String := do
  let title := "Lean VIR host: " ++ label
  Lean.Vir.Browser.Document.setTitle title
  Lean.Vir.Browser.Document.getTitle

end HostInterop
```

This example is included in the stock host package. In the browser runner:

```text
dev.html?package=demo-host.irpkg&entry=HostInterop_titleHandshake
```

## Binding Contract

`@[vir_js "target.name"]` marks an `opaque` declaration as a package-scoped
JavaScript host import. The package generator records the Lean declaration,
JavaScript target, argument types, result type, effect, and trampoline slot in
the embedded manifest `hostImports` array.

The JavaScript runtime binds targets through `hostBindings`:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "custom.irpkg",
  hostBindings: {
    "demo.bumpNat": (n) => (BigInt(n) + 1n).toString(),
  },
});
```

Bindings receive decoded JavaScript values and return a value matching the Lean
result type. `Unit` results should return `undefined` or `null`.

Lean function values in host-import arguments are supported as callbacks from
JavaScript into Lean. The JavaScript runtime roots the closure in the WASM shim,
passes a handle to the host binding, and releases it with `vir_closure_release`
when the host binding calls `callback.release()` or when the runtime is disposed.
JavaScript-provided function values are not accepted as Lean arguments in this
phase.

`Element.addEventListener`, `Timer.setTimeout`, and
`Animation.requestAnimationFrame` use the callback ABI. Event resources are valid
only during the callback. Listener, timeout, and frame handles own their retained
callbacks until removal, cancellation, firing, or runtime disposal. See
`docs/EVENT_CALLBACK_ROADMAP.md` for the detailed ownership contract and
follow-up work.

## Current Surface

Supported host import signatures use the same v1 interface types as exported
entrypoints:

- `Unit`
- `Nat`, `Int`, `Bool`, `String`
- `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`
- `ByteArray`
- `Array α`, `List α`, `Option α`, and `α × β` over supported types
- nullary inductive enums
- opaque `Lean.Vir.Browser` resource handles
- Lean function values used as host callbacks
- `Lean.Expr`

Imports may be pure functions or `IO α` actions. The v1 host boundary is
synchronous; returning a JavaScript `Promise` is an error. The current package
format supports up to 32 host imports with IR arity at most 6.

## Runtime Behavior

Host imports are not native extern registrations. The package generator encodes
them separately, the WASM shim maps them to finite trampolines, and the runtime
dispatches them through `env.vir_js_call`.

This keeps general native symbol lookup closed while allowing declarations in a
package to call explicitly declared JavaScript bindings.

## Troubleshooting

If package generation fails, inspect the generated report:

- `JavaScript Host Imports` should list the imported declarations and targets.
- `Interface Diagnostics` points out unsupported argument or result types.
- `Missing Native Extern Registrations` is unrelated to `@[vir_js]`; it means
  the normal Lean IR closure reached an unsupported native runtime primitive.

If a host import is missing at runtime, check that the manifest target string
matches the key in `hostBindings`. If a binding returns a `Promise`, the v1
runtime rejects the call because host imports are synchronous.
