#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { irpkgGeneratorFailureMessage, prepareVirIrpkgSync } from "./irpkg-generator.mjs";
import { readIrPackageFile } from "./irpkg-format.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.error(`usage: node scripts/generate-lean-type-anchor-manifest.mjs --source FILE --roots FILE --out FILE [options]

Generate a checked-in Lean VIR interface manifest fixture from a real Lean
anchor module and a generated .irpkg.

Options:
  --source FILE   Lean source containing anchor wrapper declarations.
  --roots FILE    Root declaration names, one per line.
  --out FILE      Write normalized manifest JSON to FILE.
  --package FILE  Generated .irpkg path. Defaults under build/type-descriptors.
  --report FILE   Generator report path. Defaults beside --package.
  --check         Compare generated manifest with --out instead of writing it.
  -h, --help      Show this help.
`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let source = null;
  let roots = null;
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
  if (packagePath === null) {
    const stem = out.split("/").pop().replace(/\.manifest\.json$/u, "");
    packagePath = resolve(root, "build/type-descriptors", `${stem}.irpkg`);
  }
  if (report === null) {
    report = packagePath.replace(/\.irpkg$/u, ".report.md");
  }
  return { source, roots, out, packagePath, report, check };
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) fail(`${option} requires a value`);
  return value;
}

const cli = parseArgs(process.argv.slice(2));
const roots = await readRootNames(cli.roots);
if (roots.length === 0) fail(`${relative(root, cli.roots)} has no roots`);
const sourceText = await readFile(cli.source, "utf8");

const generator = prepareVirIrpkgSync(root);
if (!generator.ok) {
  console.error(`error: ${irpkgGeneratorFailureMessage(generator)}`);
  process.exit(generator.status);
}

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
const manifest = normalizeManifest(info.manifest, inferTypeAnchorAliases(info.manifest, sourceText));
const text = `${JSON.stringify(manifest, null, 2)}\n`;

if (cli.check) {
  const existing = await readFile(cli.out, "utf8");
  if (existing.replace(/\r\n/g, "\n") !== text) {
    fail(`${relative(root, cli.out)} is stale; run npm run generate:lean-type-anchor-manifest`);
  }
  console.log(`validated ${relative(root, cli.out)}`);
} else {
  await writeFile(cli.out, text);
  console.log(`wrote ${relative(root, cli.out)} (${manifest.exports.length} exports)`);
}

async function readRootNames(path) {
  return (await readFile(path, "utf8"))
    .split(/\r?\n/gu)
    .map((line) => line.replace(/#.*/u, "").trim())
    .filter((line) => line.length !== 0);
}

function normalizeManifest(manifest, typeAnchorAliases) {
  const metadata = {
    ...manifest.metadata,
    generatedAt: "normalized",
  };
  if (Array.isArray(manifest.metadata?.targets)) {
    metadata.targets = manifest.metadata.targets.map((target) => ({
      ...target,
      ...(typeof target.source === "string" ? { source: repoRelativePath(target.source) } : {}),
    }));
  }
  if (typeAnchorAliases.length !== 0) metadata.typeAnchorAliases = typeAnchorAliases;
  return {
    ...manifest,
    metadata,
    exports: (manifest.exports ?? []).map((entry) => normalizeSourceField(entry)),
    hostImports: (manifest.hostImports ?? []).map((entry) => normalizeSourceField(entry)),
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

function inferTypeAnchorAliases(manifest, sourceText) {
  const blocks = leanDefBlocks(sourceText);
  const aliases = [];
  const seen = new Set();
  for (const entry of manifest.exports ?? []) {
    const defName = entry.entry.split(".").pop();
    const block = blocks.get(defName);
    if (block === undefined) continue;
    for (const alias of inferAliasesForBlock(block, entry)) {
      const key = `${alias.lean}\0${alias.via}\0${alias.descriptor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      aliases.push(alias);
    }
  }
  aliases.sort((left, right) => `${left.lean}\0${left.via}`.localeCompare(`${right.lean}\0${right.via}`));
  return aliases;
}

function leanDefBlocks(sourceText) {
  const blocks = new Map();
  const matches = [...sourceText.matchAll(/^\s*def\s+([A-Za-z0-9_'.]+)\b/gmu)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index;
    const end = matches[index + 1]?.index ?? sourceText.length;
    blocks.set(match[1], sourceText.slice(start, end));
  }
  return blocks;
}

function inferAliasesForBlock(block, entry) {
  const aliases = [];
  const resourceLeanNames = [];
  for (const inner of leanJsResourceTypes(block)) {
    const lean = baseLeanName(inner);
    if (!isAnchorableLeanName(lean)) continue;
    resourceLeanNames.push(lean);
    aliases.push({
      lean,
      type: `Lean.Vir.Js ${parenthesizeLeanType(inner)}`,
      via: entry.entry,
      source: repoRelativePath(entry.source ?? cli.source),
      descriptor: "resource",
    });
  }
  if (/\bLean\.Vir\.React\.Component\b/u.test(block)) {
    aliases.push({
      lean: "Lean.Vir.React.Component",
      type: "Lean.Vir.React.Component",
      via: entry.entry,
      source: repoRelativePath(entry.source ?? cli.source),
      descriptor: "function",
      shapeFrom: "arg:component",
      ...(resourceLeanNames.length === 0 ? {} : { resultResource: resourceLeanNames[resourceLeanNames.length - 1] }),
    });
  }
  return aliases;
}

function leanJsResourceTypes(text) {
  const marker = "Lean.Vir.Js";
  const types = [];
  let offset = 0;
  while (true) {
    const index = text.indexOf(marker, offset);
    if (index === -1) return types;
    let cursor = index + marker.length;
    while (/\s/u.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] === "(") {
      const end = matchingParen(text, cursor);
      if (end !== -1) {
        types.push(text.slice(cursor + 1, end).trim());
        offset = end + 1;
        continue;
      }
    }
    const name = readLeanName(text, cursor);
    if (name !== null) {
      types.push(name);
      offset = cursor + name.length;
    } else {
      offset = cursor + 1;
    }
  }
}

function matchingParen(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function readLeanName(text, start) {
  const match = /^[A-Za-z0-9_'.]+(?:\.[A-Za-z0-9_'.]+)*/u.exec(text.slice(start));
  return match?.[0] ?? null;
}

function baseLeanName(type) {
  return readLeanName(stripOuterParens(type).trim(), 0);
}

function stripOuterParens(type) {
  let text = type.trim();
  while (text.startsWith("(") && matchingParen(text, 0) === text.length - 1) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function isAnchorableLeanName(name) {
  return typeof name === "string" && name.startsWith("Lean.Vir.") && name !== "Lean.Vir.Js";
}

function parenthesizeLeanType(type) {
  const text = stripOuterParens(type).replace(/\s+/gu, " ").trim();
  return /\s/u.test(text) ? `(${text})` : text;
}
