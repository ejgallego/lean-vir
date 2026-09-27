import Client

def main (args : List String) : IO Unit := do
  let [output] := args | throw <| IO.userError "usage: generate-site OUTPUT"
  let bundles ← IO.ofExcept <| Client.resources.bundles.mapError reprStr
  for bundle in bundles do
    let directory := System.FilePath.mk output / bundle.contentId
    IO.FS.createDirAll directory
    let manifest := "{\"contentId\":\"" ++ bundle.contentId ++ "\",\"descriptor\":" ++
      String.fromUTF8! (Vir.Resources.encodeDescriptor bundle.descriptor) ++ "}"
    IO.FS.writeFile (directory / "bundle.json") manifest
    for file in bundle.files do
      let path := directory / file.path
      IO.FS.createDirAll (path.parent.getD directory)
      IO.FS.writeBinFile path file.bytes
    IO.println s!"{bundle.descriptor.logicalId} {bundle.contentId}"
