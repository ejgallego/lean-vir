/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Explicit maintainer operation, never invoked by an application's Lake build.
// Inputs must be an already qualified Wasm and its retained build identity.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { assertResourceCompatibility } from "../../web/src/resources/compatibility.js";
import {
  descriptorContentId,
  encodeDescriptor,
  validateDescriptor,
} from "../../web/src/resources/descriptor.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [wasmPath, identityPath, out, ...extra] = process.argv.slice(2);
if (!wasmPath || !identityPath || !out || extra.length)
  throw new Error(
    "usage: node scripts/resources/pack-runtime.mjs WASM BUILD_IDENTITY NEW_OUTPUT_DIR",
  );
const output = resolve(out);
const profile = JSON.parse(
  await readFile(join(root, "vir-resources/compatibility.json")),
);
assertResourceCompatibility(profile);
const identity = JSON.parse(await readFile(identityPath));
if (
  identity.leanSource?.commit !== profile.leanRevision ||
  identity.leanSource?.dirty !== false
)
  throw new Error(
    "runtime source identity must be clean and match the compatibility profile",
  );
if (identity.profile !== "release")
  throw new Error(
    "runtime distribution requires the qualified release profile",
  );
const wasm = await readFile(wasmPath);
if (!WebAssembly.validate(wasm)) throw new Error("invalid Wasm input");
const compiled = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["web/src/resource-program.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
  metafile: true,
  legalComments: "inline",
  outfile: "runtime.js",
});
if (Object.values(compiled.metafile.outputs).some((o) => o.imports.length))
  throw new Error(
    "runtime has external JavaScript dependencies outside its inventory",
  );
const members = [
  ["runtime.js", compiled.outputFiles[0].contents, "text/javascript"],
  ["runtime.wasm", wasm, "application/wasm"],
  ["LICENSE", await readFile(join(root, "LICENSE")), "text/plain"],
  ["NOTICE", await readFile(join(root, "NOTICE")), "text/plain"],
  [
    "lean-LICENSE",
    await readFile(join(root, "third_party/lean4-src/LICENSE")),
    "text/plain",
  ],
  [
    "lean-LICENSES",
    await readFile(join(root, "third_party/lean4-src/LICENSES")),
    "text/plain",
  ],
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const descriptor = validateDescriptor({
  schemaVersion: 1,
  logicalId: "lean-vir/runtime",
  kind: "runtime",
  compatibility: profile,
  files: members.map(([path, bytes, mediaType]) => ({
    path,
    byteLength: bytes.length,
    sha256: sha(bytes),
    mediaType,
  })),
  fileEntries: [
    { role: "runtimeModule", path: "runtime.js" },
    { role: "wasm", path: "runtime.wasm" },
  ],
  exports: [],
});
const contentId = await descriptorContentId(descriptor);
// Refuse an existing destination: failed runs remain inspectable, never overwritten.
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const payloads = join(output, "payloads");
await mkdir(payloads);
for (const [path, bytes] of members)
  await writeFile(join(payloads, path), bytes);
const descriptorPath = join(output, "descriptor.json");
await writeFile(descriptorPath, encodeDescriptor(descriptor));
await writeFile(
  join(payloads, "bundle.json"),
  JSON.stringify({ contentId, descriptor }),
);
const pack = join(output, `${contentId}.virres`);
execFileSync(
  join(root, ".lake/build/bin/vir_resource_pack"),
  ["pack", descriptorPath, payloads, pack],
  { cwd: root, stdio: "inherit" },
);
await writeFile(
  join(output, "provenance.json"),
  JSON.stringify(
    {
      contentId,
      wasmSha256: sha(wasm),
      packSha256: sha(await readFile(pack)),
      identity,
      // This binds the selected bytes to this run, not a cryptographic attestation of
      // their compiler provenance; maintainers still qualify the actual Wasm build.
      jsSources: compiled.metafile.inputs,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ contentId, pack }));
