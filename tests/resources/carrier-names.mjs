// Exercise real Lake library names, not an independent filename predicate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
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
  ["«Client\\Resources»", null],
].entries()) {
  const client = join(evidence, String(index));
  cpSync(join(repositoryRoot, "fixtures/resources/client"), client, {
    recursive: true,
  });
  cpSync(join(repositoryRoot, "lean-toolchain"), join(client, "lean-toolchain"));
  const configPath = join(client, "lakefile.lean");
  const config = readFileSync(configPath, "utf8")
    .replace('"../../../.."', JSON.stringify(repositoryRoot))
    .replace("lean_lib ClientResources where", `lean_lib ${name} where`)
    .replace("  needs := #[`@client_fixture/ClientResources:virResourcePack]\n", "");
  writeFileSync(configPath, config);
  const recipe = readFileSync(join(client, "vir-resources/ClientResources.json"));
  if (stem) writeFileSync(join(client, `vir-resources/${stem}.json`), recipe);
  let previous;
  for (const phase of ["cold", "warm"]) {
    const result = spawnSync("lake", ["build", `${name}:virResourcePack`], {
      cwd: client,
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
    const stage = join(client, `.vir-generated/${stem}.virres`);
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
