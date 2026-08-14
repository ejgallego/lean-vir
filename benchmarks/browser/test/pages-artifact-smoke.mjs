import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fileRecord,
  verifyStagedArtifactSet,
} from "../scripts/artifact-set-lib.mjs";
import { parsePagesDeployment } from "../scripts/pages-deployment-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
let directory = resolve(appRoot, "dist");
const deployments = [];
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--directory") {
    const value = args[++index];
    if (!value) throw new Error("--directory requires a path");
    directory = resolve(appRoot, value);
  } else if (argument === "--deploy") {
    const value = args[++index];
    if (!value) throw new Error("--deploy requires EXAMPLE=VARIANT");
    deployments.push(parsePagesDeployment(value));
  } else if (argument === "--help" || argument === "-h") {
    console.log(`Usage: node test/pages-artifact-smoke.mjs \\
  [--directory PATH] --deploy EXAMPLE=VARIANT [...]

Validate a filtered static deployment and every admitted artifact payload.`);
    process.exit(0);
  } else throw new Error(`unknown argument: ${argument}`);
}
if (deployments.length === 0) {
  throw new Error("at least one --deploy selection is required");
}

async function json(path) {
  return JSON.parse(await readFile(resolve(directory, path), "utf8"));
}

async function requireFile(path) {
  assert.equal(
    (await stat(resolve(directory, path)).catch(() => null))?.isFile(),
    true,
    `Pages benchmark is missing ${path}`,
  );
}

async function childDirectories(path) {
  return (await readdir(resolve(directory, path), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

for (const path of [
  "index.html",
  "coi-serviceworker.js",
  "src/bootstrap.js",
  "src/artifact-status.js",
  "examples/catalog.json",
  "examples/controller-contract.mjs",
]) {
  await requireFile(path);
}

const catalog = await json("examples/catalog.json");
assert.equal(catalog.kind, "browser-benchmarks/example-catalog");
const expectedIds = deployments.map(({ example }) => example).sort();
assert.equal(new Set(expectedIds).size, expectedIds.length);
assert.deepEqual(catalog.examples.map(({ id }) => id).sort(), expectedIds);
assert.deepEqual(await childDirectories("examples"), expectedIds);
assert.deepEqual(await childDirectories("artifacts"), expectedIds);

for (const deployment of deployments) {
  const example = catalog.examples.find(({ id }) => id === deployment.example);
  assert.ok(example, `catalog omits ${deployment.example}`);
  await requireFile(example.controller);
  await requireFile(example.testPackage);
  const tests = await json(example.testPackage);
  assert.equal(tests.example, example.id);
  assert.deepEqual(
    tests.variants.map(({ id }) => id),
    [deployment.variant],
  );

  const artifactRoot = `artifacts/${example.id}`;
  const manifest = await verifyStagedArtifactSet(
    resolve(directory, artifactRoot),
  );
  assert.deepEqual(manifest.example, {
    id: example.id,
    variant: deployment.variant,
  });
  assert.equal(typeof manifest.setId, "string");
  assert.notEqual(manifest.setId.length, 0);
  assert.deepEqual(manifest.testPackage, {
    file: example.testPackage,
    ...(await fileRecord(resolve(directory, example.testPackage))),
  });
}

console.log(
  `PASS Pages benchmark artifact: ${directory} (${expectedIds.join(", ")})`,
);
