/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Zip.Native.DeflateDynamic
import Vir

namespace VirLeanZipAcceptance

vir_extern_fallback ByteArray.pushUInt64LE, ByteArray.ugetUInt32LE,
  ByteArray.ugetUInt64LE, UInt64.ctzFast, ByteArray.usetUInt64LE,
  ByteArray.usetUInt32LE, UInt32.log2Clz, UInt8.ofNatLT

@[vir_export]
def compressRaw (input : ByteArray) (level : UInt8) : ByteArray :=
  Zip.Native.Deflate.deflateRaw input level

@[vir_export]
def incompressiblePrescan (input : ByteArray) : Bool :=
  Zip.Native.Deflate.incompressiblePrescan input

@[vir_export]
def profileLevel5 (input : ByteArray) : ByteArray :=
  Zip.Native.Deflate.deflateRawL5Adaptive input

@[vir_export]
def profileLevel6 (input : ByteArray) : ByteArray :=
  Zip.Native.Deflate.deflateRawL6Adaptive input

@[vir_export]
def profileLevel7 (input : ByteArray) : ByteArray :=
  Zip.Native.Deflate.deflateRawL7P input (Zip.Native.Deflate.l7ProfileFor input)

@[vir_export]
def profileLevel8 (input : ByteArray) : ByteArray :=
  Zip.Native.Deflate.deflateRawL8P input

@[vir_export]
def profileLevel9 (input : ByteArray) : ByteArray :=
  Zip.Native.Deflate.deflateRawL9AdaptiveP input

@[vir_export]
def profileLevel10 (input : ByteArray) : ByteArray :=
  Zip.Native.Deflate.deflateRawL10P input

@[vir_export]
def profileMatchTokens (input : ByteArray) (level : UInt8) : ByteArray :=
  (Zip.Native.Deflate.lzMatchP input level).bytes

@[vir_export]
def profileBasePrepSize (input packedTokens : ByteArray) : Nat :=
  if h : packedTokens.size % 4 = 0 then
    (Zip.Native.Deflate.deflateRawBasePPrep input { bytes := packedTokens, aligned := h }).1
  else 0

@[vir_export]
def profileOptimalFast (input : ByteArray) : ByteArray :=
  Zip.Native.Deflate.deflateDynamicBlocksOptimalFast input Zip.Native.Deflate.sharedTokChunk

@[vir_export]
def profileOptimalExact (input : ByteArray) : ByteArray :=
  Zip.Native.Deflate.deflateDynamicBlocksOptimal input Zip.Native.Deflate.sharedTokChunk

end VirLeanZipAcceptance
