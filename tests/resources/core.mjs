/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Independent host oracle; Node is not used by the Lean resource implementation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const binary = join(root, ".lake/build/bin/vir_resource_tests");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const run = args => execFileSync(binary, args, { cwd: root, encoding: "utf8" });
// Explicit scalar traversal avoids accidentally rewriting an escaped backslash.
function quote(value) {
  let result = '"';
  for (const c of value) {
    const n = c.codePointAt(0);
    result += n < 32 ? `\\u${n.toString(16).padStart(4, "0")}`
      : c === '"' || c === "\\" ? `\\${c}` : c;
  }
  return result + '"';
}
function canonical(value) {
  if (typeof value === "string") return quote(value);
  if (typeof value === "number") {
    assert(Number.isSafeInteger(value) && value >= 0);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${quote(key)}:${canonical(value[key])}`).join(",")}}`;
}

// Check Lake's actual library collection, not just successful executable imports.
const coreModules = execFileSync("lake", ["query", "VirResourceCore:modules"],
  { cwd: root, encoding: "utf8" }).trim().split("\n");
assert.ok(coreModules.includes("Vir.Resources.Site"), "Site must belong to the lightweight resource core");
assert.ok(!coreModules.includes("Vir.Resources.Runtime"), "core must not collect the acquired runtime carrier");
const coreArchive = execFileSync("lake", ["query", "VirResourceCore:static"],
  { cwd: root, encoding: "utf8" }).trim();
const coreObjects = execFileSync("lake", ["env", "llvm-ar", "t", coreArchive],
  { cwd: root, encoding: "utf8" }).trim().split("\n");
assert.ok(coreObjects.includes("Site.c.o.export"), "native resource-core archive must contain Site");
console.log(run([]).trim());
const encoded = run(["descriptor"]).replace(/\n$/, "");
const descriptor = JSON.parse(encoded);
assert.equal(encoded, canonical(descriptor));
assert.equal(digest(`vir-resource-bundle-v1\n${encoded}`),
  "31aa0de3db1b738af032d0a1c98074426f9b0cad7657d79035c62284d87c2d8e");

const scratch = mkdtempSync(join(tmpdir(), "vir-resource-core-"));
let passed = false;
try {
  const sizes = [...Array(130).keys(), 255, 256, 257, 1023, 1024, 1025, 65537, 1000000];
  const paths = [];
  const expected = [];
  for (const size of sizes) {
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 37 + size) & 255;
    const path = join(scratch, `${size}.bin`);
    writeFileSync(path, bytes);
    paths.push(path);
    expected.push(digest(bytes));
  }
  assert.deepEqual(run(["hash", ...paths]).trim().split("\n"), expected);
  console.log(`resource SHA256: ${sizes.length} independent binary/padding vectors passed`);
  passed = true;
} finally {
  if (passed) rmSync(scratch, { recursive: true });
  else console.error(`resource test inputs retained: ${scratch}`);
}
