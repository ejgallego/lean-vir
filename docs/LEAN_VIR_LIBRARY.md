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

## Modules

`Lean.Vir.Host` provides the low-level `@[vir_js "..."]` attribute.

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
- `Lean.Vir.Browser.Document.getTitle : IO String`
- `Lean.Vir.Browser.Document.setTitle : @& String -> IO Unit`

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

This example is included in the stock demo package. In the browser runner:

```text
dev.html?package=vir-demo.irpkg&entry=HostInterop_titleHandshake
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

## Current Surface

Supported host import signatures use the same v1 interface types as exported
entrypoints:

- `Unit`
- `Nat`, `Int`, `Bool`, `String`
- `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`
- `ByteArray`
- `Array α`, `List α`, `Option α`, and `α × β` over supported types
- nullary inductive enums
- `Lean.Expr`

Imports may be pure functions or `IO α` actions. The v1 host boundary is
synchronous; returning a JavaScript `Promise` is an error. The current package
format supports up to 16 host imports with IR arity at most 6.

## Runtime Behavior

Host imports are not native extern registrations. The package generator encodes
them separately, the WASM shim maps them to finite trampolines, and the runtime
dispatches them through `env.vir_js_call`.

This keeps general native symbol lookup closed while allowing declarations in a
package to call explicitly declared JavaScript bindings.
