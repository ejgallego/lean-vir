module

public import Vir.Resources
public import Vir.Resources.Build
public import Vir.Resources.Embed
public meta import Vir.Attributes
public meta import Vir.Interface.Classify.Signature
public meta import Vir.GeneratePackage

set_option compiler.postponeCompile false

@[vir_export]
public def NativeClient.greet (name : String) : String := "Hello, " ++ name

@[vir_export]
public def NativeClient.double (n : Nat) : Nat := n + n

-- Execute native-loaded markers and classification, not just their imports.
run_meta do
  let env ← Lean.getEnv
  for (name, expected) in [(`NativeClient.greet, Vir.Interface.InterfaceType.string),
      (`NativeClient.double, Vir.Interface.InterfaceType.nat)] do
    unless (vir_export.getState env).contains name do
      Lean.throwError "export marker missing for {name}"
    let info ← Lean.getConstInfo name
    let .ok signature ← Vir.Interface.analyzeExportInterface info.type
      | Lean.throwError "classification failed for {name}"
    let #[argument] := signature.args
      | Lean.throwError "unexpected arity for {name}"
    unless argument.type == expected &&
        signature.result == expected && signature.effect == .pure do
      Lean.throwError "unexpected interface for {name}"

-- Encoding data uses the current schema/compatibility, not a frozen fixture pin.
public def NativeClient.descriptor : Vir.Resources.Descriptor := {
  schemaVersion := 2, logicalId := "native-client/encoder", kind := .program,
  compatibility := Vir.Resources.Build.currentCompatibility,
  files := #[], fileEntries := #[] }
