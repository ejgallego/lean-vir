# Call Lean From JavaScript

This guide is for app code that wants to call one or more Lean declarations from
JavaScript.

The flow is:

1. write a Lean source file;
2. generate a `.irpkg` package for the declarations you want to call;
3. serve `vir-upstream.wasm` and the `.irpkg`;
4. create a runtime and call the Lean entry by name.

## 1. Write The Lean Function

Start with an ordinary Lean file. Exported declarations can be pure functions
or recognized synchronous effects, as long as their argument and result types
are part of the current browser interface surface. Use `Lean.Vir.RuntimeM` for
JavaScript resource/runtime effects, raw `IO` for ordinary host IO boundaries,
`Lean.Vir.Browser.DomM` for DOM code, and `Lean.Vir.React.ReactM` for React
render-construction code.

```lean
namespace MyApp

def total (values : Array Nat) : Nat :=
  values.foldl (fun acc value => acc + value) 0

def greeting (name : String) : String :=
  "Hello, " ++ name

def classify (n : Nat) : Sum String Nat :=
  if n = 0 then
    .inl "zero"
  else
    .inr (n + 1)

def validateName (name : String) : Except String String :=
  if name.length = 0 then
    .error "empty name"
  else
    .ok (greeting name)

end MyApp
```

## 2. Generate A Package

Build the browser WASM artifact once:

```bash
npm run build:demo
```

Then generate a package. Put it under `web/public/` if you want Vite to serve it
by URL:

```bash
npm run generate:irpkg -- MyApp.lean web/public/my-app.irpkg MyApp.total MyApp.greeting MyApp.classify MyApp.validateName
```

The final arguments are Lean declaration names. You can list one export or many
exports. The generated package embeds a manifest with the callable entries and
their argument/result types.

Check the package in the generic runner:

```bash
npm run dev -- --port 5173
```

Open:

```text
http://127.0.0.1:5173/dev.html?package=my-app.irpkg
```

If the package lives outside `web/public/`, open `/dev.html` and use the
`.irpkg` file picker instead.

## 3. Call It From JavaScript

In this repository's Vite app, import the browser runtime directly:

```js
import { createVirRuntime } from "./src/vir-runtime.js";

const vir = await createVirRuntime({
  wasmUrl: `${import.meta.env.BASE_URL}vir-upstream.wasm`,
  irPackageUrl: `${import.meta.env.BASE_URL}my-app.irpkg`,
});

const total = vir.call("MyApp.total", [2, 3, 5, 8]);
const greeting = vir.call("MyApp.greeting", "Lean");
const classified = vir.call("MyApp.classify", 4);
const validated = vir.call("MyApp.validateName", "Lean");

console.log(total);    // "18"
console.log(greeting); // "Hello, Lean"
console.log(classified); // { kind: "inr", value: "5" }
console.log(validated);  // { kind: "ok", value: "Hello, Lean" }
```

`vir.call(name, ...args)` accepts the Lean declaration name, manifest `id`, or
generated JavaScript name.

You can also call generated methods by JavaScript name:

```js
console.log(vir.exportsByName.MyApp_total([2, 3, 5, 8]));
```

## Sum And Except Values

Lean `Sum alpha beta` and `Except error ok` are represented as tagged objects.

For inputs, use `{ kind, value }`:

```js
vir.call("MyApp.useSum", { kind: "inl", value: "zero" });
vir.call("MyApp.useSum", { kind: "inr", value: 5 });
vir.call("MyApp.useExcept", { kind: "error", value: "bad input" });
vir.call("MyApp.useExcept", { kind: "ok", value: "good input" });
```

Single-constructor-key objects are also accepted:

```js
vir.call("MyApp.useSum", { inr: 5 });
vir.call("MyApp.useExcept", { ok: "good input" });
```

Results come back as `{ kind, value }`:

```js
vir.call("MyApp.classify", 0);
// { kind: "inl", value: "zero" }

vir.call("MyApp.classify", 4);
// { kind: "inr", value: "5" }

vir.call("MyApp.validateName", "");
// { kind: "error", value: "empty name" }

vir.call("MyApp.validateName", "Lean");
// { kind: "ok", value: "Hello, Lean" }
```

Payload-carrying sum types can use Lean's built-in `Sum` and `Except`
interface support. Custom nullary inductives are supported as enums, and
non-indexed custom inductives can cross the boundary using `{ kind }` for
nullary constructors, `{ kind, value }` for single-field constructors, or
`{ kind, fields }` for multi-field constructors. Those custom-inductive shapes
are canonical: `Sum`/`Except` conveniences such as `{ tag, value }` and
single-constructor-key objects do not apply to user-defined custom inductives.

For example, a recursive tree can use one-field leaves and multi-field branch
nodes:

```lean
inductive Tree (α : Type) where
  | leaf (value : α)
  | branch (left : Tree α) (right : Tree α)

def treeRootScore (tree : Tree Nat) : Nat := ...
```

```js
vir.call("MyApp.treeRootScore", {
  kind: "branch",
  fields: {
    left: { kind: "leaf", value: 4 },
    right: { kind: "leaf", value: 5 },
  },
});
```

Results use the same constructor shape. Large exact numeric payloads, such as
`Nat`, still come back as decimal strings inside the returned object.

A lambda-calculus AST follows the same convention:

```lean
inductive Term where
  | var (name : String)
  | app (fn : Term) (arg : Term)
  | lam (binder : String) (body : Term)
```

```js
vir.call("MyApp.termSize", {
  kind: "app",
  fields: {
    fn: { kind: "lam", fields: { binder: "x", body: { kind: "var", value: "x" } } },
    arg: { kind: "var", value: "y" },
  },
});
```

Mixed nullary and payload constructors follow the same rule:

```lean
inductive Json where
  | null
  | bool (value : Bool)
  | array (items : List Json)
```

```js
vir.call("MyApp.jsonScore", { kind: "null" });
vir.call("MyApp.jsonScore", { kind: "bool", value: true });
vir.call("MyApp.jsonScore", {
  kind: "array",
  value: [{ kind: "null" }, { kind: "bool", value: false }],
});
```

Direct recursive structures are also supported when every field has a
manifest-supported runtime type:

```lean
structure Chain where
  label : String
  next : Option Chain

def chainRootScore (chain : Chain) : Nat := ...
```

```js
vir.call("MyApp.chainRootScore", {
  label: "root",
  next: { label: "leaf", next: null },
});
```

`Option Chain` uses the normal option shape: `null` for `none`, or the nested
`Chain` object for `some`. Recursive structures are direct records; they do not
wrap the recursive field in a custom-inductive `{ kind, ... }` object.

## 4. Serve The Artifacts In Your App

For a browser app, serve both files as static assets:

- `vir-upstream.wasm`, generated by `npm run build:demo`;
- your `.irpkg`, generated by `npm run generate:irpkg`.

Then point the runtime at their served URLs:

```js
import { createVirRuntime } from "lean-vir";

const vir = await createVirRuntime({
  wasmUrl: "/assets/vir-upstream.wasm",
  irPackageUrl: "/assets/my-app.irpkg",
});
```

The `.irpkg` can be served as ordinary static bytes. The WASM file should be
served with the normal `application/wasm` content type when your server supports
it.

## JavaScript Values

Common Lean values map to JavaScript values like this:

- `Nat`, `Int`, `UInt64`, and `USize` inputs accept a safe integer, `BigInt`, or
  decimal string. Results are decimal strings so large exact values do not lose
  precision in JavaScript.
- `Bool`, `String`, `Float`, `Float32`, `UInt8`, `UInt16`, and `UInt32` use the
  corresponding JavaScript boolean, string, or number values.
- `Array alpha` and `List alpha` use JavaScript arrays.
- `Option alpha` accepts `null` for `none` and a bare value for `some`. Results are
  `null` or the inner value.
- Products use `{ fst, snd }` or two-element arrays.
- `Sum` and `Except` use `{ kind, value }` tagged objects.
- Structures use JavaScript objects keyed by Lean field name.
- Nullary inductive enums use generated constructor names.
- Custom inductive constructors use `{ kind }`, `{ kind, value }`, or
  `{ kind, fields }` depending on field count.
- `ByteArray` inputs accept byte arrays or byte-like JavaScript arrays; results
  are `Uint8Array`.

See `docs/JS_API.md` for the complete type surface, including `Sum`, `Except`,
`Lean.Expr`, nested structures, and host imports.

## Lean Calling JavaScript

If the Lean function needs to call back into JavaScript, mark an opaque Lean
declaration with `@[vir_js "..."]` and pass a matching `hostBindings` function
when creating the runtime.

Lean:

```lean
import Vir.Host

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat

def bumpViaJavaScript (n : Nat) : Nat :=
  jsBumpNat n
```

JavaScript:

```js
const vir = await createVirRuntime({
  wasmUrl: "/assets/vir-upstream.wasm",
  irPackageUrl: "/assets/my-app.irpkg",
  hostBindings: {
    "demo.bumpNat": (n) => (BigInt(n) + 1n).toString(),
  },
});

console.log(vir.call("MyApp.bumpViaJavaScript", 41)); // "42"
```

Host imports are synchronous in the current prototype.

Most app code can pass only its custom `hostBindings`; the built-in browser
bindings stay installed as defaults. Packages that call
`Lean.Vir.React.Root.*` in a browser also need the separate React host entry.
See `docs/JS_API.md` for the canonical `defaultHostBindings` composition and
low-level binding factory reference.

## Troubleshooting

- Package generation failed: open the generated `.report.md`; it lists missing
  IR declarations, missing native extern registrations, and unsupported
  interface exports.
- The browser runner does not show an entry: the declaration was not listed as a
  root, or its type is not supported by the manifest interface yet.
- A result is a string instead of a number: exact integer results intentionally
  use decimal strings to avoid JavaScript precision loss.
- A package loads in `/dev.html` but not your app: confirm both
  `vir-upstream.wasm` and the `.irpkg` are served at the URLs passed to
  `createVirRuntime`.
