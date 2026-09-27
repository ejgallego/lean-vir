module

meta import Vir.Attributes
import Client.Helper

@[vir_export]
public def Client.Program.greet (name : String) : String := Client.Helper.greeting ++ name
