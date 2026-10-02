import Client

def main (args : List String) : IO Unit := do
  let [output] := args | throw <| IO.userError "usage: generate-site OUTPUT"
  let site ← IO.ofExcept <| (Client.resources.forSite "").mapError reprStr
  for file in site.files do
    let path := System.FilePath.mk output / file.path
    IO.FS.createDirAll (path.parent.getD (System.FilePath.mk output))
    IO.FS.writeBinFile path file.bytes
  for bundle in #[Client.resources.runtime] ++ Client.resources.programs do
    IO.println s!"{bundle.descriptor.logicalId} {bundle.contentId}"
