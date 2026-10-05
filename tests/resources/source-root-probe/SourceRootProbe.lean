module
public meta import Lean

open Lean Elab Term

meta section

-- Test-local diagnostic, not a production locator. Strip the complete canonical
-- module suffix; never search ancestors or infer a root from the basename.
elab "source_root_probe " key:ident : term => do
  let source := System.FilePath.mk (← readThe Lean.Core.Context).fileName
  let mod := (← getEnv).mainModule
  -- FilePath.join does not treat an empty base as a relative identity. Use an
  -- ordinary relative base and remove only its known initial component.
  let suffix := Lean.modToFilePath "." mod "lean"
  let suffixComponents := suffix.components.drop 1
  let components := source.normalize.components
  unless components.drop (components.length - suffixComponents.length) == suffixComponents do
    throwError "CARRIER_SUFFIX_MISMATCH: {source} does not end with {suffix}"
  let mut root := source
  for _ in [:suffixComponents.length] do
    let some parent := root.parent
      | throwError "CARRIER_SUFFIX_MISMATCH: no parent for {root}"
    root := parent
  let canonicalRoot ← IO.FS.realPath root
  let source ← IO.FS.realPath source
  IO.println <| "CARRIER_ROOT_PROBE " ++ (Json.mkObj [
    ("module", toJson mod.toString),
    ("key", toJson key.getId.toString),
    ("source", toJson source.toString),
    ("root", toJson canonicalRoot.toString),
    ("stage", toJson (canonicalRoot / ".vir-generated" / s!"{key.getId}.virres").toString)
  ]).compress
  return toExpr true

end
