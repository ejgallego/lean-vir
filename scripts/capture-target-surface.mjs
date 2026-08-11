/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeSurfaceGraph, renderTargetSurfaceMarkdown } from "./analyze-surface-graph.mjs";
import { runAsync } from "./process-utils.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const exporter = join(repoRoot, "tools", "ExportSurfaceGraph.lean");

const options = parseArgs(process.argv.slice(2));
const project = resolve(options.project);
const sourcePath = isAbsolute(options.source) ? options.source : join(project, options.source);
const outputPrefix = resolve(options.outputPrefix);
const graphPath = `${outputPrefix}.graph.json`;
const jsonPath = `${outputPrefix}.json`;
const markdownPath = `${outputPrefix}.md`;
const temporary = await mkdtemp(join(tmpdir(), "vir-target-surface-"));

try {
  const capabilitiesPath = join(temporary, "capabilities.json");
  const capabilityMarkdownPath = join(temporary, "capabilities.md");
  await runChecked(
    join(repoRoot, ".lake", "build", "bin", "vir_surface"),
    [
      capabilitiesPath,
      capabilityMarkdownPath,
      "--module", "Init.Prelude",
      "--root", "id",
    ],
    repoRoot,
  );
  const capabilities = JSON.parse(await readFile(capabilitiesPath, "utf8"));
  const supportRoots = [...new Set(
    capabilities.runtimeCapabilities.nativeExterns.flatMap((entry) => entry.deps ?? []),
  )].sort(compareText);
  await mkdir(dirname(graphPath), { recursive: true });
  const exporterArgs = [
    "env", "lean", "--run", exporter,
    "--output", graphPath,
    "--source", sourcePath,
    "--module", options.module,
    ...options.roots.flatMap((root) => ["--root", root]),
    ...supportRoots.flatMap((root) => ["--support-root", root]),
  ];
  await runChecked("lake", exporterArgs, project);
  let graphBytes = await readFile(graphPath);
  const graph = JSON.parse(graphBytes.toString("utf8"));
  graph.capture.source = portableSourceLabel(project, sourcePath);
  graphBytes = Buffer.from(`${JSON.stringify(graph)}\n`);
  await writeFile(graphPath, graphBytes);
  const graphSha256 = createHash("sha256").update(graphBytes).digest("hex");
  const sourceSha256 = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
  const report = analyzeSurfaceGraph(graph, capabilities, { graphSha256, sourceSha256 });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report)}\n`),
    writeFile(markdownPath, renderTargetSurfaceMarkdown(report)),
  ]);
  console.log(
    `target surface: ${report.counts.runnable}/${report.counts.total} closure-complete; `
      + `${report.reachableBlockers.length} blockers; wrote ${graphPath}, ${jsonPath}, and ${markdownPath}`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function parseArgs(args) {
  const options = { roots: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (["--project", "--source", "--module", "--root", "--output-prefix"].includes(argument)) {
      if (!value) usage(`missing value for ${argument}`);
      index += 1;
      if (argument === "--root") options.roots.push(value);
      else options[toCamel(argument.slice(2))] = value;
    } else {
      usage(`unknown argument ${JSON.stringify(argument)}`);
    }
  }
  for (const field of ["project", "source", "module", "outputPrefix"]) {
    if (!options[field]) usage(`missing --${field.replace(/[A-Z]/g, (part) => `-${part.toLowerCase()}`)}`);
  }
  if (options.roots.length === 0) usage("at least one --root is required");
  return options;
}

function usage(error) {
  if (error) console.error(error);
  console.error(
    "usage: capture-target-surface.mjs --project <lake-project> --source <file.lean> "
      + "--module <Lean.Module> --root <Lean.Name>... --output-prefix <path>",
  );
  process.exit(2);
}

async function runChecked(command, args, cwd) {
  const result = await runAsync(command, args, { cwd, capture: true });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!result.ok) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, part) => part.toUpperCase());
}

function compareText(lhs, rhs) {
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

function portableSourceLabel(project, sourcePath) {
  const candidate = relative(project, sourcePath);
  if (candidate && candidate !== ".." && !candidate.startsWith(`..${sep}`)
      && !isAbsolute(candidate)) {
    return candidate.split(sep).join("/");
  }
  return basename(sourcePath);
}
