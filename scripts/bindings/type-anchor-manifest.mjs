/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

import {
  irpkgGeneratorFailureMessage,
  prepareVirIrpkgSync,
} from "../packages/irpkg-generator.mjs";
import {
  assertDistinctModulePackageOutputs,
  normalizeModulePackageConfig,
} from "../packages/module-package-config.mjs";
import { readIrPackageFile } from "../packages/irpkg-format.mjs";
import { repositoryRoot as root } from "../repository-paths.mjs";
import { emitGeneratedFile, requiredValue } from "./tool-utils.mjs";

function usage() {
  console.log(`usage: node scripts/bindings/generate-lean-type-anchor-manifest.mjs --module NAME --roots FILE --out FILE [options]

Generate an interface manifest fixture from a compiled Lean module through
the real VIR package generator. Generated artifacts normally stay under build/.

Options:
  --module NAME   Lake module containing descriptor-forcing wrappers.
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
  let module = null;
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
        return null;
      case "--module":
        module = requiredValue(argv, ++index, "--module");
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
        throw new Error(`unknown option ${arg}`);
    }
  }
  if (module === null) throw new Error("--module is required");
  if (roots === null) throw new Error("--roots is required");
  if (out === null) throw new Error("--out is required");
  const stem = basename(out).replace(/\.manifest\.json$/u, "");
  packagePath ??= resolve(root, "build/type-descriptors", `${stem}.irpkg`);
  return { module, roots, aliases, out, packagePath, report, check };
}

export async function runTypeAnchorManifestCli(argv) {
  const cli = parseArgs(argv);
  if (cli === null) return 0;
  const roots = await readLines(cli.roots);
  if (roots.length === 0) {
    throw new Error(`${relative(root, cli.roots)} has no roots`);
  }
  const aliases = cli.aliases === null ? [] : await readAliases(cli.aliases);
  const config = normalizeModulePackageConfig({
    version: 2,
    module: cli.module,
    roots,
    package: cli.packagePath,
    ...(cli.report === null ? {} : { report: cli.report }),
  });
  assertDistinctModulePackageOutputs([config], root);
  const { packagePath, reportPath, targetArgs } = config;
  if (
    [packagePath, reportPath].some((path) => resolve(root, path) === cli.out)
  ) {
    throw new Error(
      "manifest output must differ from package and report paths",
    );
  }

  const generator = prepareVirIrpkgSync({
    lakeTargets: [`+${config.module}`],
  });
  if (!generator.ok) throw new Error(irpkgGeneratorFailureMessage(generator));

  await mkdir(dirname(packagePath), { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });
  const result = spawnSync(
    generator.path,
    [packagePath, reportPath, ...targetArgs],
    {
      cwd: root,
      env: generator.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if ((result.status ?? 1) !== 0) {
    process.stderr.write(result.stderr);
    process.stdout.write(result.stdout);
    throw new Error(
      `Lean anchor package generation failed; see ${relative(root, reportPath)}`,
    );
  }

  const info = await readIrPackageFile(packagePath);
  const manifest = normalizeTypeAnchorManifest(info.manifest, aliases);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const action = await emitGeneratedFile(cli.out, text, {
    check: cli.check,
    root,
    staleHint: "rerun the corresponding generation step without --check",
  });
  console.log(
    `${action} ${relative(root, cli.out)} (${manifest.exports.length} exports)`,
  );
  return 0;
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
  // Compiled provenance is already location-independent. It names modules,
  // not filesystem paths to canonicalize or reinterpret as source links.
  return {
    ...manifest,
    metadata: {
      ...manifest.metadata,
      ...(aliases.length === 0 ? {} : { typeAnchorAliases: aliases }),
    },
  };
}
