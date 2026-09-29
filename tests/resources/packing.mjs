/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Native producer: descriptor bytes and payloads are real independent inputs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const tool = join(repo, ".lake/build/bin/vir_resource_pack");
const fixture = join(repo, ".lake/build/bin/vir_resource_tests");
const evidence = mkdtempSync(join(repo, "build/resource-packing-"));
const payloadRoot = join(evidence, "payload root");
const descriptorPath = join(evidence, "descriptor.json");
const output = join(evidence, "output", "bundle.virres");
mkdirSync(payloadRoot);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
function invoke(
  label,
  descriptor = descriptorPath,
  root = payloadRoot,
  out = output,
  error,
) {
  const result = spawnSync(tool, ["pack", descriptor, root, out], {
    encoding: "utf8",
    timeout: 180000,
  });
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(evidence, `${label}.log`), log);
  if (result.error) throw result.error;
  if (error) {
    assert.notEqual(result.status, 0, label);
    assert.match(log, error, label);
  } else assert.equal(result.status, 0, `${label}: ${log}`);
}
const identity = spawnSync(fixture, ["native-descriptor"], {
  encoding: "utf8",
});
assert.equal(identity.status, 0, identity.stderr);
const compatibility = JSON.parse(identity.stdout).compatibility;
const js = Buffer.from("export const runtime = 42;\n");
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 255]);
writeFileSync(join(payloadRoot, "runtime.js"), js);
writeFileSync(join(payloadRoot, "runtime.wasm"), wasm);
const descriptor = {
  compatibility,
  exports: [],
  fileEntries: [
    { path: "runtime.js", role: "runtimeModule" },
    { path: "runtime.wasm", role: "wasm" },
  ],
  files: [
    {
      byteLength: js.length,
      mediaType: "text/javascript",
      path: "runtime.js",
      sha256: sha(js),
    },
    {
      byteLength: wasm.length,
      mediaType: "application/wasm",
      path: "runtime.wasm",
      sha256: sha(wasm),
    },
  ],
  kind: "runtime",
  logicalId: "native-pack-test",
  schemaVersion: 1,
};
const descriptorBytes = Buffer.from(canonical(descriptor));
const contentId = sha(
  Buffer.concat([Buffer.from("vir-resource-bundle-v1\n"), descriptorBytes]),
);
const writeDescriptor = (value) => writeFileSync(descriptorPath, value);
writeDescriptor(descriptorBytes);
invoke("cold");
const pack = readFileSync(output);
assert.equal(pack.subarray(0, 8).toString("hex"), "5649525245530001");
assert.equal(pack.readUInt32LE(8), descriptorBytes.length);
assert.deepEqual(
  pack.subarray(12, 12 + descriptorBytes.length),
  descriptorBytes,
);
assert.deepEqual(
  pack.subarray(12 + descriptorBytes.length),
  Buffer.concat([js, wasm]),
);
assert.equal(
  contentId,
  sha(
    Buffer.concat([
      Buffer.from("vir-resource-bundle-v1\n"),
      pack.subarray(12, 12 + descriptorBytes.length),
    ]),
  ),
);
const before = statSync(output, { bigint: true });
invoke("warm");
const after = statSync(output, { bigint: true });
assert.equal(after.ino, before.ino);
assert.equal(after.mtimeNs, before.mtimeNs);

const altered = (value) => writeDescriptor(Buffer.from(canonical(value)));
for (const path of ["bundle.json/child", "BUNDLE.JSON/child/nested"]) {
  altered({
    ...descriptor,
    files: [{ ...descriptor.files[0], path }, descriptor.files[1]],
  });
  invoke(
    "reserved-envelope-prefix",
    descriptorPath,
    payloadRoot,
    output,
    /INVALID_PATH/,
  );
  assert.deepEqual(readFileSync(output), pack);
}
altered({
  ...descriptor,
  files: descriptor.files.map((f, i) =>
    i ? f : { ...f, sha256: "0".repeat(64) },
  ),
});
invoke("wrong-hash", descriptorPath, payloadRoot, output, /HASH_MISMATCH/);
assert.deepEqual(readFileSync(output), pack);
altered({
  ...descriptor,
  files: descriptor.files.map((f, i) =>
    i ? f : { ...f, byteLength: f.byteLength - 1 },
  ),
});
invoke("wrong-length", descriptorPath, payloadRoot, output, /LENGTH_MISMATCH/);
writeDescriptor(descriptorBytes);
unlinkSync(join(payloadRoot, "runtime.wasm"));
invoke(
  "missing-input",
  descriptorPath,
  payloadRoot,
  output,
  /MISSING_RESOURCE_FILE/,
);
writeFileSync(join(payloadRoot, "runtime.wasm"), wasm);

const alias = join(evidence, "payload alias");
symlinkSync(payloadRoot, alias);
invoke(
  "linked-root",
  descriptorPath,
  alias,
  output,
  /UNSAFE_RESOURCE_DIRECTORY/,
);
unlinkSync(join(payloadRoot, "runtime.wasm"));
symlinkSync(join(payloadRoot, "runtime.js"), join(payloadRoot, "runtime.wasm"));
invoke(
  "linked-payload",
  descriptorPath,
  payloadRoot,
  output,
  /UNSAFE_RESOURCE_FILE/,
);
unlinkSync(join(payloadRoot, "runtime.wasm"));
writeFileSync(join(payloadRoot, "runtime.wasm"), wasm);
const descriptorAlias = join(evidence, "descriptor alias");
symlinkSync(descriptorPath, descriptorAlias);
invoke(
  "linked-descriptor",
  descriptorAlias,
  payloadRoot,
  output,
  /UNSAFE_RESOURCE_FILE/,
);

writeDescriptor(Buffer.from(` ${descriptorBytes}`));
invoke(
  "noncanonical-space",
  descriptorPath,
  payloadRoot,
  output,
  /NONCANONICAL_DESCRIPTOR/,
);
writeDescriptor(Buffer.from(canonical({ ...descriptor, unknown: true })));
invoke(
  "unknown-key",
  descriptorPath,
  payloadRoot,
  output,
  /NONCANONICAL_DESCRIPTOR/,
);
writeDescriptor(
  Buffer.from(
    descriptorBytes
      .toString("utf8")
      .replace('"schemaVersion":1}', '"schemaVersion":1,"schemaVersion":1}'),
  ),
);
invoke(
  "duplicate-key",
  descriptorPath,
  payloadRoot,
  output,
  /NONCANONICAL_DESCRIPTOR/,
);
writeDescriptor(descriptorBytes);
altered({
  ...descriptor,
  compatibility: { ...compatibility, leanRevision: "wrong-revision" },
});
invoke(
  "wrong-compiler",
  descriptorPath,
  payloadRoot,
  output,
  /LEAN_BUILD_MISMATCH/,
);
writeDescriptor(descriptorBytes);

// A corrupt hardlinked output must be replaced without modifying its other name.
const retained = join(evidence, "retained");
writeFileSync(retained, "old hardlinked bytes");
unlinkSync(output);
linkSync(retained, output);
invoke("replace-hardlink");
assert.deepEqual(readFileSync(output), pack);
assert.equal(readFileSync(retained, "utf8"), "old hardlinked bytes");
assert.notEqual(statSync(output).ino, statSync(retained).ino);
unlinkSync(output);
symlinkSync(retained, output);
invoke(
  "reject-output-link",
  descriptorPath,
  payloadRoot,
  output,
  /UNSAFE_RESOURCE_FILE/,
);
assert.equal(readFileSync(retained, "utf8"), "old hardlinked bytes");
assert.ok(existsSync(output));
const linkedOutputParent = join(evidence, "output alias");
symlinkSync(join(evidence, "output"), linkedOutputParent);
invoke(
  "reject-output-parent-link",
  descriptorPath,
  payloadRoot,
  join(linkedOutputParent, "other.virres"),
  /UNSAFE_RESOURCE_DIRECTORY/,
);
assert.ok(!existsSync(join(evidence, "output", "other.virres")));
console.log(
  `packing: canonical payloads, hashes, bounds, links and atomic warm install passed (${contentId})`,
);
