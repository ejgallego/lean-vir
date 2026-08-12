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
  safeArchivePath,
  sha256,
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
import { verifySourceBuildReceipt } from "../scripts/source-build-receipt-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = join(appRoot, "test-results", "artifact-set-unit");
const prettyMArtifactFiles = [
  "prettyM/lean-llvm/README.md",
  "prettyM/lean-llvm/SHA256SUMS",
  "prettyM/lean-llvm/emscripten-loader.mjs",
  "prettyM/lean-llvm/prettyM-emscripten-adapter.mjs",
  "prettyM/lean-llvm/prettyM.manifest.json",
  "prettyM/lean-llvm/prettyM.mjs",
  "prettyM/lean-llvm/prettyM.wasm",
  "prettyM/lean-native-flat/BUILD.json",
  "prettyM/lean-native-flat/SHA256SUMS",
  "prettyM/lean-native-flat/prettyM-browser-adapter.mjs",
  "prettyM/lean-native-flat/prettyM.wasm",
  "prettyM/lean-native-flat/prettyM.wasm.json",
  "prettyM/lean-native-flat/smoke.mjs",
  "prettyM/lean-native/BUILD.json",
  "prettyM/lean-native/prettyM-browser-adapter.mjs",
  "prettyM/lean-native/prettyM.wasm",
  "prettyM/lean-native/prettyM.wasm.json",
  "prettyM/lean-vir/js/vir-runtime.js",
  "prettyM/lean-vir/wasm/vir-upstream.wasm",
  "prettyM/prettyM-vir.irpkg",
];

test("the prettyM catalog selects the complete source and component graph", async () => {
  const database = await readBuildDatabase(
    join(appRoot, "artifact-builds.json"),
  );
  const build = database.builds.prettyM;
  assert.deepEqual(componentOrder(build), [
    "vir",
    "native",
    "native-flat",
    "llvm",
  ]);
  assert.deepEqual(artifactFiles(build), prettyMArtifactFiles);

  const sources = checkoutSources(database, "prettyM");
  assert.deepEqual(Object.keys(sources).sort(), [
    "fir",
    "fir-current",
    "lean",
    "vir",
    "workload",
    "workload-flat",
  ]);
  for (const source of Object.values(sources)) {
    assert.match(source.revision, /^[0-9a-f]{40}$/);
  }

  const config = artifactSetConfig(database, "prettyM");
  assert.equal(config.schemaVersion, 2);
  assert.deepEqual(config.example, { id: "prettyM", variant: "default" });
  assert.equal(config.setId, build.artifactSet.setId);
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

test("the HTML variant selects four complete renderer backends", async () => {
  const database = await readBuildDatabase(
    join(appRoot, "artifact-builds.json"),
  );
  const build = database.builds["prettyM-html"];
  assert.deepEqual(componentOrder(build), [
    "vir-html",
    "native-html",
    "llvm-html",
  ]);
  assert.ok(
    artifactFiles(build).includes("prettyM/prettyM-html-vir.irpkg"),
  );
  assert.ok(
    artifactFiles(build).includes("prettyM/lean-native-html/prettyM.wasm"),
  );
  assert.ok(
    artifactFiles(build).includes("prettyM/lean-llvm-html/prettyM-html.wasm"),
  );
  const config = artifactSetConfig(database, "prettyM-html");
  assert.deepEqual(config.example, { id: "prettyM", variant: "html" });
  assert.equal(config.setId, build.artifactSet.setId);
  assert.equal(
    config.components["vir-html"].workload.exports[0],
    "VersoSlides.Pretty.formatHtmlForVir",
  );
});

test("catalog build identity and artifact paths are example-neutral", async () => {
  const database = await readBuildDatabase(
    join(appRoot, "artifact-builds.json"),
  );
  const alternate = structuredClone(database.builds.prettyM);
  alternate.example = { id: "illuminate" };
  alternate.example.variant = "default";
  alternate.artifactSet.setId = "illuminate-player-set-0001";
  for (const component of Object.values(alternate.components)) {
    component.producer.files = Object.fromEntries(
      Object.entries(component.producer.files).map(([source, destination]) => [
        source,
        destination.replace(/^prettyM\//, "illuminate/"),
      ]),
    );
  }
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

test("catalog contract objects reject unknown properties", async () => {
  const database = await readBuildDatabase(
    join(appRoot, "artifact-builds.json"),
  );
  const cases = [
    [(value) => (value.typo = true), "artifact build database"],
    [
      (value) => (value.sources["fir-prettyM-extended"].typo = true),
      "source fir-prettyM-extended",
    ],
    [(value) => (value.builds.prettyM.typo = true), "build prettyM"],
    [
      (value) => (value.builds.prettyM.artifactSet.typo = true),
      "build prettyM artifactSet",
    ],
    [
      (value) => (value.builds.prettyM.components.vir.typo = true),
      "component vir",
    ],
    [
      (value) =>
        (value.builds.prettyM.components.vir.producer.typo = true),
      "component vir producer",
    ],
    [
      (value) =>
        (value.builds.prettyM.components.llvm.producer.setup[0].typo = true),
      "component llvm setup command",
    ],
  ];
  for (const [mutate, label] of cases) {
    const candidate = structuredClone(database);
    mutate(candidate);
    assert.throws(
      () => validateBuildDatabase(candidate),
      new RegExp(`${label} has unknown property typo`),
    );
  }
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

test("source receipts bind portable provenance to staged bytes", async () => {
  const directory = join(scratch, "source-receipt");
  const seed = join(directory, "seed");
  const databasePath = join(directory, "artifact-builds.json");
  const examplePath = join(directory, "example.json");
  const testPackagePath = join(directory, "tests.json");
  const receiptPath = join(directory, "BUILD.json");
  const artifactPath = "prettyM/runtime.wasm";
  const setId = "source-receipt-test-set";
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(seed, "prettyM"), { recursive: true });
  await writeFile(join(seed, artifactPath), "wasm\n");
  await writeFile(databasePath, '{"catalog":true}\n');
  await writeFile(examplePath, '{"example":true}\n');
  await writeFile(testPackagePath, '{"tests":true}\n');
  const files = {
    [artifactPath]: await fileRecord(join(seed, artifactPath)),
  };
  const sources = {
    fir: {
      id: "fir-pin",
      repository: "https://example.test/fir",
      revision: "a".repeat(40),
    },
  };
  const components = {
    native: {
      producer: {
        adapter: "fir-native",
        files: { "runtime.wasm": artifactPath },
      },
    },
  };
  const receipt = {
    schemaVersion: 2,
    kind: "browser-benchmarks/source-build-receipt",
    build: "prettyM",
    artifactSet: setId,
    database: {
      file: "artifact-builds.json",
      sha256: sha256(await readFile(databasePath)),
    },
    example: {
      id: "prettyM",
      variant: "default",
      file: "examples/prettyM/example.json",
      sha256: sha256(await readFile(examplePath)),
      testPackage: {
        file: "examples/prettyM/tests.json",
        sha256: sha256(await readFile(testPackagePath)),
      },
    },
    checkoutResolution: {
      configUsed: true,
      checkoutOverrides: [],
      toolchainOverrides: [],
    },
    toolchains: {},
    sources: {
      fir: {
        sourceId: "fir-pin",
        repository: "https://example.test/fir",
        revision: "a".repeat(40),
      },
    },
    components: {
      native: { adapter: "fir-native", files },
    },
  };
  const receiptFiles = {
    databaseFile: "artifact-builds.json",
    exampleFile: "examples/prettyM/example.json",
    testPackageFile: "examples/prettyM/tests.json",
  };
  await writeFile(receiptPath, canonicalJson(receipt));
  assert.doesNotMatch(JSON.stringify(receipt), /\/home\//);
  await assert.doesNotReject(() =>
    verifySourceBuildReceipt({
      receiptPath,
      databasePath,
      examplePath,
      testPackagePath,
      ...receiptFiles,
      exampleId: "prettyM",
      variantId: "default",
      buildId: "prettyM",
      setId,
      sources,
      components,
      seed,
    }),
  );
  receipt.database.file = "other-artifact-builds.json";
  await writeFile(receiptPath, canonicalJson(receipt));
  await assert.rejects(
    () =>
      verifySourceBuildReceipt({
        receiptPath,
        databasePath,
        examplePath,
        testPackagePath,
        ...receiptFiles,
        exampleId: "prettyM",
        variantId: "default",
        buildId: "prettyM",
        setId,
        sources,
        components,
        seed,
      }),
    /paths do not match/,
  );
  receipt.database.file = receiptFiles.databaseFile;
  await writeFile(receiptPath, canonicalJson(receipt));
  await writeFile(testPackagePath, '{"tests":"changed"}\n');
  await assert.rejects(
    () =>
      verifySourceBuildReceipt({
        receiptPath,
        databasePath,
        examplePath,
        testPackagePath,
        ...receiptFiles,
        exampleId: "prettyM",
        variantId: "default",
        buildId: "prettyM",
        setId,
        sources,
        components,
        seed,
      }),
    /inputs do not match/,
  );
  await writeFile(testPackagePath, '{"tests":true}\n');
  await writeFile(join(seed, artifactPath), "changed\n");
  await assert.rejects(
    () =>
      verifySourceBuildReceipt({
        receiptPath,
        databasePath,
        examplePath,
        testPackagePath,
        ...receiptFiles,
        exampleId: "prettyM",
        variantId: "default",
        buildId: "prettyM",
        setId,
        sources,
        components,
        seed,
      }),
    /file changed after validation/,
  );
});

test("verifies an example-neutral artifact-set manifest", async () => {
  const directory = join(scratch, "generic-manifest");
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, "illuminate/payload"), { recursive: true });
  await writeFile(
    join(directory, "illuminate/payload/player.wasm"),
    "wasm\n",
  );
  const files = {
    "illuminate/payload/player.wasm": await fileRecord(
      join(directory, "illuminate/payload/player.wasm"),
    ),
  };
  await writeFile(
    join(directory, "ARTIFACT_SET.json"),
    canonicalJson({
      schemaVersion: 2,
      kind: "browser-benchmarks/artifact-set",
      example: { id: "illuminate", variant: "default" },
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

test("rejects artifact-set manifests without a safe set ID", async () => {
  const directory = join(scratch, "unsafe-set-id");
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, "prettyM"), { recursive: true });
  const payloadPath = join(directory, "prettyM/payload.bin");
  await writeFile(payloadPath, "payload\n");
  const files = {
    "prettyM/payload.bin": await fileRecord(payloadPath),
  };
  for (const setId of [undefined, "", "../unsafe"]) {
    await writeFile(
      join(directory, "ARTIFACT_SET.json"),
      canonicalJson({
        schemaVersion: 2,
        kind: "browser-benchmarks/artifact-set",
        example: { id: "prettyM" },
        setId,
        files,
      }),
    );
    await assert.rejects(
      () => verifyArtifactSet(directory),
      /no safe set ID/,
    );
  }
});

test("stages a verified example namespace without replacing siblings", async () => {
  const directory = join(scratch, "illuminate-set");
  const artifactsDir = join(scratch, "staged-examples");
  const destination = join(artifactsDir, "illuminate/default");
  await rm(directory, { recursive: true, force: true });
  await rm(artifactsDir, { recursive: true, force: true });
  await mkdir(join(artifactsDir, "prettyM/default"), { recursive: true });
  await writeFile(join(artifactsDir, "prettyM/default/keep.txt"), "sibling\n");
  await mkdir(join(artifactsDir, "illuminate/alternate"), { recursive: true });
  await writeFile(
    join(artifactsDir, "illuminate/alternate/keep.txt"),
    "variant sibling\n",
  );
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "old.txt"), "old\n");
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
      example: { id: "illuminate", variant: "default" },
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
      "scripts/stage-artifact-set.mjs",
      relative(appRoot, directory),
      "--artifacts-dir",
      relative(appRoot, artifactsDir),
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
  assert.equal(
    await readFile(join(artifactsDir, "prettyM/default/keep.txt"), "utf8"),
    "sibling\n",
  );
  assert.equal(
    await readFile(
      join(artifactsDir, "illuminate/alternate/keep.txt"),
      "utf8",
    ),
    "variant sibling\n",
  );
  await assert.rejects(() => readFile(join(destination, "old.txt")), /ENOENT/);
});

test("artifact fetch requires an explicit lock", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/fetch-artifact-set.mjs"],
    { cwd: appRoot, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /select an artifact-set lock with --lock PATH/);
});

test("rejects undeclared artifact-set members", async () => {
  const directory = join(scratch, "unexpected-member");
  await mkdir(join(directory, "prettyM"), { recursive: true });
  const payloadPath = join(directory, "prettyM/payload.bin");
  await writeFile(payloadPath, "payload\n");
  const files = {
    "prettyM/payload.bin": await fileRecord(payloadPath),
  };
  await writeFile(
    join(directory, "ARTIFACT_SET.json"),
    canonicalJson({
      schemaVersion: 2,
      kind: "browser-benchmarks/artifact-set",
      example: { id: "prettyM", variant: "default" },
      setId: "prettyM-test",
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
  await writeFile(join(directory, "surprise.txt"), "not declared\n");
  await assert.rejects(() => verifyArtifactSet(directory), /unexpected member/);
});
