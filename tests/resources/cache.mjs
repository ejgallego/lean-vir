// Isolated cache/shared-producer acceptance; retains all inputs and failure logs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { checkFacetOutputSafety } from "./output-safety.mjs";
import { checkNativeProfileRejection } from "./native-profile.mjs";
import {
  encodeDescriptor,
  descriptorContentId,
} from "../../web/src/resources/descriptor.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = process.argv[2];
assert(
  process.argv.length <= 3,
  "usage: node tests/resources/cache.mjs [EXACT_RUNTIME_PACK]",
);
const evidence = mkdtempSync(join(tmpdir(), "vir-resource-cache-"));
console.log(`resource cache evidence: ${evidence}`);
const producer = join(evidence, "producer");
const client = join(evidence, "client");
const peer = join(evidence, "peer");
const leaf = join(evidence, "user");
const cache = join(evidence, "lake-cache");
mkdirSync(producer);
for (const name of [
  "Vir",
  "Vir.lean",
  "tools",
  "lakefile.lean",
  "lake-manifest.json",
  "lean-toolchain",
  "vir-resources",
])
  cpSync(join(root, name), join(producer, name), { recursive: true });
cpSync(join(root, "fixtures/resources/client"), client, { recursive: true });
cpSync(join(root, "fixtures/resources/user"), leaf, { recursive: true });
for (const dir of [client, leaf])
  cpSync(join(root, "lean-toolchain"), join(dir, "lean-toolchain"));
const config = join(client, "lakefile.lean");
writeFileSync(
  config,
  readFileSync(config, "utf8").replace('"../../../.."', '"../producer"') +
    [
      "",
      "lean_lib OtherResources where",
      '  srcDir := "resources"',
      "  roots := #[]",
      "  globs := #[.one `Client.OtherResources]",
      "  needs := #[`@client_fixture/OtherResources:virResourcePack]",
      "",
    ].join("\n"),
);
const carrier = readFileSync(
  join(client, "resources/Client/Resources.lean"),
  "utf8",
)
  .replaceAll("Client.Resources", "Client.OtherResources")
  .replaceAll("ClientResources.virres", "OtherResources.virres");
writeFileSync(join(client, "resources/Client/OtherResources.lean"), carrier);
const recipe = JSON.parse(
  readFileSync(join(client, "vir-resources/ClientResources.json")),
);
writeFileSync(
  join(client, "vir-resources/OtherResources.json"),
  JSON.stringify({
    ...recipe,
    logicalId: "other-client/greeting",
  }),
);
const umbrella = join(client, "Client.lean");
writeFileSync(
  umbrella,
  readFileSync(umbrella, "utf8")
    .replace(
      "public import Client.Resources",
      "public import Client.Resources\npublic import Client.OtherResources",
    )
    .replace(
      "#[Client.Resources.bundle]",
      "#[Client.Resources.bundle, Client.OtherResources.bundle]",
    ),
);
// A second intermediary uses the same producer and runtime, but owns separate
// program/carrier modules and resource identities.
cpSync(client, peer, { recursive: true });
for (const directory of ["program", "resources"])
  renameSync(join(peer, directory, "Client"), join(peer, directory, "Peer"));
renameSync(join(peer, "Client.lean"), join(peer, "Peer.lean"));
renameSync(
  join(peer, "vir-resources/ClientResources.json"),
  join(peer, "vir-resources/PeerResources.json"),
);
for (const path of [
  "lakefile.lean",
  "Peer.lean",
  "program/Peer/Helper.lean",
  "program/Peer/Program.lean",
  "resources/Peer/Resources.lean",
  "resources/Peer/OtherResources.lean",
  "vir-resources/PeerResources.json",
  "vir-resources/OtherResources.json",
]) {
  const file = join(peer, path);
  writeFileSync(
    file,
    readFileSync(file, "utf8")
      .replaceAll("client_fixture", "peer_fixture")
      .replaceAll("client-fixture", "peer-fixture")
      .replaceAll("other-client", "other-peer")
      .replaceAll("Client", "Peer"),
  );
}
const leafConfig = join(leaf, "lakefile.toml");
writeFileSync(
  leafConfig,
  readFileSync(leafConfig, "utf8") +
    '\n[[require]]\nname = "peer_fixture"\npath = "../peer"\n',
);
const leafMain = join(leaf, "Main.lean");
writeFileSync(
  leafMain,
  readFileSync(leafMain, "utf8")
    .replace("import Client", "import Client\nimport Peer")
    .replace(
      "  let bundles ← IO.ofExcept <| Client.resources.bundles.mapError reprStr",
      '  unless Client.resources.runtime.contentId == Peer.resources.runtime.contentId do\n    throw <| IO.userError "intermediaries selected different runtimes"\n  let resources : Vir.Resources.ResourceSet := { runtime := Client.resources.runtime, programs := Client.resources.programs ++ Peer.resources.programs }\n  let bundles ← IO.ofExcept <| resources.bundles.mapError reprStr',
    ),
);
const lock = JSON.parse(
  readFileSync(join(producer, "vir-resources/runtime.json")),
);
let runtimeBytes;
if (source) runtimeBytes = readFileSync(resolve(source));
else {
  // Integrity-only CI fixture, NEVER executed as a browser runtime. Real-Wasm
  // and Slides acceptance remain separate; this checks the Lake build graph.
  const members = [
    [
      "runtime.js",
      Buffer.from("// synthetic resource integrity fixture\n"),
      "text/javascript",
    ],
    [
      "runtime.wasm",
      Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
      "application/wasm",
    ],
  ];
  const descriptor = {
    schemaVersion: 1,
    logicalId: "test-only/cache-runtime",
    kind: "runtime",
    compatibility: JSON.parse(
      readFileSync(join(producer, "vir-resources/compatibility.json")),
    ),
    files: members.map(([path, bytes, mediaType]) => ({
      path,
      mediaType,
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })),
    fileEntries: [
      { role: "runtimeModule", path: "runtime.js" },
      { role: "wasm", path: "runtime.wasm" },
    ],
    exports: [],
  };
  const encoded = Buffer.from(encodeDescriptor(descriptor));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(encoded.length);
  runtimeBytes = Buffer.concat([
    Buffer.from("5649525245530001", "hex"),
    length,
    encoded,
    ...members.map((m) => m[1]),
  ]);
  lock.contentId = await descriptorContentId(descriptor);
  writeFileSync(
    join(producer, "vir-resources/runtime.json"),
    JSON.stringify(lock),
  );
}
const runtimeCache = join(
  producer,
  ".lake/build/vir/resources/runtime",
  `${lock.contentId}.virres`,
);
mkdirSync(join(producer, ".lake/build/vir/resources/runtime"), {
  recursive: true,
});
writeFileSync(runtimeCache, runtimeBytes);
const env = {
  ...process.env,
  LAKE_CACHE_DIR: cache,
  LAKE_ARTIFACT_CACHE: "true",
  LAKE_RESTORE_ARTIFACTS: "false",
};
function runLake(label, cwd, args, buildEnv = env) {
  const result = spawnSync("lake", ["-v", ...args], {
    cwd,
    env: buildEnv,
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(evidence, `${label}.log`), log);
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${label}: ${log.slice(-18000)}`);
  return log;
}
const build = (label, buildEnv = env) =>
  runLake(
    label,
    leaf,
    ["exe", "generate-site", join(evidence, "site")],
    buildEnv,
  );
const runtimeOnly = runLake("runtime-only", producer, [
  "build",
  "VirResourceRuntime",
]);
assert.doesNotMatch(
  runtimeOnly,
  // Shared version constants are not the package generator or its analysis cone.
  /Built.*(?:GeneratePackage(?!\.PackageFormat\b)|ResourceProgram|vir_resource_program)/,
);
assert.equal(
  existsSync(join(producer, ".lake/build/bin/vir_resource_program")),
  false,
);
const stages = [
  join(producer, ".vir-generated/VirResourceRuntime.virres"),
  ...["ClientResources", "OtherResources"].map((n) =>
    join(client, ".vir-generated", `${n}.virres`),
  ),
  ...["PeerResources", "OtherResources"].map((n) =>
    join(peer, ".vir-generated", `${n}.virres`),
  ),
];
const signature = (path) => {
  const s = statSync(path, { bigint: true });
  return [s.ino, s.mtimeNs, s.size];
};
const cold = build("cold-shared");
assert.equal(
  (cold.match(/trace: .*vir_program build /g) ?? []).length,
  2,
  "two roots must generate exactly twice despite four resource carriers",
);
const canonical = join(
  client,
  "build with spaces/vir/programs/Client/Program.virprogram",
);
const canonicalIdentity = () =>
  JSON.parse(readFileSync(`${canonical}.trace`)).outputs;
const canonicalSignature = signature(canonical);
const mixed = runLake("mixed-adapters", client, [
  "build",
  "+Client.Program:vir",
  "ClientResources:virResourcePack",
]);
assert.doesNotMatch(mixed, /Built.*Client\.Program:virProgram/);
assert.deepEqual(signature(canonical), canonicalSignature);
const packs = stages.map((p) => readFileSync(p));
const signatures = stages.map(signature);
const warm = build("warm-shared");
assert.deepEqual(stages.map(signature), signatures);
assert.doesNotMatch(warm, /Built.*(?:Client|Peer|Main|Runtime)/);
assert.equal(readdirSync(join(evidence, "site")).length, 5);
assert.notDeepEqual(packs[1], packs[3]);
assert.notDeepEqual(packs[2], packs[4]);
checkNativeProfileRejection({ client, producer, env, evidence });
build("native-profile-unset");
assert.deepEqual(stages.map(signature), signatures);
checkFacetOutputSafety({ client, env, evidence });

// Full implementation traces must invalidate the new facet even when public
// interfaces and conventional artifact locations are unchanged.
const helper = join(client, "program/Client/Helper.lean");
const helperSource = readFileSync(helper, "utf8");
// The same campaign tests conventional paths as well as the cache-only phase
// below. Here, changed content-addressed paths must NOT mask lost input traces.
const conventionalEnv = { ...env, LAKE_ARTIFACT_CACHE: "false" };
build("conventional-inputs", conventionalEnv);
const setupPath = join(
  client,
  "build with spaces/vir/programs/Client/Program.setup.json",
);
const setupBefore = readFileSync(setupPath);
const beforeSetup = JSON.parse(setupBefore);
for (const name of ["Client.Helper", "Client.Program"])
  for (const path of beforeSetup.importArts[name].flat())
    assert.ok(path.startsWith(join(client, "build with spaces") + "/"), path);
const publicPaths = ["Helper", "Program"].map((name) =>
  join(client, "build with spaces/lib/lean/Client", `${name}.olean`),
);
const publicBytes = publicPaths.map((path) => readFileSync(path));
const canonicalBefore = readFileSync(canonical);
writeFileSync(helper, helperSource.replace('"Hello, "', '"Welcome, "'));
build("private-transitive-edit", conventionalEnv);
assert.notDeepEqual(readFileSync(canonical), canonicalBefore);
runLake(
  "private-edit-loose-adapter",
  client,
  ["build", "+Client.Program:vir"],
  conventionalEnv,
);
assert.deepEqual(
  readFileSync(setupPath),
  setupBefore,
  "identical paths must still invalidate packaging",
);
assert.deepEqual(
  publicPaths.map((path) => readFileSync(path)),
  publicBytes,
);
assert.notDeepEqual(readFileSync(stages[1]), packs[1]);
assert.notDeepEqual(readFileSync(stages[2]), packs[2]);
assert.deepEqual(signature(stages[0]), signatures[0]);
assert.deepEqual(
  stages.slice(3).map((path) => readFileSync(path)),
  packs.slice(3),
);
writeFileSync(helper, helperSource);
build("private-transitive-restored", conventionalEnv);
assert.deepEqual(
  stages.map((path) => readFileSync(path)),
  packs,
);

// Exercise every support-file input independently, without recompiling program IR.
const recipePath = join(client, "vir-resources/ClientResources.json");
const supportSource = join(client, "support.txt");
const support = {
  source: "support.txt",
  path: "data/message.txt",
  mediaType: "text/plain",
};
writeFileSync(supportSource, "first\n");
// Normalize back to cache-backed acquisition once, then keep the canonical
// result completely stable across changes that belong only to the adapter.
build("support-baseline");
const supportProgramSignature = canonicalIdentity();
let previous = packs[1];
for (const [label, entry, contents] of [
  ["support-added", support, "first\n"],
  ["support-bytes", support, "second\n"],
  ["support-path", { ...support, path: "data/renamed.txt" }, "second\n"],
  ["support-type", { ...support, mediaType: "text/markdown" }, "second\n"],
]) {
  writeFileSync(supportSource, contents);
  writeFileSync(
    recipePath,
    JSON.stringify({ ...recipe, supportFiles: [entry] }),
  );
  const log = build(label);
  const current = readFileSync(stages[1]);
  assert.notDeepEqual(current, previous);
  previous = current;
  assert.deepEqual(readFileSync(stages[2]), packs[2]);
  assert.deepEqual(
    stages.slice(3).map((path) => readFileSync(path)),
    packs.slice(3),
  );
  assert.deepEqual(signature(stages[0]), signatures[0]);
  assert.doesNotMatch(log, /Built.*Client\.(?:Program|Helper)(?:\s|:)/);
  assert.deepEqual(
    canonicalIdentity(),
    supportProgramSignature,
    `${label} must not regenerate the compiled program`,
  );
}
writeFileSync(recipePath, JSON.stringify(recipe));
build("support-removed");
assert.deepEqual(
  stages.map((path) => readFileSync(path)),
  packs,
);

// Selecting compatible JS-only runtime bytes must not rebuild either program.
// This also works with the real selected pack; a comment leaves JS semantics intact.
const length = runtimeBytes.readUInt32LE(8);
const descriptor = JSON.parse(runtimeBytes.subarray(12, 12 + length));
const runtimeModule = descriptor.fileEntries.find(
  (entry) => entry.role === "runtimeModule",
).path;
let offset = 12 + length;
const payloads = descriptor.files.map((file) => {
  let bytes = runtimeBytes.subarray(offset, offset + file.byteLength);
  offset += file.byteLength;
  if (file.path === runtimeModule) {
    bytes = Buffer.concat([
      bytes,
      Buffer.from("\n// compatible JS-only invalidation fixture\n"),
    ]);
    file.byteLength = bytes.length;
    file.sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  return bytes;
});
const encoded = Buffer.from(encodeDescriptor(descriptor));
const encodedLength = Buffer.alloc(4);
encodedLength.writeUInt32LE(encoded.length);
const changedRuntime = Buffer.concat([
  runtimeBytes.subarray(0, 8),
  encodedLength,
  encoded,
  ...payloads,
]);
const changedId = await descriptorContentId(descriptor);
const runtimeDir = join(producer, ".lake/build/vir/resources/runtime");
writeFileSync(join(runtimeDir, `${changedId}.virres`), changedRuntime);
writeFileSync(
  join(producer, "vir-resources/runtime.json"),
  JSON.stringify({ ...lock, contentId: changedId }),
);
const programSignatures = stages.slice(1).map(signature);
const runtimeEdit = build("runtime-js-only");
assert.deepEqual(readFileSync(stages[0]), changedRuntime);
assert.deepEqual(stages.slice(1).map(signature), programSignatures);
assert.doesNotMatch(runtimeEdit, /Built.*:virResourcePack/);
writeFileSync(
  join(producer, "vir-resources/runtime.json"),
  JSON.stringify(lock),
);
build("runtime-restored");
assert.deepEqual(
  stages.map((path) => readFileSync(path)),
  packs,
);
// Subsequent cache-only checks compare against the restored runtime's identity.
signatures[0] = signature(stages[0]);

// Drop only this campaign's conventional build outputs; no global cache edits.
for (const [name, path] of [
  ["producer", join(producer, ".lake/build")],
  ["client", join(client, "build with spaces")],
  ["peer", join(peer, "build with spaces")],
  ["leaf", join(leaf, ".lake/build")],
])
  renameSync(path, join(evidence, `retained-${name}-build`));
// Runtime staging is sufficient offline to recover its private acquisition cache.
for (const [i, path] of stages.entries())
  if (i > 0) renameSync(path, `${path}.retained`);
build("cache-only");
for (const [i, path] of stages.entries())
  assert.deepEqual(readFileSync(path), packs[i]);
assert.deepEqual(signature(stages[0]), signatures[0]);
function compiledFiles(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = join(path, entry.name);
    return entry.isDirectory()
      ? compiledFiles(file)
      : /\.(?:olean(?:\.private|\.server)?|ir(?:\.sig)?)$/.test(file)
        ? [file]
        : [];
  });
}
assert.deepEqual(
  compiledFiles(join(client, "build with spaces")),
  [],
  "client artifacts should remain cache-only",
);
assert.deepEqual(
  compiledFiles(join(producer, ".lake/build")),
  [],
  "producer artifacts should remain cache-only",
);
assert.deepEqual(
  compiledFiles(join(peer, "build with spaces")),
  [],
  "peer artifacts should remain cache-only",
);
// Remove only the facet's trace/output to force generation with cached inputs.
const facetDir = join(client, "build with spaces/vir/resources/programs");
if (existsSync(facetDir))
  renameSync(facetDir, join(evidence, "retained-facet-traces"));
// Change only the recipe identity: compilation stays cached, but packaging
// must still consume the complete returned private/IR artifacts.
writeFileSync(
  recipePath,
  JSON.stringify({ ...recipe, logicalId: "client-fixture/renamed" }),
);
build("repack-cached-inputs");
assert.notDeepEqual(readFileSync(stages[1]), packs[1]);
assert.deepEqual(readFileSync(stages[2]), packs[2]);
assert.deepEqual(signature(stages[0]), signatures[0]);
assert.deepEqual(
  compiledFiles(join(client, "build with spaces")).filter(
    (path) => !path.includes("/Client/Resources."),
  ),
  [],
  "only the changed carrier may recompile",
);
// Recipe-only repacking consumes the shared program artifact, not another
// generator invocation or a conventional-path compiled-input reconstruction.
assert.ok(existsSync(join(cache, "artifacts")));

// Keep only module artifacts in this campaign's Lake cache. A normal leaf
// execution must rebuild native tools/objects and still use the cached Lean
// inputs to reproduce all resource packs.
const leanOnlyPacks = stages.map((path) => readFileSync(path));
const artifacts = join(cache, "artifacts");
const nativeArtifacts = join(evidence, "retained-native-cache-artifacts");
mkdirSync(nativeArtifacts);
let movedNative = 0;
let movedObjects = 0;
let movedExecutables = 0;
for (const name of readdirSync(artifacts)) {
  if (
    /\.(?:olean(?:\.server|\.private)?|ir(?:\.sig)?|ilean|c|bc|ltar)$/.test(
      name,
    )
  )
    continue;
  if (/\.o$/.test(name)) movedObjects++;
  if (!name.includes(".")) movedExecutables++;
  renameSync(join(artifacts, name), join(nativeArtifacts, name));
  movedNative++;
}
assert.ok(movedNative > 0, "expected native artifacts in the initial cache");
assert.ok(
  movedObjects > 0,
  "expected native object artifacts in the initial cache",
);
assert.ok(
  movedExecutables > 0,
  "expected executable artifacts in the initial cache",
);
for (const [name, path] of [
  ["producer", join(producer, ".lake/build")],
  ["client", join(client, "build with spaces")],
  ["peer", join(peer, "build with spaces")],
  ["leaf", join(leaf, ".lake/build")],
])
  if (existsSync(path))
    renameSync(path, join(evidence, `retained-lean-only-${name}-build`));
for (const path of stages.slice(1))
  renameSync(path, `${path}.lean-only-retained`);
const leanOnly = build("lean-only-cache");
assert.deepEqual(
  stages.map((path) => readFileSync(path)),
  leanOnlyPacks,
);
assert.match(leanOnly, /Built.*(?:vir_resource_pack|vir_resource_program)/);
for (const name of ["vir_resource_pack", "vir_resource_program"])
  assert.ok(existsSync(join(producer, ".lake/build/bin", name)), name);
assert.ok(existsSync(join(leaf, ".lake/build/bin/generate-site")));
for (const path of [
  join(client, "build with spaces/vir/programs/Client/Program.setup.json"),
  join(peer, "build with spaces/vir/programs/Peer/Program.setup.json"),
]) {
  const setup = JSON.parse(readFileSync(path));
  for (const imports of Object.values(setup.importArts))
    for (const artifact of imports.flat())
      assert.ok(artifact.startsWith(cache + "/"), artifact);
}
console.log(
  `resource cache: two intermediaries, warm no-op, cache-only and Lean-only repair PASS (${evidence})`,
);
