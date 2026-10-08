module

public import Vir.Resources
public import Vir.Resources.Build
public import Vir.Resources.Embed
public meta import Vir.Attributes
public meta import Vir.Compiler.Interface.Classify.Signature
public meta import Vir.Compiler.Interface.Encode

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
    let .ok encoded := Lean.Json.parse argument.toJson
      | Lean.throwError "invalid native-loaded argument encoding"
    let .ok encodedName := encoded.getObjValAs? String "name"
      | Lean.throwError "missing native-loaded argument name"
    let .ok encodedType := encoded.getObjVal? "type"
      | Lean.throwError "missing native-loaded argument type"
    let .ok encodedLabel := encodedType.getObjValAs? String "type"
      | Lean.throwError "missing native-loaded argument type label"
    let .ok encodedTag := encodedType.getObjValAs? Nat "interfaceTag"
      | Lean.throwError "missing native-loaded argument type tag"
    unless encodedName == argument.name && encodedLabel == expected.label &&
        encodedTag == expected.interfaceTag &&
        signature.effect.toJson == "\"pure\"" do
      Lean.throwError "unexpected native-loaded argument/effect encoding"

-- Encoding data uses the current schema/compatibility, not a frozen fixture pin.
public def NativeClient.descriptor : Vir.Resources.Descriptor := {
  schemaVersion := 2, logicalId := "native-client/encoder", kind := .program,
  compatibility := Vir.Resources.Build.currentCompatibility,
  files := #[], fileEntries := #[] }

-- This must be available without importing the generator implementation.
run_meta do
  unless Vir.Interface.InterfaceType.nat.toJson == "{\"type\":\"Nat\",\"interfaceTag\":0}" do
    Lean.throwError "unexpected independently loaded interface encoding"

-- Produce the caller's expectation from classification, before reading any
-- package manifest. A term elaborator embeds the pure JSON result as a String.
elab "expected_signature% " entry:ident : term => do
  let info ← Lean.getConstInfo entry.getId
  let .ok signature ← Vir.Interface.analyzeExportInterface info.type
    | Lean.throwError "cannot classify expected interface for {entry}"
  return Lean.mkStrLit signature.toExpectedSignatureJson

public def NativeClient.greetSignature : String := expected_signature% NativeClient.greet
public def NativeClient.doubleSignature : String := expected_signature% NativeClient.double


-- These declarations exercise the generic codec beyond bounded unary forms.
@[vir_export]
public def NativeClient.nullary : Unit := ()

@[vir_export]
public def NativeClient.multiple (text : String) (count : Nat) : Nat := text.length + count

@[vir_export]
public def NativeClient.effectful : IO Unit := pure ()

@[vir_export]
public def NativeClient.nested (values : Array (Option Nat)) : Array (Option Nat) := values

public def NativeClient.nullarySignature : String := expected_signature% NativeClient.nullary
public def NativeClient.multipleSignature : String := expected_signature% NativeClient.multiple
public def NativeClient.effectfulSignature : String := expected_signature% NativeClient.effectful
public def NativeClient.nestedSignature : String := expected_signature% NativeClient.nested
