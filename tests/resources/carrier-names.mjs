// Actual named inclusion through ordinary library builds, not a second locator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";
import { replaceFixture } from "./fixture-edit.mjs";

mkdirSync(join(repositoryRoot, "build"), { recursive: true });
const evidence = mkdtempSync(join(repositoryRoot, "build/resource-module-names-"));
console.log(`module-name evidence: ${evidence}`);
for (const [index, [name, file]] of [
  ["Client.Program", "Client/Program.lean"],
  ["Client.«Program.with.dots»", "Client/Program.with.dots.lean"],
  ["Quoted.«component space».Leaf", "Quoted/component space/Leaf.lean"],
].entries()) {
  const client = join(evidence, String(index));
  cpSync(join(repositoryRoot, "fixtures/resources/client"), client, { recursive: true });
  cpSync(join(repositoryRoot, "lean-toolchain"), join(client, "lean-toolchain"));
  let config = replaceFixture(readFileSync(join(client, "lakefile.lean"), "utf8"),
    '"../../../.."', JSON.stringify(repositoryRoot));
  // Arbitrary library spelling no longer becomes a prepared filename or source key.
  config = replaceFixture(config, "ClientResources", "«Asset library space»", "all");
  let sourceRoot = client;
  if (index === 1) {
    config = replaceFixture(config, "package client_fixture where",
      'package client_fixture where\n  srcDir := "base source"');
    sourceRoot = join(client, "base source");
    mkdirSync(sourceRoot);
    for (const source of ["program", "resources", "Client.lean"])
      renameSync(join(client, source), join(sourceRoot, source));
  }
  const carrier = join(sourceRoot, "resources/Client/Resources.lean");
  if (name !== "Client.Program") {
    config = replaceFixture(config, "`Client.Program", `\`${name}`, "all");
    config = replaceFixture(config, "`+Client.Program:virResourcePack", `\`+${name}:virResourcePack`);
    const destination = join(sourceRoot, "program", file);
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(join(sourceRoot, "program/Client/Program.lean"), destination);
    writeFileSync(carrier, replaceFixture(readFileSync(carrier, "utf8"),
      "#[Client.Program]", `#[${name}]`));
  }
  writeFileSync(join(client, "lakefile.lean"), config);
  const stage = join(client, "build with spaces/lib/lean/vir-assets", file.replace(/\.lean$/, ".virres"));
  let previous;
  for (const phase of ["cold", "warm"]) {
    const result = spawnSync("lake", ["--dir", client, "build", "«Asset library space»"], {
      cwd: evidence, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024,
    });
    writeFileSync(join(client, `${phase}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${name}: ${result.stdout}${result.stderr}`);
    const bytes = readFileSync(stage);
    const stat = statSync(stage, { bigint: true });
    if (previous) {
      assert.deepEqual(bytes, previous.bytes);
      assert.equal(stat.ino, previous.stat.ino);
      assert.equal(stat.mtimeNs, previous.stat.mtimeNs);
    }
    previous = { bytes, stat };
  }
  const setup = join(client, "build with spaces/ir/Client/Resources.setup.json");
  const toolchain = readFileSync(join(client, "lean-toolchain"), "utf8").trim();
  const result = spawnSync("elan", ["run", toolchain, "lake", "--dir", client,
    "env", "lean", "--setup", setup, carrier], {
    cwd: "/tmp", encoding: "utf8", timeout: 180000,
  });
  writeFileSync(join(client, "actual-context-other-cwd.log"), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
console.log("module names: real includes, custom roots, quoted components, other cwd and unchanged warm inputs PASS");
