import Lake

open Lake DSL

package client_native_fixture

require lean_vir from "../.."

@[default_target]
lean_lib ClientNativeFixture
