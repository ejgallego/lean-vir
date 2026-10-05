import Client
import Peer

-- Shared-consumer selection is explicit, not a rewrite of the singleton example.
def main (args : List String) : IO Unit := do
  let [output] := args | throw <| IO.userError "usage: generate-site OUTPUT"
  unless Client.resources.runtime.contentId == Peer.resources.runtime.contentId do
    throw <| IO.userError "intermediaries selected different runtimes"
  let resources : Vir.Resources.ResourceSet := {
    runtime := Client.resources.runtime
    programs := Client.resources.programs ++ Peer.resources.programs }
  let site ← IO.ofExcept <| (resources.forSite "").mapError reprStr
  for file in site.files do
    let path := System.FilePath.mk output / file.path
    IO.FS.createDirAll (path.parent.getD (System.FilePath.mk output))
    IO.FS.writeBinFile path file.bytes
  for bundle in #[resources.runtime] ++ resources.programs do
    IO.println s!"{bundle.descriptor.logicalId} {bundle.contentId}"
