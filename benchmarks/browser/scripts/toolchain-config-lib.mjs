import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  exactProperties,
  identifier,
  object,
} from "./validation-utils.mjs";

const toolchainNames = new Set(["vir", "fir"]);

function configuredPaths(value, label, base) {
  const selected = object(value ?? {}, label);
  const result = new Map();
  for (const [name, path] of Object.entries(selected)) {
    identifier(name, `${label} name`);
    if (typeof path !== "string" || path.length === 0) {
      throw new Error(`${label}.${name} must be a non-empty path`);
    }
    result.set(name, resolve(base, path));
  }
  return result;
}

export function parsePathAssignment(value, { defaultName = null, label }) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} requires a path`);
  }
  const separator = value.indexOf("=");
  const name = separator === -1 ? defaultName : value.slice(0, separator);
  const path = separator === -1 ? value : value.slice(separator + 1);
  if (!name || path.length === 0) {
    throw new Error(`${label} must have the form NAME=PATH`);
  }
  identifier(name, `${label} name`);
  return { name, path: resolve(path) };
}

function toolchainForAdapter(adapter) {
  if (adapter === "vir") return "vir";
  if (adapter === "fir-native" || adapter === "fir-llvm") return "fir";
  return null;
}

export function checkoutReceipt(checkout) {
  return {
    sourceId: checkout.sourceId,
    repository: checkout.repository,
    revision: checkout.revision,
  };
}

function producerToolchainRoles(build) {
  const roles = new Map();
  for (const component of Object.values(build.components)) {
    const name = toolchainForAdapter(component.producer.adapter);
    if (!name) continue;
    const checkout = component.producer.checkouts.producer;
    const previous = roles.get(name);
    if (previous && previous !== checkout) {
      throw new Error(
        `toolchain ${name} maps to both ${previous} and ${checkout}`,
      );
    }
    roles.set(name, checkout);
  }
  return roles;
}

export function resolveBuildCheckoutPaths(
  build,
  sources,
  {
    sourcesDir,
    checkouts = new Map(),
    toolchains = new Map(),
    config = { toolchains: new Map(), checkouts: new Map() },
  },
) {
  const toolchainRoles = producerToolchainRoles(build);
  const checkoutToolchains = new Map(
    [...toolchainRoles].map(([name, checkout]) => [checkout, name]),
  );
  for (const checkoutId of checkouts.keys()) {
    if (!sources[checkoutId]) {
      throw new Error(`build has no checkout ${checkoutId}`);
    }
  }
  for (const name of toolchains.keys()) {
    if (!toolchainRoles.has(name)) {
      throw new Error(`build has no ${name} toolchain`);
    }
  }

  const paths = new Map();
  for (const checkoutId of Object.keys(sources)) {
    const toolchain = checkoutToolchains.get(checkoutId);
    paths.set(
      checkoutId,
      checkouts.get(checkoutId) ??
        (toolchain ? toolchains.get(toolchain) : null) ??
        config.checkouts.get(checkoutId) ??
        (toolchain ? config.toolchains.get(toolchain) : null) ??
        resolve(sourcesDir, checkoutId),
    );
  }
  return { paths, toolchainRoles };
}

export async function readToolchainConfig(appRoot, selectedPath = null) {
  const environmentPath = process.env.VIR_BENCH_TOOLCHAIN_CONFIG ?? null;
  const localPath = resolve(appRoot, "toolchains.local.json");
  const path = selectedPath
    ? resolve(appRoot, selectedPath)
    : environmentPath
      ? resolve(appRoot, environmentPath)
      : existsSync(localPath)
        ? localPath
        : null;
  if (!path) {
    return { path: null, toolchains: new Map(), checkouts: new Map() };
  }

  const config = JSON.parse(await readFile(path, "utf8"));
  object(config, "toolchain config");
  exactProperties(
    config,
    new Set(["schemaVersion", "kind", "toolchains", "checkouts"]),
    "toolchain config",
  );
  if (
    config.schemaVersion !== 1 ||
    config.kind !== "browser-benchmarks/toolchains"
  ) {
    throw new Error("unsupported toolchain config");
  }
  const base = dirname(path);
  const toolchains = configuredPaths(config.toolchains, "toolchains", base);
  for (const name of toolchains.keys()) {
    if (!toolchainNames.has(name)) {
      throw new Error(`unsupported toolchain name: ${name}`);
    }
  }
  return {
    path,
    toolchains,
    checkouts: configuredPaths(config.checkouts, "checkouts", base),
  };
}
