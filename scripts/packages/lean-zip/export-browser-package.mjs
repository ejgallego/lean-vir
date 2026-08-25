#!/usr/bin/env node

import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { runSync } from "../../process-utils.mjs";
import { repositoryRoot } from "../../repository-paths.mjs";
import {
  buildVirBrowserRuntime,
  checkoutRoot,
  fileRecord,
  gitIdentity,
  parseProducerArguments,
  readMatchingWorkloadPackage,
  requireToolchain,
  requireFreshOutput,
  sha256,
  writeChecksums,
} from "../vir-client-package-lib.mjs";

const defaultProducer = repositoryRoot;
const packageEntry = "VirLeanZipAcceptance.compressRaw";

const usage = `Usage: node scripts/packages/lean-zip/export-browser-package.mjs [options]

Build a client-native VIR runtime and lean-zip package into a fresh directory.

  --output PATH                 fresh caller-owned output directory
  --checkout producer=PATH      exact VIR checkout
  --checkout runtime=PATH       exact Lean source checkout
  --checkout client=PATH        exact lean-zip checkout
  --package workload=PATH       lean-zip source/oracle package`;

async function main() {
  const options = parseProducerArguments(process.argv.slice(2), {
    checkoutRoles: ["producer", "runtime", "client"],
    packageRoles: ["workload"],
    defaultProducer,
    usage,
  });
  if (options === null) return;
  const output = await requireFreshOutput(options.output);
  const producer = await checkoutRoot(
    options.checkouts.get("producer"),
    "producer",
  );
  const runtime = await checkoutRoot(
    options.checkouts.get("runtime"),
    "runtime",
  );
  const client = await checkoutRoot(options.checkouts.get("client"), "client");
  const sourceIdentities = {
    vir: gitIdentity(producer, "VIR"),
    lean: gitIdentity(runtime, "Lean"),
    leanZip: gitIdentity(client, "lean-zip"),
  };
  const { root: workload, build: workloadBuild } =
    await readMatchingWorkloadPackage(options.packages.get("workload"), {
      kind: "lean-zip/browser-benchmark-source",
      source: sourceIdentities.leanZip,
      label: "lean-zip",
    });
  for (const [root, label] of [
    [producer, "VIR"],
    [client, "lean-zip"],
  ]) {
    await requireToolchain(root, label, "leanprover/lean4:v4.33.0");
  }
  try {
    const runtimeBuild = await buildVirBrowserRuntime({
      producer,
      runtime,
      output,
      environment: {
        VIR_NATIVE_EXTERN_MANIFEST: join(
          client,
          "lean-vir-native-externs.json",
        ),
      },
    });
    runSync("lake", ["build", "Zip.Wasm.Entry"], { cwd: client });

    const packageFile = "lean-zip.irpkg";
    const reportFile = "lean-zip.report.md";
    runSync(
      "lake",
      [
        "env",
        join(producer, ".lake/build/bin/vir_irpkg"),
        join(output, packageFile),
        join(output, reportFile),
        "--target",
        join(producer, "fixtures/lean-zip/VirLeanZipAcceptance/Exports.lean"),
        packageEntry,
      ],
      {
        cwd: client,
        env: {
          ...process.env,
          LEAN_PATH: [
            join(producer, ".lake/build/lib/lean"),
            process.env.LEAN_PATH,
          ]
            .filter(Boolean)
            .join(delimiter),
        },
      },
    );
    await rm(join(output, reportFile));
    await copyFile(
      join(producer, "scripts/packages/lean-zip/browser-package-smoke.mjs"),
      join(output, "smoke.mjs"),
    );

    const oracle = JSON.parse(
      await readFile(
        join(workload, workloadBuild.workload.nativeOracle),
        "utf8",
      ),
    );
    const vector = oracle.vectors.find(({ id }) => id === "repeated-1k");
    const expected = vector?.expected.find(({ level }) => level === 6);
    if (!vector || !expected)
      throw new Error("workload package omits the VIR smoke vector");
    await copyFile(
      join(workload, vector.input.file),
      join(output, "smoke.input.bin"),
    );
    await copyFile(
      join(workload, expected.file),
      join(output, "smoke.expected.raw"),
    );

    const payloadPaths = [
      "lean-vir/js/vir-runtime.js",
      "lean-vir/wasm/vir-upstream.wasm",
      packageFile,
      "smoke.expected.raw",
      "smoke.input.bin",
      "smoke.mjs",
    ];
    const files = await Promise.all(
      payloadPaths.map((path) => fileRecord(output, path)),
    );
    const build = {
      schemaVersion: 1,
      kind: "vir/lean-zip-browser-package",
      producerProtocol: "browser-benchmarks/source-package/v1",
      entry: packageEntry,
      sources: sourceIdentities,
      runtime: {
        profile: "client-native",
        nativeExternManifest: {
          sourceFile: "lean-vir-native-externs.json",
          sha256: sha256(
            await readFile(join(client, "lean-vir-native-externs.json")),
          ),
        },
        wasiSdk: runtimeBuild.wasiSdk,
        module: "lean-vir/js/vir-runtime.js",
        wasm: "lean-vir/wasm/vir-upstream.wasm",
      },
      package: { file: packageFile },
      smoke: {
        input: "smoke.input.bin",
        expected: "smoke.expected.raw",
        level: 6,
      },
      files,
    };
    await writeFile(
      join(output, "BUILD.json"),
      `${JSON.stringify(build, null, 2)}\n`,
    );
    const checksumPaths = ["BUILD.json", ...payloadPaths];
    await writeChecksums(output, checksumPaths);
    runSync(process.execPath, ["smoke.mjs"], { cwd: output });
    console.log(`exported VIR lean-zip browser package to ${output}`);
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
