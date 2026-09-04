/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { repositoryRoot as root } from "../repository-paths.mjs";
import { emitGeneratedFile, requiredValue } from "./tool-utils.mjs";
import { VIR_HOST_DISPOSE } from "../../web/src/host-boundary.js";
import {
  createBrowserHostBindings,
  createCommonHostBindings,
  createConsoleHostBindings,
  createHostLifecycle,
} from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";
import { RUNTIME_INTRINSIC_HOST_TARGETS } from "../../web/src/runtime/host-state.js";

const usageLine =
  "usage: node scripts/bindings/generate-shipped-bindings-report.mjs --lean FILE --out FILE [options]";

function usage() {
  console.log(`${usageLine}

Reconcile compiler-derived JavaScript bindings with runtime provider keys.

Options:
  --lean FILE  Compiler-derived VIR JavaScript inventory.
  --out FILE   Write the coverage report JSON to FILE.
  --check      Compare generated files with existing outputs.
  -h, --help   Show this help.
`);
}

function parseArgs(argv) {
  const options = { lean: null, out: null, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "-h" || option === "--help") {
      usage();
      return null;
    } else if (option === "--lean")
      options.lean = requiredValue(argv, ++index, option);
    else if (option === "--out")
      options.out = requiredValue(argv, ++index, option);
    else if (option === "--check") options.check = true;
    else throw new Error(`unknown option ${option}`);
  }
  if (options.lean === null || options.out === null) {
    throw new Error(usageLine);
  }
  return Object.fromEntries(
    Object.entries(options).map(([key, value]) => [
      key,
      typeof value === "string" ? resolve(root, value) : value,
    ]),
  );
}

async function readInventory(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (
    value?.format !== "lean-vir-js-inventory" ||
    value.version !== 1 ||
    !Array.isArray(value.bindings) ||
    value.summary?.declarations !== value.bindings.length ||
    !Array.isArray(value.publicEntries) ||
    value.summary?.publicEntries !== value.publicEntries.length
  ) {
    throw new Error(
      `${relative(root, path)} is not a compiler-derived VIR JavaScript inventory`,
    );
  }
  const validBoundaries = new Set([
    "hostResource",
    "explicitConversion",
    "objectHandle",
  ]);
  const declarations = new Set();
  for (const binding of value.bindings) {
    if (
      typeof binding.declaration !== "string" ||
      typeof binding.target !== "string" ||
      typeof binding.type !== "string" ||
      !validBoundaries.has(binding.boundary)
    ) {
      throw new Error(
        `${relative(root, path)} contains an invalid binding entry`,
      );
    }
    if (declarations.has(binding.declaration)) {
      throw new Error(`duplicate compiler declaration ${binding.declaration}`);
    }
    declarations.add(binding.declaration);
    const expectedBoundary =
      binding.marker === "vir_js_explicit_conversion"
        ? "explicitConversion"
        : binding.marker === "vir_js"
          ? null
          : "invalid";
    if (
      expectedBoundary === "invalid" ||
      (expectedBoundary === "explicitConversion" &&
        binding.boundary !== expectedBoundary) ||
      (expectedBoundary === null && binding.boundary === "explicitConversion")
    ) {
      throw new Error(
        `${binding.declaration} has inconsistent marker and boundary metadata`,
      );
    }
  }
  let publicTargetEdges = 0;
  const publicTargets = new Set();
  for (const entry of value.publicEntries) {
    if (
      typeof entry.declaration !== "string" ||
      typeof entry.module !== "string" ||
      typeof entry.type !== "string" ||
      !Array.isArray(entry.targets) ||
      entry.targets.length === 0
    ) {
      throw new Error(
        `${relative(root, path)} contains an invalid public entry`,
      );
    }
    for (const reached of entry.targets) {
      if (
        typeof reached.target !== "string" ||
        !Array.isArray(reached.path) ||
        reached.path[0] !== entry.declaration ||
        reached.path.some((declaration) => typeof declaration !== "string")
      ) {
        throw new Error(
          `${entry.declaration} contains invalid compiler reachability evidence`,
        );
      }
      publicTargetEdges += 1;
      publicTargets.add(reached.target);
    }
  }
  if (
    value.summary.publicTargetEdges !== publicTargetEdges ||
    value.summary.publicTargets !== publicTargets.size
  ) {
    throw new Error(
      `${relative(root, path)} has inconsistent public reachability counts`,
    );
  }
  return value;
}

function collectProviders() {
  const browserLifecycle = createHostLifecycle();
  const browser = createBrowserHostBindings({
    lifecycle: browserLifecycle,
    reactHostBindings: createBrowserReactHostBindings,
  });
  const node = {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
  };
  try {
    return [
      provider("browser", "Browser + React host map", Object.keys(browser)),
      provider("node", "Environment-neutral Node host map", Object.keys(node)),
      provider(
        "runtime-intrinsic",
        "VIR object-handle dispatcher",
        Object.values(RUNTIME_INTRINSIC_HOST_TARGETS),
      ),
    ];
  } finally {
    browser[VIR_HOST_DISPOSE]?.();
  }
}

function provider(id, title, targets) {
  return { id, title, targets: [...new Set(targets)].sort() };
}

export function buildShippedBindingsReport(inventory, providers) {
  const declarationsByTarget = new Map();
  const boundaryCounts = {
    hostResource: 0,
    objectHandle: 0,
    explicitConversion: 0,
  };
  for (const binding of inventory.bindings) {
    boundaryCounts[binding.boundary] += 1;
    const entries = declarationsByTarget.get(binding.target) ?? [];
    entries.push(binding);
    declarationsByTarget.set(binding.target, entries);
  }
  const providersByTarget = new Map();
  for (const entry of providers) {
    for (const target of entry.targets) {
      const ids = providersByTarget.get(target) ?? [];
      ids.push(entry.id);
      providersByTarget.set(target, ids);
    }
  }

  const targets = [
    ...new Set([...declarationsByTarget.keys(), ...providersByTarget.keys()]),
  ].sort();
  const bindings = targets.map((target) => {
    const declarations = (declarationsByTarget.get(target) ?? []).sort(
      (lhs, rhs) => lhs.declaration.localeCompare(rhs.declaration),
    );
    const targetProviders = (providersByTarget.get(target) ?? []).sort();
    const status =
      declarations.length === 0
        ? "runtime-only"
        : targetProviders.length === 0
          ? "missing-provider"
          : "provided";
    return {
      target,
      prefix: target.split(".")[0],
      status,
      providers: targetProviders,
      boundaries: [
        ...new Set(declarations.map((entry) => entry.boundary)),
      ].sort(),
      visibility: declarations.some((entry) => !entry.private)
        ? "public"
        : "private",
      declarations,
    };
  });

  const count = (status) =>
    bindings.filter((entry) => entry.status === status).length;
  return {
    format: "lean-vir-shipped-bindings-coverage",
    version: 1,
    generatedBy: "scripts/bindings/generate-shipped-bindings-report.mjs",
    analysis: {
      representationPolicy: "compiler-validated-coarse-boundary",
      ordinaryBoundary:
        "Unit, JavaScript resources, object handles, and resource-shaped callbacks",
      conversionBoundary:
        "explicit vir_js_explicit_conversion declarations only",
      providerCoverage: "target-name-presence-only",
      providerBehavior: "not-mechanically-verified",
      semanticParity: "not-analyzed-by-provider-reconciliation",
    },
    lean: {
      modules: inventory.modules,
      version: inventory.lean.version,
      toolchain: inventory.lean.toolchain,
      githash: inventory.lean.githash,
    },
    providers: providers.map(({ id, title, targets }) => ({
      id,
      title,
      targets: targets.length,
    })),
    summary: {
      declarations: inventory.summary.declarations,
      virJs: inventory.summary.virJs,
      explicitConversions: inventory.summary.explicitConversions,
      boundaries: boundaryCounts,
      declaredTargets: declarationsByTarget.size,
      providerTargets: providersByTarget.size,
      totalTargets: bindings.length,
      provided: count("provided"),
      missingProvider: count("missing-provider"),
      runtimeOnly: count("runtime-only"),
      publicTargets: bindings.filter((entry) => entry.visibility === "public")
        .length,
      privateTargets: bindings.filter((entry) => entry.visibility === "private")
        .length,
      publicEntries: inventory.summary.publicEntries,
      publicTargetEdges: inventory.summary.publicTargetEdges,
      targetsReachedByPublicEntries: inventory.summary.publicTargets,
    },
    publicEntries: inventory.publicEntries,
    bindings,
  };
}

export async function runShippedBindingsReportCli(argv) {
  const options = parseArgs(argv);
  if (options === null) return 0;
  const inventory = await readInventory(options.lean);
  const report = buildShippedBindingsReport(inventory, collectProviders());
  const outputOptions = {
    check: options.check,
    root,
    staleHint: "rerun the corresponding shipped-bindings generation step",
  };
  await emitGeneratedFile(
    options.out,
    `${JSON.stringify(report, null, 2)}\n`,
    outputOptions,
  );

  if (
    report.summary.missingProvider !== 0 ||
    report.summary.runtimeOnly !== 0
  ) {
    throw new Error(
      `shipped binding reconciliation found ${report.summary.missingProvider} missing provider keys and ` +
        `${report.summary.runtimeOnly} runtime-only targets`,
    );
  }

  console.log("\nShipped VIR JavaScript bindings: compiler/runtime coverage");
  console.log(`  vir_js declarations: ${report.summary.virJs}`);
  console.log(`  explicit conversions: ${report.summary.explicitConversions}`);
  console.log(`  declared targets: ${report.summary.declaredTargets}`);
  console.log(`  provider keys present: ${report.summary.provided}`);
  console.log(`  missing provider keys: ${report.summary.missingProvider}`);
  console.log(`  runtime-only targets: ${report.summary.runtimeOnly}`);
  console.log(
    `  public entries reaching targets: ${report.summary.publicEntries}`,
  );
  console.log(
    `  public entry/target edges: ${report.summary.publicTargetEdges}`,
  );
  console.log(
    `  artifact: ${options.check ? "validated" : "wrote"} ${relative(root, options.out)}`,
  );
  return 0;
}
