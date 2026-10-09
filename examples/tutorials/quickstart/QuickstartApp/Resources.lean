module

public import Vir.Resources.Assets

public def QuickstartApp.Resources.resources : Vir.Resources.ResourceSet :=
  include_vir_assets (modules := #[QuickstartApp.Program])
