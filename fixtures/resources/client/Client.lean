module

public import Vir.Resources
public import Vir.Resources.Runtime
public import Client.Resources

public def Client.resources : Vir.Resources.ResourceSet := {
  runtime := Vir.Resources.Runtime.bundle
  programs := #[Client.Resources.bundle]
}
