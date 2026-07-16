# Lake Integration

VIR provides a module facet for compiling marked Lean declarations into a
browser-loadable `.irpkg`, plus a package facet for installing the matching
JavaScript/Wasm SDK. This is intentionally a focused browser-program workflow,
not a general Lean-to-Wasm compiler.

## Mark The Browser Surface

Import `Vir` and mark JavaScript-callable declarations with `@[vir_export]`.
Use `@[vir_entry]` for startup actions that the browser host should run after
loading the package. An entry is also an export and must take no JavaScript
arguments and return `Unit` through a supported effect such as `DomM`.

```lean
import Vir

open Lean.Vir.Browser

namespace MySlides.Runtime

@[vir_export]
def answer : Nat := 42

@[vir_entry]
def mount : DomM Unit := do
  let some root ← Document.querySelector "#vir-slide-root" | pure ()
  Element.setTextContent root "This DOM was updated from Lean"

end MySlides.Runtime
```

Only declarations marked in the requested module are selected. Imported
declarations are not implicitly re-exported. A marked build with no matching
declarations fails with a diagnostic instead of silently producing an empty
package.

Lean module-system files can import the marker definitions without pulling in
the legacy VIR library:

```lean
module

public meta import Vir.Attributes

@[vir_export]
public def MyModule.value : Nat := 42
```

The canvas example below currently uses the legacy-source path because the
broader browser library has not yet migrated to the module system.

## Build The Module

```text
lake build +MySlides.Runtime:vir
```

The facet writes package-local artifacts under `.lake/build/vir/`:

```text
modules/MySlides/Runtime.irpkg
reports/MySlides/Runtime.report.md
```

For current, legacy Lean modules the generator re-elaborates the module source.
When Lake supplies compiled module IR, the facet depends on that `.ir` and uses
a generated `import all MySlides.Runtime` driver. In both modes, Lake tracks the
compiled module and VIR generator as dependencies.

An executable or renderer that consumes the package should declare the facet as
a build dependency:

```lean
lean_exe my_slides where
  root := `Main
  needs := #[`+MySlides.Runtime:vir]
```

For a Verso Slides integration, the intended configuration is:

```lean
vir := some { module := `MySlides.Runtime }
```

The renderer copies the generated `.irpkg` and SDK beside the presentation,
creates its mount element, waits for Reveal initialization, loads the runtime,
and calls `vir.runEntries()`. It should call `vir.dispose()` during page
teardown and render initialization failures visibly.

## Install The Browser SDK

```text
lake build :virSdk
```

This installs release `v0.1.0` under `.lake/build/vir/sdk/`. The installer
checks the SDK version, runtime ABI, non-empty source commit, and every manifest
checksum. Set `VIR_SDK_ARCHIVE=/path/to/lean-vir-sdk.tar.gz` to use a local or
CI-provided archive without network access. The facet is cached by Lake.

The browser host can then load and run all startup entries in manifest order:

```js
import { createVirRuntime } from "./vir/sdk/js/vir-runtime.js";
import { createBrowserHostBindings } from "./vir/sdk/js/vir-host-bindings.js";

const vir = await createVirRuntime({
  wasmUrl: "./vir/sdk/wasm/vir-upstream.wasm",
  irPackageUrl: "./vir/modules/MySlides/Runtime.irpkg",
  hostBindings: createBrowserHostBindings(),
});
vir.runEntries();
```

`runEntries()` is ordered and once-only for each successfully loaded package.
A successful replacement package resets the entry state; a failed replacement
leaves the existing package and its entry state unchanged.

## Canvas Example

[`examples/SlidesCanvas.lean`](../examples/SlidesCanvas.lean) builds its status
element and canvas, draws a moving rectangle, and schedules every animation
frame entirely from Lean. Build its package with the same facet used by client
projects:

```text
lake build +SlidesCanvas:vir
```

The public rectangle API keeps ordinary Lean floats:

```lean
def Lean.Vir.Browser.CanvasRenderingContext2D.fillRect
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y width height : Float) :
    DomM Unit
```

VIR converts these values to temporary JavaScript resources internally. The
same browser surface includes DOM element creation and mutation, class/style
updates, canvas sizing and context lookup, paths, styles, transforms, and
animation-frame callbacks.
