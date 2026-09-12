/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview.Surface.Types

public section

namespace Lean.Vir.Infoview

/-- Exact upstream `PanelWidgetProps`; no VIR-owned props record is introduced. -/
opaque PanelWidgetProps : Type

/-- Exact upstream infoview `DocumentPosition`, distinct from VIR's legacy command record. -/
opaque PanelPosition : Type

/-- Exact upstream `InteractiveGoal` object. -/
opaque InteractiveGoal : Type

/-- Exact upstream `InteractiveTermGoal` object. -/
opaque InteractiveTermGoal : Type

/-- Exact upstream `InteractiveHypothesisBundle` object. -/
opaque InteractiveHypothesisBundle : Type

/-- Exact upstream `CodeWithInfos` tagged-text value. -/
opaque CodeWithInfos : Type

end Lean.Vir.Infoview
