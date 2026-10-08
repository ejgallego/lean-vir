/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Data.Name

public section

namespace Vir.HostMetadata

/-- The VIR attribute that selects a JavaScript host-import boundary. -/
public inductive HostImportMarker where
  | hostImport
  | explicitConversion
  deriving BEq, Repr

/-- The attribute name used to select a host-import boundary. -/
public def HostImportMarker.attributeName : HostImportMarker → Lean.Name
  | .hostImport => `vir_js
  | .explicitConversion => `vir_js_explicit_conversion

private def HostImportMarker.externPrefix : HostImportMarker → String
  | .hostImport => "__vir_js:"
  | .explicitConversion => "__vir_js_explicit_conversion:"

/-- Encode a JavaScript target as the extern symbol stored by a host-import attribute. -/
public def HostImportMarker.externSymbol (marker : HostImportMarker) (target : String) : String :=
  marker.externPrefix ++ target

/-- The host-import marker and JavaScript target decoded from an extern symbol. -/
public structure HostImportMetadata where
  marker : HostImportMarker
  target : String
  deriving BEq, Repr

private def targetWithPrefix? (pfx symbol : String) : Option String :=
  if symbol.startsWith pfx then
    some (symbol.drop pfx.length).toString
  else
    none

/-- Decode a VIR JavaScript host import from a Lean extern symbol. -/
public def decodeExternSymbol? (symbol : String) : Option HostImportMetadata :=
  if let some target := targetWithPrefix? HostImportMarker.hostImport.externPrefix symbol then
    some { marker := .hostImport, target }
  else if let some target :=
      targetWithPrefix? HostImportMarker.explicitConversion.externPrefix symbol then
    some { marker := .explicitConversion, target }
  else
    none

end Vir.HostMetadata
