/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Widget

namespace Lean.Vir.Infoview

open Lean

/--
Props for the minimal VIR infoview shell.

The `.irpkg` entry must have signature `String -> IO Bool`; the shell passes a
fresh DOM selector for its nested mount element.
-/
structure WidgetProps where
  runtimeUrl : String
  wasmUrl : String
  packageUrl : String
  entry : String
  mountId : String := "vir-infoview-widget"
  deriving Server.RpcEncodable

@[widget_module]
def widget : Widget.Module where
  javascript := include_str ".." / "web" / "src" / "vir-infoview-widget.js"

/--
Local development props for the React proof-widget example.

Run `lake build Vir.Infoview`, `npm run build:demo`, and
`npm run dev -- --port 5173`, then open `examples/InfoviewVirWidget.lean` in
an editor with the Lean infoview.
-/
def localProofWidget : WidgetProps where
  runtimeUrl := "http://127.0.0.1:5173/src/vir-runtime.js"
  wasmUrl := "http://127.0.0.1:5173/vir-upstream.wasm"
  packageUrl := "http://127.0.0.1:5173/demo-host.irpkg"
  entry := "ReactProofWidget.mount"
  mountId := "vir-react-proof-widget"

end Lean.Vir.Infoview
