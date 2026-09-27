import Lake
open Lake DSL

-- Replaced only by the repository acceptance harness with its isolated provider.
require lean_vir from "../../../.."

package client_fixture where
  buildDir := "build with spaces"

lean_lib ClientProgram where
  srcDir := "program"
  roots := #[]
  globs := #[.one `Client.Program]

lean_lib ClientResources where
  srcDir := "resources"
  roots := #[]
  globs := #[.one `Client.Resources]
  needs := #[`@client_fixture/ClientResources:virResourcePack]

lean_lib Client where
  roots := #[]
  globs := #[.one `Client]
