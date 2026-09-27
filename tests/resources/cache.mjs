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
function build(label) {
  const result = spawnSync(
    "lake",
    ["-v", "exe", "generate-site", join(evidence, "site")],
    {
      cwd: leaf,
      env,
      encoding: "utf8",
      timeout: 600000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(evidence, `${label}.log`), log);
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${label}: ${log.slice(-18000)}`);
  return log;
}
const stages = [
  join(producer, ".vir-generated/VirResourceRuntime.virres"),
  ...["ClientResources", "OtherResources"].map((n) =>
    join(client, ".vir-generated", `${n}.virres`),
  ),
];
const signature = (path) => {
  const s = statSync(path, { bigint: true });
  return [s.ino, s.mtimeNs, s.size];
};
build("cold-shared");
const packs = stages.map((p) => readFileSync(p));
const signatures = stages.map(signature);
const warm = build("warm-shared");
assert.deepEqual(stages.map(signature), signatures);
assert.doesNotMatch(warm, /Built.*(?:Client|Main|Runtime)/);
assert.equal(readdirSync(join(evidence, "site")).length, 3);

// Drop only this campaign's conventional build outputs; no global cache edits.
for (const [name, path] of [
  ["producer", join(producer, ".lake/build")],
  ["client", join(client, "build with spaces")],
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
// Remove only the facet's trace/output to force generation with cached inputs.
const facetDir = join(client, "build with spaces/vir/resources/programs");
if (existsSync(facetDir))
  renameSync(facetDir, join(evidence, "retained-facet-traces"));
// Change only the role metadata: compilation stays cached, but both packaging
// entry points must still consume the complete returned private/IR artifacts.
const recipePath = join(client, "vir-resources/ClientResources.json");
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
const setup = JSON.parse(
  readFileSync(join(facetDir, "ClientResources.virres.setup.json")),
);
for (const path of setup.importArts["Client.Program"].flat())
  assert.ok(
    path.startsWith(cache + "/"),
    `not an authoritative cache path: ${path}`,
  );
console.log(
  `resource cache: cold shared producer, warm no-op, cache-only repair and regeneration PASS (${evidence})`,
);
