/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

import Vir.Package.Json
public import Vir.Package.Format

public section
namespace Vir.GeneratePackage

inductive PackageSetMemberRole where
  | dependency
  | root

def PackageSetMemberRole.label : PackageSetMemberRole → String
  | .dependency => "dependency"
  | .root => "root"

namespace PackageSet

/-- Emission metadata shared by package-set adapters; paths are relative to the
descriptor. Construct lengths and digests from emitted bytes, not caller guesses. -/
structure Member where
  moduleName : String
  role : PackageSetMemberRole
  path : String
  byteLength : Nat
  sha256 : String

private def encodeMember (member : Member) : String :=
  jsonObject #[
    ("module", jsonString member.moduleName),
    ("role", jsonString member.role.label),
    ("path", jsonString member.path),
    ("byteLength", jsonNat member.byteLength),
    ("sha256", jsonString member.sha256)]

/-- Canonical generator field order and trailing newline. Used for both generated
sets and path-only adaptation; neither operation changes member bytes. -/
def encode (members : Array Member) : String :=
  jsonObject #[
    ("format", jsonString packageSetFormat),
    ("version", jsonNat currentPackageSetVersion),
    ("packages", jsonArray (members.map encodeMember))] ++ "\n"

end PackageSet
end Vir.GeneratePackage
