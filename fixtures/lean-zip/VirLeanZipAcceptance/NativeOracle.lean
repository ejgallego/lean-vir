/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Zip.Native.DeflateDynamic

namespace VirLeanZipAcceptance

open Zip.Native.Deflate

structure CompressionCase where
  name : String
  input : ByteArray
  levels : Array Nat

structure PrescanCase where
  name : String
  input : ByteArray

private def repeatByte (byte : UInt8) (size : Nat) : ByteArray := Id.run do
  let mut result := ByteArray.emptyWithCapacity size
  for _ in [:size] do
    result := result.push byte
  return result

private def byteCycle (size : Nat) : ByteArray := Id.run do
  let mut result := ByteArray.emptyWithCapacity size
  for i in [:size] do
    result := result.push i.toUInt8
  return result

private def deterministicBytes (size alphabet : Nat) : ByteArray := Id.run do
  let mut state : UInt64 := 0x243f6a8885a308d3
  let mut result := ByteArray.emptyWithCapacity size
  for _ in [:size] do
    state := state * 6364136223846793005 + 1442695040888963407
    result := result.push (((state >>> 56).toNat % alphabet).toUInt8)
  return result

private def repeatPattern (pattern : ByteArray) (size : Nat) : ByteArray := Id.run do
  if pattern.size == 0 then
    return ByteArray.empty
  let mut result := ByteArray.emptyWithCapacity size
  for i in [:size] do
    result := result.push pattern[i % pattern.size]!
  return result

private def concatenateBytes (parts : Array ByteArray) : ByteArray := Id.run do
  let capacity := parts.foldl (fun size part => size + part.size) 0
  let mut result := ByteArray.emptyWithCapacity capacity
  for part in parts do
    for byte in part.data do
      result := result.push byte
  return result

private def allLevels : Array Nat := (Array.range 11)
private def upperLevels : Array Nat := #[5, 6, 7, 8, 9, 10]

private def compressionCases : Array CompressionCase := #[
  { name := "empty", input := ByteArray.empty, levels := allLevels },
  { name := "one-zero", input := ByteArray.mk #[0], levels := allLevels },
  { name := "short-text", input := "Lean VIR zip acceptance".toUTF8, levels := allLevels },
  {
    name := "repeated-text"
    input := "abracadabra abracadabra abracadabra -- lean zip VIR fallback smoke -- abracadabra".toUTF8
    levels := allLevels
  },
  { name := "run-258", input := repeatByte 0x61 258, levels := allLevels },
  { name := "byte-cycle", input := byteCycle 256, levels := allLevels },
  { name := "noise-257", input := deterministicBytes 257 256, levels := allLevels },
  { name := "noise-4096", input := deterministicBytes 4096 256, levels := allLevels },
  { name := "prescan-noise", input := deterministicBytes prescanMinSize 256, levels := #[6] }
]

private def largeCompressionCases : Array CompressionCase := #[
  {
    name := "large-repeated-text"
    input := repeatPattern "Lean VIR makes verified compression portable. ".toUTF8 32768
    levels := upperLevels
  },
  {
    name := "large-heterogeneous"
    input := concatenateBytes #[
      deterministicBytes 16384 4,
      deterministicBytes 16384 16,
      deterministicBytes 16384 64,
      deterministicBytes 16384 200
    ]
    levels := upperLevels
  }
]

/- Restricting each PRNG byte modulo `alphabet` puts the theoretical 7.6-bit
threshold between 204 and 205 symbols; finite-region sampling moves the observed
decision boundary to 205/206 for this deterministic corpus. -/
private def prescanCases : Array PrescanCase := #[200, 203, 204, 205, 206, 207, 208, 224, 256].map fun alphabet => {
  name := s!"alphabet-{alphabet}"
  input := deterministicBytes prescanMinSize alphabet
}

private def writeCompressionCases
    (outputDir : System.FilePath) (kind : String) (cases : Array CompressionCase) : IO (Array String) := do
  let mut manifest := #[]
  for testCase in cases do
    let inputFile := s!"{testCase.name}.input.bin"
    IO.FS.writeBinFile (outputDir / inputFile) testCase.input
    for level in testCase.levels do
      let outputFile := s!"{testCase.name}.level-{level}.deflate.bin"
      let compressed := deflateRaw testCase.input level.toUInt8
      IO.FS.writeBinFile (outputDir / outputFile) compressed
      manifest := manifest.push s!"{kind}\t{testCase.name}\t{level}\t{inputFile}\t{outputFile}"
  return manifest

private def writePrescanCases (outputDir : System.FilePath) : IO (Array String) := do
  let mut manifest := #[]
  for testCase in prescanCases do
    let inputFile := s!"{testCase.name}.input.bin"
    IO.FS.writeBinFile (outputDir / inputFile) testCase.input
    let decision := incompressiblePrescan testCase.input
    manifest := manifest.push s!"prescan\t{testCase.name}\t{inputFile}\t{decision}"
  return manifest

def run (args : List String) : IO Unit := do
  let [outputDir] := args
    | throw <| IO.userError "usage: virLeanZipAcceptanceOracle <output-dir>"
  let outputDir : System.FilePath := outputDir
  let compressionManifest ← writeCompressionCases outputDir "compress" compressionCases
  let largeCompressionManifest ← writeCompressionCases outputDir "large-compress" largeCompressionCases
  let prescanManifest ← writePrescanCases outputDir
  IO.FS.writeFile (outputDir / "manifest.tsv") <|
    String.intercalate "\n"
      (compressionManifest ++ largeCompressionManifest ++ prescanManifest).toList ++ "\n"

end VirLeanZipAcceptance

def main (args : List String) : IO Unit :=
  VirLeanZipAcceptance.run args
