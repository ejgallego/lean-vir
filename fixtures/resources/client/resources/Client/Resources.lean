module

public import Vir.Resources.Assets

public def Client.Resources.resources : Vir.Resources.ResourceSet :=
  include_vir_assets (modules := #[Client.Program])
