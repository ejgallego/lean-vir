import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  canonicalJson,
  createTar,
  extractTar,
  fileRecord,
  legacyPrettyMArtifactFiles,
  safeArchivePath,
  sha256File,
  verifyArtifactSet,
} from "../scripts/artifact-set-lib.mjs";
import {
  artifactFiles,
  artifactSetConfig,
  checkoutSources,
  componentOrder,
  readBuildDatabase,
  validateBuildDatabase,
} from "../scripts/artifact-build-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = join(appRoot, "test-results", "artifact-set-unit");

test("the prettyM source build is complete and materializes pack provenance", async () => {
  const database = await readBuildDatabase(
    join(appRoot, "artifact-builds.json"),
  );
  const build = database.builds.prettyM;
  assert.deepEqual(componentOrder(build), ["vir", "native", "llvm"]);
  assert.deepEqual(
    artifactFiles(build),
    [...legacyPrettyMArtifactFiles].sort(),
  );

  const sources = checkoutSources(database, "prettyM");
  assert.equal(
    sources.vir.revision,
    "64e30784da16957cca92951344d776f895b30491",
  );
  assert.equal(
    sources.fir.revision,
    "298682a766d80e90053d3e76ee2f3e4af78a52aa",
  );
  assert.equal(
    sources.workload.revision,
    "c16a6f83b622dd8ebc2f4975d93b856b08dde444",
  );

  const config = artifactSetConfig(database, "prettyM");
  assert.equal(config.schemaVersion, 2);
  assert.deepEqual(config.example, {
    id: "prettyM",
    stageAdapter: "prettyM",
  });
  assert.equal(config.setId, "prettyM-bounded-set-0001");
  assert.equal(
    config.components.vir.runtime.repository,
    "https://github.com/ejgallego/lean-vir",
  );
  assert.equal(
    config.components.vir.runtime.sourceCommit,
    sources.vir.revision,
  );
  assert.deepEqual(config.components.vir.workload.source, {
    repository: "https://github.com/leanprover/verso-slides",
    commit: sources.workload.revision,
    file: "VersoSlides/Pretty.lean",
    dirty: false,
  });
});

test("catalog build identity and artifact paths are example-neutral", async () => {
  const database = await readBuildDatabase(
    join(appRoot, "artifact-builds.json"),
  );
  const alternate = structuredClone(database.builds.prettyM);
  alternate.example = { id: "illuminate", stageAdapter: "illuminate" };
  alternate.artifactSet.setId = "illuminate-player-set-0001";
  alternate.artifactSet.lock = "illuminate-artifact-set.lock.json";
  alternate.components.vir.artifact.workload.file = "player.irpkg";
  alternate.components.vir.producer.files["player.irpkg"] =
    "illuminate/player.irpkg";
  delete alternate.components.vir.producer.files["prettyM-vir.irpkg"];
  const catalog = structuredClone(database);
  catalog.builds = { illuminate: alternate };
  assert.doesNotThrow(() => validateBuildDatabase(catalog));
  assert.ok(artifactFiles(alternate).includes("illuminate/player.irpkg"));
  assert.equal(
    artifactSetConfig(catalog, "illuminate").setId,
    "illuminate-player-set-0001",
  );
});

test("creates a deterministic normalized tar and extracts only regular files", async () => {
  const source = join(scratch, "source");
  const extracted = join(scratch, "extracted");
  await rm(scratch, { recursive: true, force: true });
  await mkdir(join(source, "nested"), { recursive: true });
  await writeFile(join(source, "z.txt"), "last\n");
  await writeFile(join(source, "nested", "a.txt"), "first\n");

  const paths = ["z.txt", "nested/a.txt"];
  const first = await createTar(source, paths);
  const second = await createTar(source, paths.toReversed());
  assert.deepEqual(first, second);
  assert.deepEqual(await extractTar(first, extracted), [
    "nested/a.txt",
    "z.txt",
  ]);
  assert.equal(
    await readFile(join(extracted, "nested", "a.txt"), "utf8"),
    "first\n",
  );
  assert.equal(await readFile(join(extracted, "z.txt"), "utf8"), "last\n");
});

test("rejects unsafe paths and corrupted headers", async () => {
  for (const path of ["/absolute", "../escape", "a/../escape", "a\\b"])
    assert.throws(() => safeArchivePath(path), /unsafe archive path/);

  const source = join(scratch, "corrupt-source");
  const extracted = join(scratch, "corrupt-extracted");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "safe.txt"), "safe\n");
  const archive = await createTar(source, ["safe.txt"]);
  archive[0] ^= 1;
  await assert.rejects(() => extractTar(archive, extracted), /tar checksum/);
});

test("canonical JSON is independent of object insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, b: 3 } }),
    canonicalJson({ a: { b: 3, y: 2 }, z: 1 }),
  );
});

test("verifies an example-neutral artifact-set manifest", async () => {
  const directory = join(scratch, "generic-manifest");
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, "payload"), { recursive: true });
  await writeFile(join(directory, "payload", "player.wasm"), "wasm\n");
  const files = {
    "payload/player.wasm": await fileRecord(
      join(directory, "payload", "player.wasm"),
    ),
  };
  await writeFile(
    join(directory, "ARTIFACT_SET.json"),
    canonicalJson({
      schemaVersion: 2,
      kind: "browser-benchmarks/artifact-set",
      example: { id: "illuminate", stageAdapter: "illuminate" },
      setId: "illuminate-player-set-0001",
      components: {},
      files,
    }),
  );
  const checksummedPaths = ["ARTIFACT_SET.json", ...Object.keys(files)].sort();
  await writeFile(
    join(directory, "SHA256SUMS"),
    `${(
      await Promise.all(
        checksummedPaths.map(
          async (path) => `${await sha256File(join(directory, path))}  ${path}`,
        ),
      )
    ).join("\n")}\n`,
  );
  const manifest = await verifyArtifactSet(directory);
  assert.equal(manifest.example.id, "illuminate");
});

test("stages a verified Illuminate artifact namespace atomically", async () => {
  const directory = join(scratch, "illuminate-set");
  const destination = join(scratch, "illuminate-staged");
  await rm(directory, { recursive: true, force: true });
  await rm(destination, { recursive: true, force: true });
  const paths = [
    "illuminate/workload/anim_core.js",
    "illuminate/workload/vir-player-trace.mjs",
    "illuminate/workload/examples.json",
    "illuminate/vir/sdk/js/vir-runtime.js",
    "illuminate/vir/sdk/wasm/vir-upstream.wasm",
    "illuminate/vir/module-sets/Illuminate/Animation/Vir.irpkg-set.json",
    "illuminate/vir/module-sets/Illuminate/Animation/Vir.parts/Player.irpkg",
    "illuminate/native/BUILD.json",
    "illuminate/native/illuminate-player-browser-adapter.mjs",
    "illuminate/native/illuminate-player.wasm",
    "illuminate/native/illuminate-player.wasm.json",
    "illuminate/selection/BUILD.json",
    "illuminate/selection/illuminate-selection-player-browser-adapter.mjs",
    "illuminate/selection/illuminate-selection-player.wasm",
    "illuminate/selection/illuminate-selection-player.wasm.json",
  ];
  for (const path of paths) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), `${path}\n`);
  }
  const files = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        await fileRecord(join(directory, path)),
      ]),
    ),
  );
  await writeFile(
    join(directory, "ARTIFACT_SET.json"),
    canonicalJson({
      schemaVersion: 2,
      kind: "browser-benchmarks/artifact-set",
      example: { id: "illuminate", stageAdapter: "illuminate" },
      setId: "illuminate-test-set",
      components: {},
      files,
    }),
  );
  const checksummedPaths = ["ARTIFACT_SET.json", ...paths].sort();
  await writeFile(
    join(directory, "SHA256SUMS"),
    `${(
      await Promise.all(
        checksummedPaths.map(
          async (path) => `${await sha256File(join(directory, path))}  ${path}`,
        ),
      )
    ).join("\n")}\n`,
  );

  const result = spawnSync(
    process.execPath,
    [
      "scripts/stage-illuminate-artifacts.mjs",
      relative(appRoot, directory),
      "--destination",
      relative(appRoot, destination),
    ],
    { cwd: appRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(join(destination, "workload", "examples.json"), "utf8"),
    "illuminate/workload/examples.json\n",
  );
  assert.equal(
    JSON.parse(await readFile(join(destination, "ARTIFACT_SET.json"), "utf8"))
      .setId,
    "illuminate-test-set",
  );
});

test("rejects undeclared artifact-set members", async () => {
  const directory = join(scratch, "unexpected-member");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "ARTIFACT_SET.json"),
    canonicalJson({
      schemaVersion: 1,
      kind: "prettyM-artifact-set",
      setId: "prettyM-test",
      files: {},
    }),
  );
  await writeFile(join(directory, "SHA256SUMS"), "");
  await writeFile(join(directory, "surprise.txt"), "not declared\n");
  await assert.rejects(() => verifyArtifactSet(directory), /unexpected member/);
});
