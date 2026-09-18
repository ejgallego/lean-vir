import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";
import { prepareVirIrpkgSync, resolveVirInputsSync } from "../../scripts/packages/irpkg-generator.mjs";

const modules = ["ModuleSetFixture.Root", "ModuleSetFixture.InputSelection"];
const generator = prepareVirIrpkgSync({ modules });
assert.ok(generator.ok);
mkdirSync(path.join(repositoryRoot, "build"), { recursive: true });
const evidence = mkdtempSync(path.join(repositoryRoot, "build/resolved-setups-"));
console.log(`resolved setup evidence: ${evidence}`);
const paths = generator.inputArgs.filter((_, index) => index % 2 === 1);

function generate(label, setups) {
  const file = path.join(evidence, `${label}.irpkg`);
  const result = spawnSync(generator.path, [file, `${file}.report.md`,
    ...setups.flatMap((file) => ["--setup", file]),
    "--target-marked-module", "ModuleSetFixture.InputSelection"], {
    cwd: repositoryRoot, env: generator.env, encoding: "utf8", timeout: 120_000,
  });
  writeFileSync(path.join(evidence, `${label}.log`),
    `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error ?? ""}`);
  assert.ifError(result.error);
  return { ...result, file };
}

const first = generate("forward", paths);
assert.equal(first.status, 0, first.stderr);
for (const [label, order] of [["reverse", [...paths].reverse()], ["repeated", [...paths, ...paths]]]) {
  const result = generate(label, order);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(result.file), readFileSync(first.file));
}

const setup = JSON.parse(readFileSync(paths[1], "utf8"));
const conflict = structuredClone(setup);
conflict.importArts["ModuleSetFixture.Root"][0][0] += ".different";
const conflicting = path.join(evidence, "conflict.setup.json");
writeFileSync(conflicting, JSON.stringify(conflict));
const rejected = generate("conflict", [paths[0], conflicting]);
assert.notEqual(rejected.status, 0);
assert.match(rejected.stderr, /conflicting resolved artifacts for module `ModuleSetFixture.Root`/);

// Conventional artifacts still exist, but an explicitly mapped missing part
// must fail rather than quietly substituting them.
const missing = structuredClone(setup);
const parts = missing.importArts["ModuleSetFixture.InputSelection"][0];
const privateIndex = parts.findIndex((file) => file.endsWith(".olean.private"));
assert.ok(privateIndex >= 0);
parts[privateIndex] += ".missing";
const missingPath = path.join(evidence, "missing.setup.json");
writeFileSync(missingPath, JSON.stringify(missing));
const unavailable = generate("missing", [missingPath]);
assert.notEqual(unavailable.status, 0);
assert.match(unavailable.stderr, /InputSelection\.olean\.private\.missing/);

const original = readFileSync(paths[0]);
const before = statSync(paths[0]).mtimeMs;
assert.ok(resolveVirInputsSync({ modules }).ok);
assert.equal(statSync(paths[0]).mtimeMs, before, "warm query rewrote unchanged setup");
writeFileSync(paths[0], "not a setup file\n");
assert.ok(resolveVirInputsSync({ modules }).ok);
assert.deepEqual(readFileSync(paths[0]), original, "query did not repair damaged setup");
console.log("resolved setup smoke ok: independent selection, stable bytes, conflict/missing-part rejection, repair");
