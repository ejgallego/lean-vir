/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Init

/-! Shared native byte digest, without host executables or FFI.
Algorithm: FIPS 180-4, sections 4.1.2, 4.2.2, 5.3.3 and 6.2.
https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf
This is not a signature/authentication mechanism or a validated cryptographic module.

Lake's builtin Lean hash suffices for non-cryptographic build traces. Published
package/resource inventories currently specify SHA-256 so native and browser
consumers must agree on that algorithm. This local implementation can be replaced
by an upstream digest API without changing those formats; weakening the published
digest would instead require an explicit format/consumer migration.
-/

namespace Vir

private def roundConstants : Array UInt32 := #[
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]

private def rotate (x n : UInt32) : UInt32 := (x >>> n) ||| (x <<< (32 - n))

private def compress (h : Array UInt32) (block : Nat → UInt8) : Array UInt32 := Id.run do
  let mut words := Array.replicate 64 (0 : UInt32)
  for i in [:16] do
    words := words.set! i <|
      (block (4*i)).toUInt32 <<< 24 ||| (block (4*i+1)).toUInt32 <<< 16 |||
      (block (4*i+2)).toUInt32 <<< 8 ||| (block (4*i+3)).toUInt32
  for i in [16:64] do
    let x := words[i-15]!
    let y := words[i-2]!
    let s0 := rotate x 7 ^^^ rotate x 18 ^^^ (x >>> 3)
    let s1 := rotate y 17 ^^^ rotate y 19 ^^^ (y >>> 10)
    words := words.set! i (words[i-16]! + s0 + words[i-7]! + s1)
  let mut a := h[0]!
  let mut b := h[1]!
  let mut c := h[2]!
  let mut d := h[3]!
  let mut e := h[4]!
  let mut f := h[5]!
  let mut g := h[6]!
  let mut v := h[7]!
  for i in [:64] do
    let sum1 := rotate e 6 ^^^ rotate e 11 ^^^ rotate e 25
    let choice := (e &&& f) ^^^ ((~~~e) &&& g)
    let t1 := v + sum1 + choice + roundConstants[i]! + words[i]!
    let sum0 := rotate a 2 ^^^ rotate a 13 ^^^ rotate a 22
    let majority := (a &&& b) ^^^ (a &&& c) ^^^ (b &&& c)
    v := g
    g := f
    f := e
    e := d + t1
    d := c
    c := b
    b := a
    a := t1 + sum0 + majority
  return #[h[0]! + a, h[1]! + b, h[2]! + c, h[3]! + d,
    h[4]! + e, h[5]! + f, h[6]! + g, h[7]! + v]

/-- Lowercase SHA-256. Reads each block without copying the complete input for padding. -/
public def sha256 (bytes : ByteArray) : String := Id.run do
  let size := bytes.size
  let paddedSize := (size + 9 + 63) / 64 * 64
  let bitLength := size.toUInt64 * 8
  let byteAt (i : Nat) : UInt8 :=
    if i < size then bytes[i]!
    else if i == size then 0x80
    else if i < paddedSize - 8 then 0
    else (bitLength >>> ((paddedSize - 1 - i) * 8).toUInt64).toUInt8
  let mut h : Array UInt32 := #[
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  for block in [:paddedSize / 64] do
    h := compress h (fun i => byteAt (block * 64 + i))
  let mut out := ""
  for word in h do
    for nibble in [:8] do
      let n := ((word >>> ((7 - nibble) * 4).toUInt32) &&& 15).toNat
      out := out.push (Char.ofNat (if n < 10 then 48 + n else 87 + n))
  return out

end Vir
