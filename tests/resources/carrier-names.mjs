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
import { join } from "node:path";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";

const evidence = mkdtempSync(
  join(repositoryRoot, "build/resource-carrier-names-"),
);
console.log(`carrier-name evidence: ${evidence}`);
for (const [index, [name, stem]] of [
  ["«Client-Resources»", "«Client-Resources»"],
  ["Client.Resources", "Client.Resources"],
  ["ClientRessourcesÉ", "ClientRessourcesÉ"],
  ["«Library space»", "«Library space»"],
  ["VersoSlidesVirPrettyMResources", "VersoSlidesVirPrettyMResources"],
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
    // Compose package and library source roots; leave recipes package-relative.
    config = replaceFixture(config, "package client_fixture where",
      'package client_fixture where\n  srcDir := "base source"');
    sourceRoot = join(client, "base source");
    mkdirSync(sourceRoot);
    for (const source of ["program", "resources", "Client.lean"])
      renameSync(join(client, source), join(sourceRoot, source));
  }
  let carrierPath = join(sourceRoot, "resources/Client/Resources.lean");
  if (name === "VersoSlidesVirPrettyMResources") {
    config = replaceFixture(config, ".one `Client.Resources",
      ".one `VersoSlides.VirPrettyMResources");
    const migrated = join(sourceRoot, "resources/VersoSlides");
    mkdirSync(migrated);
    const destination = join(migrated, "VirPrettyMResources.lean");
    writeFileSync(destination, replaceFixture(readFileSync(carrierPath, "utf8"),
      "Client.Resources", "VersoSlides.VirPrettyMResources"));
    carrierPath = destination;
  }
  writeFileSync(configPath, config);
  writeFileSync(carrierPath, replaceFixture(readFileSync(carrierPath, "utf8"),
    "include_vir_library ClientResources", `include_vir_library ${name}`));
  const recipe = readFileSync(join(client, "vir-resources/ClientResources.json"));
  if (stem) writeFileSync(join(client, `vir-resources/${stem}.json`), recipe);
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
console.log("carrier names: hyphen, dotted and Unicode library facets; warm staging unchanged");
