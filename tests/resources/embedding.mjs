/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Isolated embedder test only: pack preparation here is deliberately explicit.
// It is not the cold three-package/automatic-acquisition acceptance fixture.
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync,
  truncateSync, symlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
mkdirSync(join(root, "build"), { recursive: true });
const project = mkdtempSync(join(root, "build/resource-embedding-"));
console.log(`embedding evidence: ${project}`);
function run(command, args, name, expected = 0, cwd = project, timeout = 180000) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout });
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
public import Vir.Resources.Embed
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
// Ordinary resource values must not pull in binary-literal transport, the
// inclusion elaborator or the pack parser. Only prepared carriers need those.
writeFileSync(join(project, "DataOnly.lean"), `module
import Vir.Resources.Types
meta import Lean.Elab.Command
run_cmd do
  let env ← Lean.getEnv
  for name in #[\`Vir.Resources.Bytes, \`Vir.BinaryLiteral,
      \`Vir.Resources.Embed, \`Vir.Resources.Pack] do
    if env.header.moduleNames.contains name then
      throwError "resource types imported embedding machinery: {name}"
`);
run(join(root, ".lake/build/bin/vir_resource_tests"), ["pack", join(project, "pack.virres")], "prepare");
run("lake", ["env", "lean", "DataOnly.lean"], "data-only-imports");
run("lake", ["build", "check"], "compile");
writeFileSync(join(project, "Phases.lean"), `module
import Carrier
meta import Lean.Elab.Command
run_cmd do
  let env ← Lean.getEnv
  for (name, allowed) in #[
      (\`Vir.Resources.Types, #[\`Init]),
      (\`Vir.BinaryLiteral, #[\`Init]),
      (\`Vir.Resources.Embed, #[\`Init, \`Vir.Resources.Types, \`Vir.BinaryLiteral])] do
    let some index := env.getModuleIdx? name | throwError "missing carrier dependency: {name}"
    let runtimeImports := (env.header.moduleData[index.toNat]!.imports.filter (!·.isMeta)).map (·.module)
    -- Lean records implicit Init as well as an explicit exported Init import.
    -- Check the exact admitted set without depending on duplicate entries/order.
    unless runtimeImports.all allowed.contains && allowed.all runtimeImports.contains do
      throwError "unexpected ordinary imports for {name}: {runtimeImports}"
`);
run("lake", ["env", "lean", "Phases.lean"], "carrier-import-phases");
const expected = "a9fbcfec93dbdd836248902deeb6b4fb7b4fe83f64ce9983104c0a945f6811e5";
// The library key is literal, not a Lean constant or the current module name.
// Both include forms use the same prepared bytes and embedding operation.
mkdirSync(join(project, ".vir-generated"));
for (const key of ["CarrierResources", "Carrier.Library", "«Library key»"]) {
  writeFileSync(join(project, `.vir-generated/${key}.virres`),
    readFileSync(join(project, "pack.virres")));
  writeFileSync(join(project, "KeyCarrier.lean"), `module
public import Vir.Resources.Embed
public def keyed : Vir.Resources.Bundle := include_vir_library ${key}
#eval IO.println keyed.contentId
`);
  assert.match(run("lake", ["env", "lean", "KeyCarrier.lean"],
    `library-key-${key}`), new RegExp(expected));
}
writeFileSync(join(project, "MissingCarrier.lean"), `module
import Vir.Resources.Embed
def missing : Vir.Resources.Bundle := include_vir_library MissingResources
`);
assert.match(run("lake", ["env", "lean", "MissingCarrier.lean"],
  "missing-library-preparation", 1), /VIR_RESOURCE_NOT_PREPARED.*MissingResources/s);
const setup = JSON.parse(readFileSync(join(project,
  "compiled output/ir/Carrier.setup.json")));
assert.equal(setup.name, "Carrier");
writeFileSync(join(project, "wrong-module.setup.json"),
  JSON.stringify({ ...setup, name: "Wrong.KeyCarrier" }));
assert.match(run("lake", ["env", "lean", "--setup", "wrong-module.setup.json",
  "KeyCarrier.lean"], "same-basename-wrong-module", 1), /CARRIER_SUFFIX_MISMATCH/);
writeFileSync(join(project, "key-module.setup.json"),
  JSON.stringify({ ...setup, name: "KeyCarrier" }));
// Raw Lean invoked elsewhere cannot infer this owning module from its cwd.
// Supply the authoritative setup, as ordinary Lake module builds do.
assert.match(run("elan", ["run",
  readFileSync(join(root, "lean-toolchain"), "utf8").trim(),
  "lake", "--dir", project, "env", "lean", "--setup",
  join(project, "key-module.setup.json"), join(project, "KeyCarrier.lean")],
  "library-key-other-cwd", 0, "/tmp"), new RegExp(expected));
const executable = join(project, "compiled output/bin/check");
assert.equal(run(executable, [], "native").trim(), expected);
renameSync(join(project, "pack.virres"), join(project, "pack.retained"));
// Run elsewhere with the raw input missing; preserve the native library closure.
assert.equal(run(executable, [], "without-pack", 0, "/tmp").trim(), expected);
assert.equal(run("lake", ["env", "lean", "--run", "Main.lean"], "interpreted-without-pack").trim(), expected);
// Each negative elaborates the actual macro, not just the shared reader. Sparse
// oversize and finite nonregular/link inputs safely exercise the admission limit.
const oversized = join(project, "oversized.virres");
writeFileSync(oversized, "");
truncateSync(oversized, 516 * 1024 * 1024 + 13);
mkdirSync(join(project, "directory.virres"));
const corrupted = Buffer.from(readFileSync(join(project, "pack.retained")));
corrupted[corrupted.length - 1] ^= 1;
writeFileSync(join(project, "corrupt.virres"), corrupted);
symlinkSync(join(project, "pack.retained"), join(project, "linked.virres"));
mkdirSync(join(project, "outside"));
writeFileSync(join(project, "outside", "pack.virres"), readFileSync(join(project, "pack.retained")));
symlinkSync(join(project, "outside"), join(project, "linked-parent"));
const fifo = spawnSync("mkfifo", [join(project, "pipe.virres")], { encoding: "utf8" });
assert.ifError(fifo.error);
assert.equal(fifo.status, 0, fifo.stderr);
for (const path of ["linked.virres", "linked-parent/pack.virres"]) {
  writeFileSync(join(project, "InputAlias.lean"), `module
import Vir.Resources.Embed
def aliased : Vir.Resources.Bundle := include_vir_bundle ${JSON.stringify(path)}
#eval IO.println ((aliased.file? "runtime.js").map (·.bytes) == some "abc".toUTF8)
`);
  assert.match(run("lake", ["env", "lean", "InputAlias.lean"],
    `input-alias-${path.includes("/") ? "parent" : "file"}`), /true/);
}
for (const [label, path, error] of [
  ["oversize", "oversized.virres", /PACK_LIMIT/],
  ["directory", "directory.virres", /UNSAFE_RESOURCE_FILE/],
  ["fifo", "pipe.virres", /UNSAFE_RESOURCE_FILE/],
  ["corrupt", "corrupt.virres", /invalid resource pack.*HASH_MISMATCH/s],
]) {
  writeFileSync(join(project, "Rejected.lean"), `module
import Vir.Resources.Embed
def rejected : Vir.Resources.Bundle := include_vir_bundle ${JSON.stringify(path)}
`);
  const output = run("lake", ["env", "lean", join(project, "Rejected.lean")], `reject-${label}`, 1, project, 10000);
  assert.match(output, error, label);
}
console.log("embedding: native and interpreted consumers retain bytes without the source pack");
