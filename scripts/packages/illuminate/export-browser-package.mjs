#!/usr/bin/env node

import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

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
  writeChecksums,
} from "../vir-client-package-lib.mjs";

const defaultProducer = repositoryRoot;
const packageEntry = "Illuminate.Animation.Vir.replayTraceTyped";
const sourceFile = "fixtures/illuminate/VirIlluminateAcceptance/Exports.lean";
const packageFile = "module-set/Vir.irpkg";
const descriptorFile = "module-set/Vir.irpkg-set.json";
const shardDirectory = "module-set/Vir.parts";
const rootModule = "VirIlluminateAcceptance.Exports";

const usage = `Usage: node scripts/packages/illuminate/export-browser-package.mjs [options]

Consume a validated Illuminate workload and build its matching VIR browser
package in a fresh caller-owned directory.

  --output PATH                 fresh caller-owned output directory
  --checkout producer=PATH      exact VIR checkout
  --checkout runtime=PATH       exact Lean source checkout
  --checkout client=PATH        exact Illuminate checkout
  --package workload=PATH       Illuminate source/oracle package`;

async function createSourceView(client, producer, parent) {
  const workspace = await mkdtemp(join(parent, ".illuminate-source-view-"));
  try {
    const sourceView = join(workspace, "source");
    const archive = join(workspace, "source.tar");
    await mkdir(sourceView);
    runSync("git", [
      "-C",
      client,
      "archive",
      "--format=tar",
      `--output=${archive}`,
      "HEAD",
    ]);
    runSync("tar", ["-xf", archive, "-C", sourceView]);
    await symlink(producer, join(sourceView, "vir"), "dir");
    return { workspace, sourceView };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

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
  const sources = {
    vir: gitIdentity(producer, "VIR"),
    lean: gitIdentity(runtime, "Lean"),
    illuminate: gitIdentity(client, "Illuminate"),
  };
  const { root: workload, build: workloadBuild } =
    await readMatchingWorkloadPackage(options.packages.get("workload"), {
      kind: "illuminate/browser-benchmark-source",
      source: sources.illuminate,
      label: "Illuminate",
    });
  const toolchain = await requireToolchain(
    producer,
    "VIR",
    "leanprover/lean4:v4.33.0",
  );
  await requireToolchain(
    client,
    "Illuminate",
    "leanprover/lean4:v4.33.0",
  );

  let workspace = null;
  try {
    const runtimeBuild = await buildVirBrowserRuntime({
      producer,
      runtime,
      output,
    });
    const sourceView = await createSourceView(
      client,
      producer,
      dirname(output),
    );
    workspace = sourceView.workspace;
    runSync("lake", ["build", "Illuminate.Animation.Player"], {
      cwd: sourceView.sourceView,
    });

    await mkdir(join(output, "module-set"), { recursive: true });
    await mkdir(join(output, shardDirectory), { recursive: true });
    const reportFile = join(output, "module-set/Vir.report.md");
    runSync(
      "lake",
      [
        "env",
        join(producer, ".lake/build/bin/vir_irpkg"),
        join(output, packageFile),
        reportFile,
        "--module-set-output",
        join(output, descriptorFile),
        join(output, shardDirectory),
        rootModule,
        "Vir.irpkg",
        "Vir.parts",
        "--target",
        join(producer, sourceFile),
        packageEntry,
      ],
      { cwd: sourceView.sourceView },
    );
    await rm(reportFile);
    const descriptor = JSON.parse(
      await readFile(join(output, descriptorFile), "utf8"),
    );
    const packagePaths = descriptor.packages.map(
      ({ path }) => `module-set/${path}`,
    );
    const pathsAreCanonical = packagePaths.every((path, index) =>
      index + 1 === packagePaths.length
        ? path === packageFile
        : path === `module-set/Vir.parts/${index}.irpkg`,
    );
    if (packagePaths.length === 0 || !pathsAreCanonical) {
      throw new Error(
        `unexpected Illuminate VIR package members: ${packagePaths.join(", ")}`,
      );
    }

    await copyFile(
      join(workload, workloadBuild.workload.semanticInputs),
      join(output, "smoke.examples.json"),
    );
    await copyFile(
      join(workload, workloadBuild.workload.virProjection),
      join(output, "smoke.vir-player-trace.mjs"),
    );
    await copyFile(
      join(producer, "scripts/packages/illuminate/browser-package-smoke.mjs"),
      join(output, "smoke.mjs"),
    );

    const payloadPaths = [
      "lean-vir/js/vir-runtime.js",
      "lean-vir/wasm/vir-upstream.wasm",
      descriptorFile,
      ...packagePaths,
      "smoke.examples.json",
      "smoke.vir-player-trace.mjs",
      "smoke.mjs",
    ];
    const build = {
      schemaVersion: 1,
      kind: "vir/illuminate-browser-package",
      producerProtocol: "browser-benchmarks/source-package/v1",
      entry: packageEntry,
      sources,
      runtime: {
        profile: "client-native",
        leanToolchain: toolchain,
        wasiSdk: runtimeBuild.wasiSdk,
        module: "lean-vir/js/vir-runtime.js",
        wasm: "lean-vir/wasm/vir-upstream.wasm",
      },
      package: {
        file: packageFile,
        setDescriptor: descriptorFile,
      },
      workload: {
        contract: workloadBuild.workload.contract,
        sourceCommit: workloadBuild.source.commit,
        smokeExamples: "smoke.examples.json",
        smokeVirProjection: "smoke.vir-player-trace.mjs",
      },
      files: await Promise.all(
        payloadPaths.map((path) => fileRecord(output, path)),
      ),
    };
    await writeFile(
      join(output, "BUILD.json"),
      `${JSON.stringify(build, null, 2)}\n`,
    );
    await writeChecksums(output, ["BUILD.json", ...payloadPaths]);
    runSync(process.execPath, ["smoke.mjs"], { cwd: output });
    console.log(`exported VIR Illuminate browser package to ${output}`);
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  } finally {
    if (workspace !== null) {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
