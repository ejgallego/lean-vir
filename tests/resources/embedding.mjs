/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Isolated embedder test only: pack preparation here is deliberately explicit.
// It is not the cold three-package/automatic-acquisition acceptance fixture.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
mkdirSync(join(root, "build"), { recursive: true });
const project = mkdtempSync(join(root, "build/resource-embedding-"));
console.log(`embedding evidence: ${project}`);
function run(command, args, name, expected = 0, cwd = project) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 180000 });
  writeFileSync(join(project, `${name}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `${name}: ${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
writeFileSync(join(project, "lean-toolchain"), readFileSync(join(root, "lean-toolchain")));
writeFileSync(join(project, "lakefile.toml"), `name = "resource_embedding"
buildDir = "compiled output"
[[require]]
name = "lean_vir"
path = ${JSON.stringify(root)}
[[lean_lib]]
name = "Carrier"
[[lean_exe]]
name = "check"
root = "Main"
`);
writeFileSync(join(project, "Carrier.lean"), `module
public import Vir.Resources.Types
meta import Vir.Resources.Embed
public def carried : Vir.Resources.Bundle := include_vir_bundle "pack.virres"
`);
writeFileSync(join(project, "Main.lean"), `import Carrier
import Vir.Resources
def main : IO Unit := do
  match carried.validate with
  | .error e => throw <| IO.userError (reprStr e)
  | .ok _ => pure ()
  unless (carried.file? "runtime.js").map (·.bytes) == some "abc".toUTF8 do
    throw <| IO.userError "embedded bytes differ"
  IO.println carried.contentId
`);
run(join(root, ".lake/build/bin/vir_resource_tests"), ["pack", join(project, "pack.virres")], "prepare");
run("lake", ["build", "check"], "compile");
const expected = "31aa0de3db1b738af032d0a1c98074426f9b0cad7657d79035c62284d87c2d8e";
const executable = join(project, "compiled output/bin/check");
assert.equal(run(executable, [], "native").trim(), expected);
renameSync(join(project, "pack.virres"), join(project, "pack.retained"));
// Run elsewhere with the raw input missing; preserve the native library closure.
assert.equal(run(executable, [], "without-pack", 0, "/tmp").trim(), expected);
assert.equal(run("lake", ["env", "lean", "--run", "Main.lean"], "interpreted-without-pack").trim(), expected);
console.log("embedding: native and interpreted consumers retain bytes without the source pack");
