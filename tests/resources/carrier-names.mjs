// Exercise real Lake library names, not an independent filename predicate.
import assert from "node:assert/strict";
import { replaceFixture } from "./fixture-edit.mjs";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";

const evidence = mkdtempSync(
  join(repositoryRoot, "build/resource-carrier-names-"),
);
console.log(`carrier-name evidence: ${evidence}`);
// Optional module/path pairs exercise semantic components through the real
// include macro, including quoted dots/spaces, not a second source-root locator.
for (const [index, [name, stem,
  carrierModule = "Client.Resources", carrierFile = "Client/Resources.lean"]] of [
  ["«Client-Resources»", "«Client-Resources»"],
  ["Client.Resources", "Client.Resources",
    "Quoted.«component.with.dots».Leaf", "Quoted/component.with.dots/Leaf.lean"],
  ["ClientRessourcesÉ", "ClientRessourcesÉ"],
  ["«Library space»", "«Library space»",
    "Quoted.«component space».Leaf", "Quoted/component space/Leaf.lean"],
  ["VersoSlidesVirPrettyMResources", "VersoSlidesVirPrettyMResources",
    "VersoSlides.VirPrettyMResources", "VersoSlides/VirPrettyMResources.lean"],
  ["«Client\\Resources»", null],
].entries()) {
  const client = join(evidence, String(index));
  cpSync(join(repositoryRoot, "fixtures/resources/client"), client, {
    recursive: true,
  });
  cpSync(join(repositoryRoot, "lean-toolchain"), join(client, "lean-toolchain"));
  const configPath = join(client, "lakefile.lean");
  const providerConfig = replaceFixture(readFileSync(configPath, "utf8"),
    '"../../../.."', JSON.stringify(repositoryRoot));
  let config = replaceFixture(providerConfig,
    "ClientResources", name, "all");
  let sourceRoot = client;
  if (index === 1) {
    // Compose package and library source roots; registration remains package-local.
    config = replaceFixture(config, "package client_fixture where",
      'package client_fixture where\n  srcDir := "base source"');
    sourceRoot = join(client, "base source");
    mkdirSync(sourceRoot);
    for (const source of ["program", "resources", "Client.lean"])
      renameSync(join(client, source), join(sourceRoot, source));
  }
  let carrierPath = join(sourceRoot, "resources/Client/Resources.lean");
  if (index === 1) {
    // A quoted dot is one module component in the stock Name registration,
    // native root adapter and generated package ownership, not dot splitting.
    config = replaceFixture(config, "`Client.Program", "`Client.«Program.with.dots»", "all");
    renameSync(join(sourceRoot, "program/Client/Program.lean"),
      join(sourceRoot, "program/Client/Program.with.dots.lean"));
  }
  if (carrierModule !== "Client.Resources") {
    config = replaceFixture(config, ".one `Client.Resources",
      `.one \`${carrierModule}`);
    const destination = join(sourceRoot, "resources", carrierFile);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, replaceFixture(readFileSync(carrierPath, "utf8"),
      "Client.Resources", carrierModule));
    carrierPath = destination;
  }
  writeFileSync(configPath, config);
  writeFileSync(carrierPath, replaceFixture(readFileSync(carrierPath, "utf8"),
    "include_vir_library ClientResources", `include_vir_library ${name}`));
  let previous;
  for (const phase of ["cold", "warm"]) {
    const result = spawnSync("elan", ["run",
      readFileSync(join(repositoryRoot, "lean-toolchain"), "utf8").trim(),
      "lake", "--dir", client, "build", name], {
      cwd: evidence,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    writeFileSync(join(client, `${phase}.log`), log);
    assert.ifError(result.error);
    if (!stem) {
      assert.notEqual(result.status, 0, log);
      assert.match(log, /library name usable as one filename/);
      break;
    }
    assert.equal(result.status, 0, `${name} ${phase}: ${log}`);
    const stage = join(sourceRoot, `resources/.vir-generated/${stem}.virres`);
    const bytes = readFileSync(stage);
    const stat = statSync(stage, { bigint: true });
    if (previous) {
      assert.deepEqual(bytes, previous.bytes);
      assert.equal(stat.ino, previous.stat.ino);
      assert.equal(stat.mtimeNs, previous.stat.mtimeNs);
    }
    previous = { bytes, stat };
  }
}
console.log("carrier names: real includes with quoted module components and library names; warm staging unchanged");
