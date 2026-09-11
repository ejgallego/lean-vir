/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Browser
meta import Vir.Attributes

public section

open Lean.Vir.Browser

namespace SlidesCanvas

/-- A time-based triangular wave spanning the drawable canvas width. -/
private def bounceX (elapsed : Float) : Float :=
  -- At 250 pixels/second, the rectangle crosses the 568-pixel span in 2272 ms.
  let halfPeriodMs := 2272
  let periodMs := 2 * halfPeriodMs
  let phaseMs := elapsed.toUInt32.toNat % periodMs
  let distanceMs := if phaseMs ≤ halfPeriodMs then phaseMs else periodMs - phaseMs
  Float.scaleB (UInt64.ofNat distanceMs).toFloat (-2)

partial def drawFrame
    (ctx : Lean.Vir.Js CanvasRenderingContext2D)
    (status : Lean.Vir.Js Element)
    (frame : Nat)
    (origin : Float)
    (timestamp : Float) : DomM Unit := do
  let x := bounceX (timestamp - origin)
  let zero ← Lean.Vir.JsValue.ofFloat 0.0
  CanvasRenderingContext2D.clearRect ctx zero zero
    (← Lean.Vir.JsValue.ofFloat 640.0) (← Lean.Vir.JsValue.ofFloat 360.0)
  let jsX ← Lean.Vir.JsValue.ofFloat x
  let jsY ← Lean.Vir.JsValue.ofFloat 124.0
  let size ← Lean.Vir.JsValue.ofFloat 72.0
  CanvasRenderingContext2D.fillRect ctx jsX jsY size size
  CanvasRenderingContext2D.strokeRect ctx jsX jsY size size
  let text ← Lean.Vir.JsValue.ofString s!"Lean animation frame: {frame}"
  Element.setTextContent status (← Lean.Vir.Js.Nullable.ofJs text)
  let _ ← Animation.requestAnimationFrame fun nextTimestamp => do
    drawFrame ctx status (frame + 1) origin (← Lean.Vir.JsValue.toFloat nextTimestamp)
  pure ()

/-- Builds and starts the slide's DOM and canvas animation entirely from Lean. -/
@[vir_startup]
def mount : DomM Unit := do
  let document ← Document.current
  match ← Lean.Vir.Js.Nullable.toOption
      (← Document.querySelector document (← Lean.Vir.JsValue.ofString "#vir-slide-root")) with
  | none => pure ()
  | some root =>
      let status ← Document.createElement document (← Lean.Vir.JsValue.ofString "p")
      DOMTokenList.add (← Element.getClassList status)
        (← Lean.Vir.JsValue.ofString "vir-slide-status")
      let startingText ← Lean.Vir.JsValue.ofString "Starting Lean animation…"
      Element.setTextContent status (← Lean.Vir.Js.Nullable.ofJs startingText)
      discard <| Element.appendChild root status
      let canvasElement ← Document.createElement document (← Lean.Vir.JsValue.ofString "canvas")
      DOMTokenList.add (← Element.getClassList canvasElement)
        (← Lean.Vir.JsValue.ofString "vir-slide-canvas")
      Element.setAttribute canvasElement
        (← Lean.Vir.JsValue.ofString "role") (← Lean.Vir.JsValue.ofString "img")
      Element.setAttribute canvasElement (← Lean.Vir.JsValue.ofString "aria-label")
        (← Lean.Vir.JsValue.ofString "A blue rectangle bouncing horizontally across a canvas")
      discard <| Element.appendChild root canvasElement
      match ← HTMLCanvasElement.fromElement canvasElement with
      | none =>
          let text ← Lean.Vir.JsValue.ofString "Lean could not initialize the canvas element"
          Element.setTextContent status (← Lean.Vir.Js.Nullable.ofJs text)
      | some canvas =>
          HTMLCanvasElement.setWidth canvas (← Lean.Vir.JsValue.ofFloat 640.0)
          HTMLCanvasElement.setHeight canvas (← Lean.Vir.JsValue.ofFloat 360.0)
          match ← Lean.Vir.Js.Nullable.toOption (← HTMLCanvasElement.getContext2D canvas) with
          | none =>
              let text ← Lean.Vir.JsValue.ofString "CanvasRenderingContext2D is unavailable"
              Element.setTextContent status (← Lean.Vir.Js.Nullable.ofJs text)
          | some ctx =>
              CanvasRenderingContext2D.setFillStyle ctx (← CanvasStyle.ofString "#2563eb")
              CanvasRenderingContext2D.setStrokeStyle ctx (← CanvasStyle.ofString "#0f172a")
              CanvasRenderingContext2D.setLineWidth ctx (← Lean.Vir.JsValue.ofFloat 3.0)
              let text ← Lean.Vir.JsValue.ofString "Lean VIR"
              let metrics ← CanvasRenderingContext2D.measureText ctx text
              let textWidth ← Lean.Vir.JsValue.toFloat (← TextMetrics.getWidth metrics)
              let widthText ← Lean.Vir.JsValue.ofString s!"Lean text width: {textWidth.toUInt64.toNat}"
              Element.setTextContent status (← Lean.Vir.Js.Nullable.ofJs widthText)
              let _ ← Animation.requestAnimationFrame fun jsTimestamp => do
                let timestamp ← Lean.Vir.JsValue.toFloat jsTimestamp
                drawFrame ctx status 0 timestamp timestamp
              pure ()

end SlidesCanvas
