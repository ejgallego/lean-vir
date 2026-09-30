module

public import Vir.Resources.Embed

public def Client.Resources.bundle : Vir.Resources.Bundle :=
  include_vir_bundle "../../.vir-generated/ClientResources.virres"
