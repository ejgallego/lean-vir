/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { isAbsolute, resolve } from "node:path";

import { requireModuleIdentity } from "../../web/src/runtime/module-name.js";

const configFields = new Set([
  "version",
  "module",
  "package",
  "report",
  "roots",
]);

/**
 * Normalize local package selection without building or reading any files.
 * Names receive boundary validation here; Lake and Lean own their syntax.
 */
export function normalizeModulePackageConfig(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("module package config must be an object");
  }
  for (const field of Object.keys(config)) {
    if (!configFields.has(field)) {
      throw new Error(`module package config: unknown field ${field}`);
    }
  }
  if (config.version !== 2) {
    throw new Error(
      `module package config version must be 2, got ${config.version}`,
    );
  }

  const module = requireName(config.module, "module");
  if (/^[-+@]|[/\\:]|\.lean$/u.test(module)) {
    throw new Error(
      "config field `module` must be a module identity, not a source path or Lake target",
    );
  }
  if (config.roots !== undefined && !Array.isArray(config.roots)) {
    throw new Error("config field `roots` must be an array of Lean names");
  }
  const roots = Array.from(config.roots ?? [], (root, index) =>
    requireName(root, `roots[${index}]`),
  );
  const packagePath = requirePath(
    config.package === undefined ? defaultPackagePath(module) : config.package,
    "package",
  );
  const reportPath = requirePath(
    config.report === undefined ? reportPathFor(packagePath) : config.report,
    "report",
  );
  const targetArgs = roots.length === 0
    ? ["--target-all-module", module]
    : ["--target-module", module, ...roots];
  return { module, packagePath, reportPath, roots, targetArgs };
}

/** Check normalized outputs lexically; this does not resolve filesystem links. */
export function assertDistinctModulePackageOutputs(configs, root) {
  if (typeof root !== "string" || !isAbsolute(root)) {
    throw new Error("module package output root must be an absolute path");
  }
  const outputs = new Map();
  for (const [index, config] of configs.entries()) {
    for (const role of ["package", "report"]) {
      const path = resolve(root, config[`${role}Path`]);
      const owner = `${role} for module ${JSON.stringify(config.module)} (config ${index + 1})`;
      if (outputs.has(path)) {
        throw new Error(
          `module package output collision at ${JSON.stringify(path)}: ${outputs.get(path)} conflicts with ${owner}`,
        );
      }
      outputs.set(path, owner);
    }
  }
}

function requireName(value, field) {
  // The Lean generator owns parsing escaped names; do not duplicate its grammar.
  requireModuleIdentity(value, `config field \`${field}\``);
  if (value.startsWith("--")) {
    throw new Error(`config field \`${field}\` must not be an option`);
  }
  return value;
}

function requirePath(value, field) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.startsWith("-") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(
      `config field \`${field}\` must be a non-empty path, not an option`,
    );
  }
  return value;
}

function defaultPackagePath(module) {
  if (/[«»]/u.test(module)) {
    throw new Error("quoted module names require an explicit `package` path");
  }
  return `build/generated/${module.split(".").at(-1)}.irpkg`;
}

function reportPathFor(packagePath) {
  return packagePath.endsWith(".irpkg")
    ? `${packagePath.slice(0, -".irpkg".length)}.report.md`
    : `${packagePath}.report.md`;
}
