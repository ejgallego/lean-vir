import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "./artifact-set-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function usage() {
  console.log(`Usage: node scripts/stage-illuminate-rehearsal.mjs --source PATH [options]

Stage an explicitly local, non-publishable Illuminate benchmark rehearsal.
PATH must be the root of a prepared Illuminate checkout containing test_output.
The staged files remain inside this application's ignored artifacts directory.

  --native-package PATH  tested FIR package (default: PATH/test_output/native)
  --vir-sdk PATH         tested VIR SDK (default: PATH/test_output/vir/sdk)`);
}

function parseArgs(argv) {
  let source = null;
  let nativePackage = null;
  let virSdk = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source") source = argv[++index];
    else if (argument === "--native-package") nativePackage = argv[++index];
    else if (argument === "--vir-sdk") virSdk = argv[++index];
    else if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  if (!source) throw new Error("pass --source PATH");
  const sourceRoot = resolve(source);
  return {
    source: sourceRoot,
    nativePackage: resolve(
      nativePackage || join(sourceRoot, "test_output/native"),
    ),
    virSdk: resolve(virSdk || join(sourceRoot, "test_output/vir/sdk")),
  };
}

function git(source, args) {
  return execFileSync("git", ["-C", source, ...args], {
    encoding: "utf8",
  }).trim();
}

function gitOptional(source, args) {
  try {
    return git(source, args) || null;
  } catch {
    return null;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function requireFile(path) {
  if (!(await stat(path).catch(() => null))?.isFile()) {
    throw new Error(`missing Illuminate rehearsal input: ${path}`);
  }
}

async function copyFile(source, destination) {
  await requireFile(source);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

async function verifyVirSdk(virSdk) {
  const artifactPath = join(virSdk, "lean-vir-artifact.json");
  await requireFile(artifactPath);
  const artifactBytes = await readFile(artifactPath);
  const artifact = JSON.parse(artifactBytes);
  if (artifact.name !== "lean-vir-sdk" || !Array.isArray(artifact.files)) {
    throw new Error("unsupported VIR SDK artifact manifest");
  }
  const seen = new Set();
  for (const file of artifact.files) {
    if (
      file === null ||
      typeof file !== "object" ||
      typeof file.path !== "string" ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      file.path.startsWith("/") ||
      file.path
        .split("/")
        .some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error("unsafe VIR SDK artifact manifest entry");
    }
    if (seen.has(file.path)) {
      throw new Error(
        `duplicate VIR SDK artifact manifest entry: ${file.path}`,
      );
    }
    seen.add(file.path);
    const path = join(virSdk, file.path);
    await requireFile(path);
    if (sha256(await readFile(path)) !== file.sha256) {
      throw new Error(`VIR SDK artifact checksum mismatch: ${file.path}`);
    }
  }
  for (const path of ["js/vir-runtime.js", "wasm/vir-upstream.wasm"]) {
    if (!seen.has(path)) {
      throw new Error(`VIR SDK artifact manifest is missing: ${path}`);
    }
  }
  return { artifact, artifactBytes };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = options.source;
  const nativePackage = options.nativePackage;
  const virSdk = options.virSdk;
  const expected = [
    "player_js/anim_core.js",
    "scripts/lib/vir-player-trace.mjs",
    "test_output/anim-comparison.html",
    "test_output/vir/module-sets/Illuminate/Animation/Vir.irpkg-set.json",
  ];
  await Promise.all(expected.map((path) => requireFile(join(source, path))));
  const { artifact: virArtifact, artifactBytes: virArtifactBytes } =
    await verifyVirSdk(virSdk);
  await Promise.all(
    [
      "BUILD.json",
      "SHA256SUMS",
      "illuminate-player-browser-adapter.mjs",
      "illuminate-player.wasm",
      "illuminate-player.wasm.json",
    ].map((path) => requireFile(join(nativePackage, path))),
  );

  execFileSync("sha256sum", ["--check", "SHA256SUMS"], {
    cwd: nativePackage,
    stdio: "inherit",
  });

  const destination = join(appRoot, "artifacts/illuminate");
  const next = join(appRoot, "artifacts/illuminate.next");
  await rm(next, { recursive: true, force: true });
  await mkdir(next, { recursive: true });

  await copyFile(
    join(source, "player_js/anim_core.js"),
    join(next, "workload/anim_core.js"),
  );
  await copyFile(
    join(source, "scripts/lib/vir-player-trace.mjs"),
    join(next, "workload/vir-player-trace.mjs"),
  );
  await cp(nativePackage, join(next, "native"), {
    recursive: true,
  });
  await cp(virSdk, join(next, "vir/sdk"), {
    recursive: true,
  });
  await cp(
    join(source, "test_output/vir/module-sets"),
    join(next, "vir/module-sets"),
    { recursive: true },
  );

  const comparisonHtml = await readFile(
    join(source, "test_output/anim-comparison.html"),
    "utf8",
  );
  const marker = "var examples = ";
  const start = comparisonHtml.indexOf(marker);
  const jsonStart = start + marker.length;
  const jsonEnd = comparisonHtml.indexOf(";\n", jsonStart);
  if (start === -1 || jsonEnd === -1) {
    throw new Error("Illuminate comparison examples are missing or malformed");
  }
  const examples = JSON.parse(comparisonHtml.slice(jsonStart, jsonEnd));
  await writeFile(
    join(next, "workload/examples.json"),
    canonicalJson(examples),
  );

  const nativeBuildBytes = await readFile(join(nativePackage, "BUILD.json"));
  const nativeBuild = JSON.parse(nativeBuildBytes);
  const sourceBranch = gitOptional(source, ["symbolic-ref", "--short", "HEAD"]);
  const configuredRemote = sourceBranch
    ? gitOptional(source, ["config", `branch.${sourceBranch}.remote`])
    : null;
  const sourceRemote =
    configuredRemote && configuredRemote !== "." ? configuredRemote : "origin";
  const receipt = {
    schemaVersion: 1,
    kind: "illuminate-player/local-rehearsal",
    publishable: false,
    source: {
      repository: git(source, ["remote", "get-url", sourceRemote]),
      remote: sourceRemote,
      branch: sourceBranch,
      upstream: gitOptional(source, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]),
      commit: git(source, ["rev-parse", "HEAD"]),
      dirty: git(source, ["status", "--porcelain"]) !== "",
    },
    inputs: {
      native: {
        buildSha256: sha256(nativeBuildBytes),
        schemaVersion: nativeBuild.schemaVersion,
        fir: nativeBuild.sources?.fir,
        illuminate: nativeBuild.sources?.illuminate,
        wasm: nativeBuild.wasm,
        browserAdapter: nativeBuild.capabilities?.browserAdapter,
      },
      vir: {
        artifactSha256: sha256(virArtifactBytes),
        sourceCommit: virArtifact.gitCommit,
        sourceDirty: virArtifact.gitDirty,
        leanToolchain: virArtifact.leanToolchain,
        packageFormatVersion: virArtifact.packageFormatVersion,
        manifestVersion: virArtifact.manifestVersion,
      },
      exampleCount: examples.length,
    },
  };
  await writeFile(join(next, "REHEARSAL.json"), canonicalJson(receipt));

  const previous = `${destination}.previous`;
  await rm(previous, { recursive: true, force: true });
  if (await stat(destination).catch(() => null)) {
    await rename(destination, previous);
  }
  try {
    await rename(next, destination);
  } catch (error) {
    if (await stat(previous).catch(() => null)) {
      await rename(previous, destination);
    }
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
  console.log(
    `staged Illuminate rehearsal: ${relative(appRoot, destination)} (${examples.length} examples)`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
