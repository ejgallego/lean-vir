/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

namespace Vir.GeneratePackage

def currentPackageFormatVersion : Nat := 10

def currentInterfaceManifestVersion : Nat := 6

def packageSectionDeclarations : Nat := 1
def packageSectionInitGlobals : Nat := 2
def packageSectionHostImports : Nat := 3
def packageSectionExportSummaries : Nat := 4
def packageSectionInterfaceManifest : Nat := 5

end Vir.GeneratePackage
