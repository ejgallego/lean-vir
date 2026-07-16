/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir

open Lean.Vir.Browser

namespace SlidesCanvas

partial def drawFrame
    (ctx : Lean.Vir.Js CanvasRenderingContext2D)
    (status : Lean.Vir.Js Element)
    (frame : Nat)
    (timestamp : Float) : DomM Unit := do
  let x := Float.scaleB timestamp (-4)
  CanvasRenderingContext2D.clearRect ctx 0.0 0.0 640.0 360.0
  CanvasRenderingContext2D.setFillStyle ctx "#2563eb"
  CanvasRenderingContext2D.fillRect ctx x 124.0 72.0 72.0
  CanvasRenderingContext2D.setStrokeStyle ctx "#0f172a"
  CanvasRenderingContext2D.setLineWidth ctx 3.0
  CanvasRenderingContext2D.strokeRect ctx x 124.0 72.0 72.0
  Element.setTextContent status s!"Lean animation frame: {frame}"
  let _ ← Animation.requestAnimationFrame (drawFrame ctx status (frame + 1))
  pure ()

/-- Builds and starts the slide's DOM and canvas animation entirely from Lean. -/
@[vir_entry]
def mount : DomM Unit := do
  match ← Document.querySelector "#vir-slide-root" with
  | none => pure ()
  | some root =>
      let status ← Document.createElement "p"
      Element.ClassList.add status "vir-slide-status"
      Element.setTextContent status "Starting Lean animation…"
      Element.appendChild root status
      let canvasElement ← Document.createElement "canvas"
      Element.ClassList.add canvasElement "vir-slide-canvas"
      Element.appendChild root canvasElement
      match ← HTMLCanvasElement.fromElement canvasElement with
      | none => Element.setTextContent status "Lean could not initialize the canvas element"
      | some canvas =>
          HTMLCanvasElement.setWidth canvas 640
          HTMLCanvasElement.setHeight canvas 360
          match ← HTMLCanvasElement.getContext2D canvas with
          | none => Element.setTextContent status "CanvasRenderingContext2D is unavailable"
          | some ctx =>
              let _ ← Animation.requestAnimationFrame (drawFrame ctx status 0)
              pure ()

end SlidesCanvas
