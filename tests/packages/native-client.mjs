/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { interfaceSignatureKey } from "../../web/src/runtime/interface-manifest.js";
import { snapshotExpectedExports, resolveProgramExports } from "../../web/src/resources/program-exports.js";
import { readIrPackageInfo } from "../../web/src/runtime/ir-package.js";
import {
  arrayBoundary,
  immediateConstructor,
  nativeField,
  objectBoundary,
  objectConstructor,
  primitiveBoundary,
  unitBoundary,
} from "../support/interface-fixtures.mjs";

// Independent producer and cold native-precompiled consumer: a developer's
// dependency cache could conceal accidental umbrella imports. Retain evidence.
const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = mkdtempSync(join(tmpdir(), "vir-native-client-"));
const producer = join(evidence, "producer");
const client = join(evidence, "client");
mkdirSync(producer);
for (const path of ["Vir", "Vir.lean", "tools", "lakefile.lean", "lake-manifest.json",
    "lean-toolchain", "vir-resources"]) {
  cpSync(join(root, path), join(producer, path), { recursive: true });
}
mkdirSync(client);
for (const path of ["lakefile.lean", "NativeClient.lean", "GeneratorClient.lean", "Main.lean"]) {
  cpSync(join(root, "fixtures/native-client", path), join(client, path));
}
cpSync(join(root, "lean-toolchain"), join(client, "lean-toolchain"));
const lakefile = join(client, "lakefile.lean");
writeFileSync(lakefile, readFileSync(lakefile, "utf8").replace('"../.."', '"../producer"'));
console.log(`native client evidence: ${evidence}`);

function run(args, name, expectedStatus = 0) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: client, encoding: "utf8", timeout: 300000, maxBuffer: 8 * 1024 * 1024,
  });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(evidence, name + ".log"), output);
  assert.ifError(result.error);
  assert.equal(result.status, expectedStatus, `${name} failed; evidence: ${evidence}\n${output.slice(-6000)}`);
  return result.stdout;
}
run(["lake", "--no-cache", "build"], "cold-build");
// The compiler API exposes interface methods, not package JSON helpers.
const visibility = join(client, "CodecVisibility.lean");
writeFileSync(visibility, "module\npublic meta import Vir.Compiler.Interface.Encode\n" +
  "#check Vir.GeneratePackage.jsonString\n");
assert.match(run(["lake", "env", "lean", visibility], "codec-private-json", 1),
  /error\(lean.unknownIdentifier\): Unknown identifier.*Vir\.GeneratePackage\.jsonString/);
writeFileSync(visibility, "module\npublic meta import Vir.Compiler.Interface.Encode\n" +
  "public meta import Vir.Package.Json\n#check Vir.GeneratePackage.jsonString\n");
run(["lake", "env", "lean", visibility], "codec-explicit-json");
// Check the public surface independently: expected failures must not mask it.
const classifierVisibility = join(client, "ClassifierVisibility.lean");
const classifierImport = "module\npublic meta import Vir.Compiler.Interface.Classify.Signature\n";
writeFileSync(classifierVisibility, classifierImport +
  "#check Vir.Interface.interfaceType\n#check Vir.Interface.analyzeExportInterface\n" +
  "#check Vir.Interface.classifyExportSignature\n#check Vir.Interface.classifyHostImportSignature\n");
run(["lake", "env", "lean", classifierVisibility], "classifier-public-api");
const privateTraversalHelpers = ["RecursiveSeen", "recursiveVisit", "functionType", "inductiveType",
  "structureType", "classifyType"];
const nonReexportedReductionHelpers = ["reduceTypeAliases", "effectResult?"];
const hiddenFromSignature = [...privateTraversalHelpers, ...nonReexportedReductionHelpers];
writeFileSync(classifierVisibility, classifierImport + hiddenFromSignature.map(
  (name) => `#check Vir.Interface.${name}\n`).join(""));
const classifierVisibilityOutput = run(["lake", "env", "lean", classifierVisibility], "classifier-hidden-helpers", 1);
for (const name of hiddenFromSignature) {
  assert.ok(classifierVisibilityOutput.includes(`Unknown identifier \`Vir.Interface.${name}\``),
    `classifier helper ${name} must not be exposed by Signature`);
}
// Reduction is a low-level module, not private declarations in Core.
writeFileSync(classifierVisibility, "module\npublic meta import Vir.Compiler.Interface.Classify.Reduce\n" +
  nonReexportedReductionHelpers.map((name) => `#check Vir.Interface.${name}\n`).join(""));
run(["lake", "env", "lean", classifierVisibility], "classifier-direct-reduction-import");
const modules = ["Vir", ...readdirSync(join(producer, "Vir"), { recursive: true })
  .filter((path) => path.endsWith(".lean"))
  .map((path) => "Vir." + path.slice(0, -5).replaceAll("/", ".").replaceAll("\\", "."))];
run(["lake", "run", "checkOwners", ...modules], "module-owners");
const output = run([join(client, ".lake/build/bin/native_client")], "native-output");
const lines = output.trim().split("\n");
assert.equal(lines.length, 9);
const [greeting, numeric, descriptorText, greetingSignature, numericSignature,
  nullarySignature, multipleSignature, effectfulSignature, nestedSignature] = lines;
assert.equal(greeting, "Hello, native 🌍");
assert.equal(numeric, "18014398509481986");
const descriptor = JSON.parse(descriptorText);
assert.equal(descriptor.logicalId, "native-client/encoder");
assert.equal(descriptor.schemaVersion, 2);
assert.ok(!Object.hasOwn(descriptor, "exports"));
assert.deepEqual(descriptor.compatibility,
  JSON.parse(readFileSync(join(producer, "vir-resources/compatibility.json"))));
const expectedExports = {
  "NativeClient.greet": JSON.parse(greetingSignature),
  "NativeClient.double": JSON.parse(numericSignature),
  "NativeClient.nullary": JSON.parse(nullarySignature),
  "NativeClient.multiple": JSON.parse(multipleSignature),
  "NativeClient.effectful": JSON.parse(effectfulSignature),
  "NativeClient.nested": JSON.parse(nestedSignature),
};
const signatures = snapshotExpectedExports(expectedExports);
for (const [declaration, expectedType] of [
  ["NativeClient.greet", primitiveBoundary("string", "string")],
  ["NativeClient.double", primitiveBoundary("nat", "bigint")],
]) {
  assert.deepEqual(expectedExports[declaration].args, [expectedType],
    "caller arguments contain types only, without parameter display names");
  assert.equal(signatures.get(declaration),
    interfaceSignatureKey({ args: [expectedType], result: expectedType, effect: "pure" }));
}

const nat = primitiveBoundary("nat", "bigint");
const string = primitiveBoundary("string", "string");
const unit = unitBoundary();
const option = objectBoundary("Option", [
  immediateConstructor("Option.none"),
  objectConstructor("Option.some", {
    objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0,
  }, [nativeField("val", nat.native, { tag: "object", index: 0 })]),
], { tag: "variant", cases: [
  { kind: "none", payload: "none" },
  { kind: "some", payload: "value", value: nat.value },
] });
const nested = arrayBoundary(option.native, option.value);
for (const [declaration, args, result, effect] of [
  ["NativeClient.nullary", [], unit, "pure"],
  ["NativeClient.multiple", [string, nat], nat, "pure"],
  ["NativeClient.effectful", [], unit, "io"],
  ["NativeClient.nested", [nested], nested, "pure"],
]) {
  assert.deepEqual(expectedExports[declaration], { args, result, effect });
}

// Use Lake's returned executable, not a reconstructed dependency build path.
run(["lake", "--no-cache", "build", "GeneratorClient"], "generator-meta-client");
const generatorSetup = JSON.parse(readFileSync(
  join(client, ".lake/build/ir/GeneratorClient.setup.json"), "utf8"));
assert.ok(generatorSetup.dynlibs.every((path) => !/VirResource(Core|Embed|Runtime)/.test(path)),
  "native generation must not load resource preparation or carriers");
const generator = run(["lake", "query", "@lean_vir/vir_irpkg"], "generator-build").trim();
run(["lake", "env", generator, join(evidence, "client.irpkg"), join(evidence, "report.md"),
  "--target-marked-module", "NativeClient"], "generator-run");
assert.ok(readFileSync(join(evidence, "client.irpkg")).length > 0);
const report = readFileSync(join(evidence, "report.md"), "utf8");
assert.ok(report.includes("NativeClient.greet") && report.includes("NativeClient.double"));
// Expectations were computed from declarations before this manifest existed.
// Check admission against the real generated root, including negative ABI cases.
const manifest = readIrPackageInfo(readFileSync(join(evidence, "client.irpkg"))).manifest;
assert.equal(resolveProgramExports(manifest.exports, signatures).size, 6);
for (const [declaration, changed] of [
  ["NativeClient.multiple", { ...expectedExports["NativeClient.multiple"], args: [nat, string] }],
  ["NativeClient.effectful", { ...expectedExports["NativeClient.effectful"], effect: "pure" }],
  ["NativeClient.nested", { ...expectedExports["NativeClient.nested"], result: nat }],
]) {
  assert.throws(() => resolveProgramExports(manifest.exports,
    snapshotExpectedExports({ [declaration]: changed })), /does not match expected callable signature/);
}
console.log("PASS cold native-precompiled client: markers, classifier, resource imports, native calls and generator");
