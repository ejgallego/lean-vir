module

meta import Vir.Attributes

@[vir_export]
public def Client.Program.greet (name : String) : String := "Hello, " ++ name
