/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public section

namespace Vir.GeneratePackage

def packageMagic : String := "lean-vir-ir-package"

def currentPackageFormatVersion : Nat := 11

def currentInterfaceManifestVersion : Nat := 9

/-- Native SDK and resource producers share these runtime contract versions. -/
def currentRuntimeAbiVersion : Nat := 4

/-- Resource contract covering the client API, runtime ABI and accepted program formats.
Advance on a breaking change to any constituent contract; not an alias for runtime ABI. -/
def currentVirCompatibilityVersion : Nat := 3

def packageSetFormat : String := "lean-vir-ir-package-set"

def currentPackageSetVersion : Nat := 2

def packageSectionDeclarations : Nat := 1
def packageSectionInitGlobals : Nat := 2
def packageSectionHostImports : Nat := 3
def packageSectionExportSummaries : Nat := 4
def packageSectionInterfaceManifest : Nat := 5

end Vir.GeneratePackage
