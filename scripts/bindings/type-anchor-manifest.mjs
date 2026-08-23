#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { irpkgGeneratorFailureMessage, prepareVirIrpkgSync } from "../irpkg-generator.mjs";
import { readIrPackageFile } from "../irpkg-format.mjs";
import { emitGeneratedFile, fail, requiredValue } from "./tool-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function usage() {
  console.error(`usage: node scripts/bindings/generate-lean-type-anchor-manifest.mjs --source FILE --roots FILE --out FILE [options]

Generate a checked-in interface manifest fixture through the real VIR package
generator. Generated .irpkg and report files stay under build/.

Options:
  --source FILE   Lean source containing descriptor-forcing wrappers.
  --roots FILE    Root declaration names, one per line.
  --aliases FILE  Reviewed Lean type aliases to add to manifest metadata.
  --out FILE      Write normalized manifest JSON to FILE.
  --package FILE  Generated .irpkg path. Defaults under build/type-descriptors.
  --report FILE   Generator report path. Defaults beside --package.
  --check         Compare generated manifest with --out instead of writing it.
  -h, --help      Show this help.
`);
}

function parseArgs(argv) {
  let source = null;
  let roots = null;
  let aliases = null;
  let out = null;
  let packagePath = null;
  let report = null;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      case "--source":
        source = resolve(root, requiredValue(argv, ++index, "--source"));
        break;
      case "--roots":
        roots = resolve(root, requiredValue(argv, ++index, "--roots"));
        break;
      case "--aliases":
        aliases = resolve(root, requiredValue(argv, ++index, "--aliases"));
        break;
      case "--out":
        out = resolve(root, requiredValue(argv, ++index, "--out"));
        break;
      case "--package":
        packagePath = resolve(root, requiredValue(argv, ++index, "--package"));
        break;
      case "--report":
        report = resolve(root, requiredValue(argv, ++index, "--report"));
        break;
      case "--check":
        check = true;
        break;
      default:
        fail(`unknown option ${arg}`);
    }
  }
  if (source === null) fail("--source is required");
  if (roots === null) fail("--roots is required");
  if (out === null) fail("--out is required");
  const stem = out.split("/").pop().replace(/\.manifest\.json$/u, "");
  packagePath ??= resolve(root, "build/type-descriptors", `${stem}.irpkg`);
  report ??= packagePath.replace(/\.irpkg$/u, ".report.md");
  return { source, roots, aliases, out, packagePath, report, check };
}

export async function runTypeAnchorManifestCli(argv) {
  const cli = parseArgs(argv);
  const roots = await readLines(cli.roots);
  if (roots.length === 0) fail(`${relative(root, cli.roots)} has no roots`);
  const aliases = cli.aliases === null ? [] : await readAliases(cli.aliases);

  const generator = prepareVirIrpkgSync(root);
  if (!generator.ok) fail(irpkgGeneratorFailureMessage(generator));

  await mkdir(dirname(cli.packagePath), { recursive: true });
  await mkdir(dirname(cli.report), { recursive: true });
  const result = spawnSync(generator.path, [
    cli.packagePath,
    cli.report,
    "--target",
    repoRelativePath(cli.source),
    ...roots,
  ], {
    cwd: root,
    env: generator.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((result.status ?? 1) !== 0) {
    process.stderr.write(result.stderr);
    process.stdout.write(result.stdout);
    fail(`Lean anchor package generation failed; see ${relative(root, cli.report)}`);
  }

  const info = await readIrPackageFile(cli.packagePath);
  const manifest = normalizeTypeAnchorManifest(info.manifest, aliases);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const action = await emitGeneratedFile(cli.out, text, {
    check: cli.check,
    root,
    staleHint: "rerun the corresponding generation step without --check",
  });
  console.log(`${action} ${relative(root, cli.out)} (${manifest.exports.length} exports)`);
}

async function readLines(path) {
  return (await readFile(path, "utf8"))
    .split(/\r?\n/gu)
    .map((line) => line.replace(/#.*/u, "").trim())
    .filter((line) => line.length !== 0);
}

async function readAliases(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value?.version !== 1 || !Array.isArray(value.aliases)) {
    throw new Error("alias file must be { version: 1, aliases: [...] }");
  }
  return value.aliases;
}

export function normalizeTypeAnchorManifest(manifest, aliases) {
  const metadata = { ...manifest.metadata, generatedAt: "normalized" };
  if (Array.isArray(metadata.targets)) {
    metadata.targets = metadata.targets.map((target) => ({
      ...target,
      ...(typeof target.source === "string" ? { source: repoRelativePath(target.source) } : {}),
    }));
  }
  if (aliases.length !== 0) metadata.typeAnchorAliases = aliases;
  return {
    ...manifest,
    metadata,
    exports: (manifest.exports ?? []).map(normalizeSourceField),
    hostImports: (manifest.hostImports ?? []).map(normalizeSourceField),
  };
}

function normalizeSourceField(entry) {
  return {
    ...entry,
    ...(typeof entry.source === "string" ? { source: repoRelativePath(entry.source) } : {}),
  };
}

function repoRelativePath(path) {
  return relative(root, isAbsolute(path) ? path : resolve(root, path));
}
