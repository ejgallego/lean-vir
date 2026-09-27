/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

import Lean
import Vir.Resources
import Vir.Resources.Pack
import Vir.Resources.Sha256
import Vir.Resources.Bytes
public meta import Vir.Resources
public meta import Vir.Resources.Pack
public meta import Vir.Resources.Sha256
public meta import Vir.Resources.Bytes

open Vir.Resources

private def check (label : String) (ok : Bool) : IO Unit :=
  unless ok do throw <| IO.userError s!"resource test: {label}"

private def success (label : String) (value : Except ResourceError α) : IO α :=
  match value with
  | .ok a => pure a
  | .error e => throw <| IO.userError s!"{label}: {repr e}"

private def failure (code : String) (value : Except ResourceError α) : IO Unit :=
  match value with
  | .ok _ => throw <| IO.userError s!"expected failure {code}"
  | .error e => check s!"expected {code}, got {repr e}" (e.code == code)

-- Fixed cross-language identity vector, independent of the executing compiler.
private def compatibility : Compatibility := {
  leanBuildId := "470d5ce1400764999581fd26d5d72b00d990b0f4"
  runtimeAbi := "test-abi"
  jsApiVersion := 1
  irFormatVersion := 11 }

-- Synthetic integrity fixtures, not executable runtime/program acceptance.
private def runtime : Bundle := Id.run do
  let files : Array File := #[⟨"runtime.js", "abc".toUTF8⟩, ⟨"runtime.wasm", ByteArray.empty⟩]
  let descriptor : Descriptor := {
    schemaVersion := 1
    logicalId := "test/λ😀\n\u0001"
    kind := .runtime
    compatibility
    files := files.map fun f => {
      path := f.path
      mediaType := if f.path.endsWith ".js" then "text/javascript" else "application/wasm"
      byteLength := f.bytes.size
      sha256 := sha256 f.bytes }
    fileEntries := #[⟨"runtimeModule", "runtime.js"⟩, ⟨"wasm", "runtime.wasm"⟩]
    exports := #[] }
  return { contentId := descriptor.contentId, descriptor, files }

private def program : Bundle := Id.run do
  let files : Array File := #[⟨"program.json", "{}".toUTF8⟩]
  let descriptor : Descriptor := {
    schemaVersion := 1, logicalId := "test/program", kind := .program, compatibility
    files := files.map fun f => ⟨f.path, "application/json", f.bytes.size, sha256 f.bytes⟩
    fileEntries := #[⟨"programSet", "program.json"⟩]
    exports := #[⟨"run", "Test.run", "test-v1"⟩] }
  return { contentId := descriptor.contentId, descriptor, files }

private def withDescriptor (bundle : Bundle) (descriptor : Descriptor) : Bundle :=
  { bundle with descriptor, contentId := descriptor.contentId }

-- Native acquisition must instead check the actual pinned compiler identity.
private def nativeRuntime : Bundle :=
  withDescriptor runtime { runtime.descriptor with
    compatibility := { compatibility with leanBuildId := Lean.githash } }

private def rawPack (descriptor : String) (payload : ByteArray := ByteArray.empty) : ByteArray := Id.run do
  let mut out : ByteArray := ⟨#[86, 73, 82, 82, 69, 83, 0, 1]⟩
  let bytes := descriptor.toUTF8
  for i in [:4] do out := out.push ((bytes.size >>> (8*i)).toUInt8)
  return out ++ bytes ++ payload

private def hashTests : IO Unit := do
  check "empty SHA256" (sha256 ByteArray.empty == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  check "abc SHA256" (sha256 "abc".toUTF8 == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  for (size, digest) in #[(55, "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318"),
      (56, "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a"),
      (63, "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34"),
      (64, "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"),
      (65, "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0"),
      (1000, "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3")] do
    check s!"padding length {size}" (sha256 ⟨Array.replicate size 97⟩ == digest)

private def unitTests : IO Unit := do
  hashTests
  for size in [:260] do
    let bytes : ByteArray := ⟨(Array.range size).map Nat.toUInt8⟩
    check s!"binary literal round trip {size}" ((Bytes.decode (Bytes.encode bytes) size).toOption == some bytes)
  for (text, size) in #[("", 1), ("~~~~~", 4), ("#####", 4), ("00001", 1)] do
    check "malformed binary literal" (Bytes.decode text size |>.toOption.isNone)
  let r := runtime
  let d := r.descriptor
  let _ ← success "runtime validation" r.validate
  check "Unicode canonical identity" (r.contentId == "59bea0c0be16a07242d4f516971f465532b7c5b9d31e8bf90e8bda39b1c54866")
  let reordered := { r with
    descriptor := { d with files := d.files.reverse, fileEntries := d.fileEntries.reverse }
    files := r.files.reverse }
  let _ ← success "reordered input validation" reordered.validate
  check "reordered identity" (reordered.descriptor.contentId == r.contentId)
  check "pure role access" (r.entryPath? "wasm" == some "runtime.wasm")
  check "missing role" (r.entryPath? "missing" == none)
  check "pure export access" (program.exportName? "run" == some "Test.run")
  check "pure payload access" ((r.file? "runtime.js").map (·.bytes) == some "abc".toUTF8)
  failure "SCHEMA_VERSION" (withDescriptor r { d with schemaVersion := 2 }).validate
  failure "INVALID_VERSION" (withDescriptor r { d with
    compatibility := { compatibility with jsApiVersion := 9007199254740992 } }).validate
  failure "PAYLOAD_LIMIT" (withDescriptor r { d with
    files := d.files.set! 0 { d.files[0]! with byteLength := maxPayloadBytes + 1 } }).validate
  failure "MISSING_ROLE" (withDescriptor r { d with fileEntries := #[] }).validate
  failure "DUPLICATE_ROLE" (withDescriptor r { d with fileEntries := d.fileEntries.push d.fileEntries[0]! }).validate
  failure "ENTRY_NOT_FOUND" (withDescriptor r { d with fileEntries := #[⟨"wasm", "absent"⟩] }).validate
  failure "INVENTORY_MISMATCH" { r with files := r.files.pop }.validate
  failure "INVENTORY_MISMATCH" { r with files := r.files.push ⟨"extra", ByteArray.empty⟩ }.validate
  failure "HASH_MISMATCH" { r with files := r.files.set! 0 ⟨"runtime.js", "abd".toUTF8⟩ }.validate
  failure "LENGTH_MISMATCH" { r with files := r.files.set! 0 ⟨"runtime.js", "ab".toUTF8⟩ }.validate
  failure "CONTENT_ID_MISMATCH" { r with contentId := "wrong" }.validate
  failure "DUPLICATE_PATH" { r with files := r.files.push ⟨"RUNTIME.JS", ByteArray.empty⟩ }.validate
  failure "PATH_PREFIX_CONFLICT" { r with files := r.files.push ⟨"runtime.js/child", ByteArray.empty⟩ }.validate
  for bad in #["", ".", "..", "/a", "a/", "a//b", "a/../b", "a\\b", "C:/a", "https://x", "a\x00b",
      "CON", "aux.txt", "LPT1", "com9.bin", "a/PRN.txt", "bundle.json", "BUNDLE.JSON", "a.", "é"] do
    check s!"unsafe path {repr bad}" (!validPath bad)
  for good in #["a", "a/b.c", "LICENSE", "a-_.B", "com10", "normal.name"] do
    check s!"safe path {good}" (validPath good)
  let set : ResourceSet := ⟨r, #[program, program]⟩
  let bundles ← success "set normalization" set.bundles
  check "one copy per identity" (bundles.size == 2)
  let incompatible := withDescriptor program { program.descriptor with
    compatibility := { compatibility with leanBuildId := "other" } }
  failure "INCOMPATIBLE" { set with programs := #[incompatible] }.validate
  let conflict := withDescriptor program { program.descriptor with exports := #[] }
  failure "LOGICAL_ID_CONFLICT" { set with programs := #[program, conflict] }.validate
  failure "EXPECTED_PROGRAM" { set with programs := #[r] }.validate
  let encoded ← success "pack encode" (Pack.encode r)
  let reorderedPack ← success "reordered encode" (Pack.encode reordered)
  check "deterministic pack" (encoded == reorderedPack)
  let decoded ← success "pack decode" (Pack.decode encoded)
  check "round trip descriptor" (decoded.descriptor == d)
  check "round trip bytes" (decoded.files.map (·.bytes) == r.files.map (·.bytes))
  for size in [:encoded.size] do failure "TRUNCATED_PACK" (Pack.decode (encoded.extract 0 size))
  failure "PACK_VERSION" (Pack.decode (encoded.set! 7 2))
  failure "DESCRIPTOR_LIMIT" (Pack.decode (encoded.set! 11 255))
  failure "TRAILING_PACK_DATA" (Pack.decode (encoded.push 0))
  failure "HASH_MISMATCH" (Pack.decode (encoded.set! (encoded.size - 1) 100))
  let json := String.fromUTF8! (encodeDescriptor d)
  for bad in #[json ++ "\n", json.replace "\"schemaVersion\":1" "\"schemaVersion\":1,\"unknown\":0",
      json.replace "\"runtimeAbi\":\"test-abi\"" "\"runtimeAbi\":\"test-abi\",\"unknown\":0",
      json.replace "\"schemaVersion\":1" "\"schemaVersion\":1,\"schemaVersion\":1"] do
    failure "NONCANONICAL_DESCRIPTOR" (Pack.decode (rawPack bad "abc".toUTF8))
  failure "DESCRIPTOR_JSON" (Pack.decode (rawPack
    (json.replace "\"schemaVersion\":1" "\"schemaVersion\":1.0") "abc".toUTF8))
  failure "DESCRIPTOR_LIMIT" (Pack.decode (rawPack (String.ofList (List.replicate 17 '['))))
  failure "DESCRIPTOR_LIMIT" (Pack.decode (rawPack
    (json.replace "\"schemaVersion\":1" "\"schemaVersion\":10000000000000000")))
  -- Start with a harmless red control; exponent notation must be rejected by
  -- preflight, before Json.parse can construct 10^exponent as an enormous Nat.
  for number in #["1e0", "1E+0", "1e-1", "1e1000000000"] do
    failure "DESCRIPTOR_LIMIT" (Pack.decode (rawPack
      (json.replace "\"schemaVersion\":1" s!"\"schemaVersion\":{number}") "abc".toUTF8))
  let quotedExponent := withDescriptor r { d with logicalId := "quoted\"1e1000000000\\still-text" }
  let quotedPack ← success "encode exponent-like metadata" (Pack.encode quotedExponent)
  let _ ← success "quoted exponent is ordinary text" (Pack.decode quotedPack)
  IO.println "resource core: canonical identity, SHA256, paths, integrity, sets and pack tests passed"

public def main (args : List String) : IO Unit := do
  match args with
  | [] => unitTests
  | ["descriptor"] => IO.println (String.fromUTF8! (encodeDescriptor runtime.descriptor))
  | ["native-descriptor"] =>
    IO.println (String.fromUTF8! (encodeDescriptor nativeRuntime.descriptor))
  | ["pack", path] =>
    IO.FS.writeBinFile path (← success "prepare embedding fixture" (Pack.encode runtime))
  | ["native-pack", path] =>
    IO.FS.writeBinFile path (← success "prepare acquisition fixture" (Pack.encode nativeRuntime))
  | "hash" :: paths =>
    for path in paths do IO.println (sha256 (← IO.FS.readBinFile path))
  | _ => throw <| IO.userError "usage: vir_resource_tests [descriptor | native-descriptor | pack FILE | native-pack FILE | hash FILE...]"
