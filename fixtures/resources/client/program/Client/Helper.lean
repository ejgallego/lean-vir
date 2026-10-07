module

meta import Vir.Attributes

-- Imported export markers must not become the composition root's public API.
@[vir_export]
public def ImportedNamespace.notAnEntrypoint : Nat := 7

private def greetingText : String := "Hello, "

public opaque Client.Helper.greeting : String := greetingText
