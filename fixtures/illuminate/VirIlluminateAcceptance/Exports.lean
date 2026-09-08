/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Illuminate.Animation.Player
public meta import Vir.Attributes

public section

namespace Illuminate.Animation.Vir

open Illuminate.AnimationPlayer

/-- Pure animation trace entry compiled for the canonical VIR browser package. -/
@[vir_export]
def replayTraceTyped
    (animation : PlayerAnimation)
    (events : List PlayerEvent) : Except String (Array FrameAction) :=
  AnimationPlayer.replayTrace animation events

end Illuminate.Animation.Vir
