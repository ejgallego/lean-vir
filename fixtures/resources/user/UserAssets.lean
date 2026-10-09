module

public import Vir.Resources.Assets

-- The program belongs to the dependency, not this asset library's package.
public def UserAssets.resources : Vir.Resources.ResourceSet :=
  include_vir_assets (modules := #[Client.Program])
