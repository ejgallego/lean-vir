import Lean.Data.Json.Basic
import Vir.Resources
import QuickstartApp.Resources

def main (args : List String) : IO Unit := do
  let [output] := args | throw <| IO.userError "usage: publish OUTPUT_DIRECTORY"
  let directory := System.FilePath.mk output
  let site ← IO.ofExcept <| (QuickstartApp.Resources.resources.forSite "lib/vir").mapError reprStr
  for file in site.files do
    let path := directory / file.path
    IO.FS.createDirAll (path.parent.getD directory)
    IO.FS.writeBinFile path file.bytes
  let config := Lean.Json.mkObj [
    ("runtimeModule", Lean.toJson site.runtimeModule),
    ("runtimeManifest", Lean.toJson site.runtimeManifest),
    ("programManifest", Lean.toJson site.programManifests[0]!) ]
  IO.FS.writeFile (directory / "app.json") config.compress
  for (name, contents) in #[("index.html", include_str "web/index.html"),
      ("main.js", include_str "web/main.js")] do
    IO.FS.writeFile (directory / name) contents
  IO.println s!"Published {directory}"
