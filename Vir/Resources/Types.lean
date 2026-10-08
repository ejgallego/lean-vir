/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Init

/-! Portable, complete resource values. No acquisition or elaboration dependencies. -/

public section
namespace Vir.Resources

inductive BundleKind where
  | runtime
  | program
  deriving BEq, Repr, Inhabited

/-- Exact compatibility, deliberately independent of a runtime bundle's content identity. -/
structure Compatibility where
  /-- Lean source revision reported by `Lean.githash`, not a compiler-binary hash. -/
  leanRevision : String
  /-- Combined VIR client/runtime/program compatibility contract. -/
  virVersion : Nat
  deriving BEq, Repr, Inhabited

structure File where
  path : String
  bytes : ByteArray
  deriving Inhabited

structure FileInfo where
  path : String
  mediaType : String
  byteLength : Nat
  sha256 : String
  deriving BEq, Repr, Inhabited

structure FileEntry where
  role : String
  path : String
  deriving BEq, Repr, Inhabited

structure Descriptor where
  schemaVersion : Nat
  logicalId : String
  kind : BundleKind
  compatibility : Compatibility
  files : Array FileInfo
  fileEntries : Array FileEntry
  deriving BEq, Repr, Inhabited

/-- An owned inventory of bytes, never deferred filesystem lookups. -/
structure Bundle where
  contentId : String
  descriptor : Descriptor
  files : Array File
  deriving Inhabited

structure ResourceSet where
  runtime : Bundle
  programs : Array Bundle

/-- Stable machine-readable code with contextual diagnostics. Empty optional
fields mean that the corresponding concept does not apply to this failure. -/
structure ResourceError where
  code : String
  logicalId : String := ""
  role : Option String := none
  path : Option String := none
  expected : Option String := none
  actual : Option String := none
  deriving BEq, Repr, Inhabited

def Bundle.file? (bundle : Bundle) (path : String) : Option File :=
  bundle.files.find? (·.path == path)

def Bundle.entryPath? (bundle : Bundle) (role : String) : Option String :=
  (bundle.descriptor.fileEntries.find? (·.role == role)).map (·.path)

end Vir.Resources
