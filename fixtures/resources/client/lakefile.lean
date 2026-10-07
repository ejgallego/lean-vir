import Lake
open Lake DSL

-- Replaced only by the repository acceptance harness with its isolated provider.
require lean_vir from "../../../.."

package client_fixture where
  buildDir := "build with spaces"

lean_lib ClientProgram where
  srcDir := "program"
  roots := #[]
  globs := #[.one `Client.Program, .one `Client.Helper, .one `Client.Alternative]

lean_lib ClientResources where
  srcDir := "resources"
  roots := #[]
  globs := #[.one `Client.Resources]
  needs := #[`@client_fixture/ClientResources:virResourcePack]

target virPrograms (_pkg) : Array (Lean.Name × Lean.Name) := do
  return Job.pure #[(`ClientResources, `Client.Program)]

lean_lib Client where
  roots := #[]
  globs := #[.one `Client]
