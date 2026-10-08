module

meta import Vir.Attributes
import Client.Helper

-- The callable namespace deliberately differs from its owning module.
@[vir_export]
public def OtherNamespace.greet (name : String) : String := Client.Helper.greeting ++ name

-- Callable startup inventory does not imply automatic execution by the loader.
@[vir_startup]
public def OtherNamespace.startup : IO Unit := pure ()
