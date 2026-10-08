/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

import Lean.Data.Json.Printer
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
  let quote := Lean.Json.renderString
  "{\"module\":" ++ quote member.moduleName ++
  ",\"role\":" ++ quote member.role.label ++
  ",\"path\":" ++ quote member.path ++
  ",\"byteLength\":" ++ toString member.byteLength ++
  ",\"sha256\":" ++ quote member.sha256 ++ "}"

/-- Canonical generator field order and trailing newline. Used for both generated
sets and path-only adaptation; neither operation changes member bytes. -/
def encode (members : Array Member) : String :=
  "{\"format\":" ++ Lean.Json.renderString packageSetFormat ++
  ",\"version\":" ++ toString currentPackageSetVersion ++
  ",\"packages\":[" ++ String.intercalate "," (members.map encodeMember).toList ++ "]}\n"

end PackageSet
end Vir.GeneratePackage
