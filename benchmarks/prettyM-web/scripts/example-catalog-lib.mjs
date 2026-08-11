import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const lifecycles = new Set([
  "active",
  "candidate",
  "rehearsal",
  "queued",
  "archived",
]);
const lifecycleOrder = new Map([
  ["active", 0],
  ["candidate", 1],
  ["rehearsal", 2],
  ["queued", 3],
  ["archived", 4],
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function exactProperties(value, allowed, label) {
  for (const property of Object.keys(value)) {
    if (!allowed.has(property)) throw new Error(`${label} has unknown property ${property}`);
  }
}

function string(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function identifier(value, label) {
  const selected = string(value, label);
  if (!idPattern.test(selected)) throw new Error(`${label} is not a safe identifier`);
  return selected;
}

function webPath(value, label) {
  const selected = string(value, label);
  if (
    selected.startsWith("/") ||
    selected.includes("\\") ||
    selected.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${label} is not a safe relative web path`);
  }
  return selected;
}

export function validateExampleManifest(manifest, { directory = null } = {}) {
  object(manifest, "example manifest");
  exactProperties(
    manifest,
    new Set([
      "schemaVersion",
      "kind",
      "id",
      "title",
      "summary",
      "lifecycle",
      "packages",
      "controller",
    ]),
    "example manifest",
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "browser-benchmarks/example"
  ) {
    throw new Error("unsupported example manifest");
  }
  const id = identifier(manifest.id, "example ID");
  if (directory !== null && directory !== id) {
    throw new Error(`example directory ${directory} does not match ID ${id}`);
  }
  if (!lifecycles.has(manifest.lifecycle)) {
    throw new Error(`example ${id} has an unsupported lifecycle`);
  }
  string(manifest.title, `example ${id} title`);
  string(manifest.summary, `example ${id} summary`);
  const controller = webPath(manifest.controller, `example ${id} controller`);
  if (!controller.endsWith(".mjs")) {
    throw new Error(`example ${id} controller must be an ES module`);
  }
  if (!Array.isArray(manifest.packages) || manifest.packages.length === 0) {
    throw new Error(`example ${id} must declare at least one VIR package`);
  }
  const packageIds = new Set();
  for (const [index, item] of manifest.packages.entries()) {
    const packageSpec = object(item, `example ${id} packages[${index}]`);
    exactProperties(
      packageSpec,
      new Set(["id", "target", "exports"]),
      `example ${id} packages[${index}]`,
    );
    const packageId = identifier(packageSpec.id, `example ${id} package ID`);
    if (packageIds.has(packageId)) {
      throw new Error(`example ${id} repeats package ${packageId}`);
    }
    packageIds.add(packageId);
    const target = webPath(
      packageSpec.target,
      `example ${id} package ${packageId} target`,
    );
    if (!target.endsWith(".lean")) {
      throw new Error(`example ${id} package ${packageId} target must be a Lean source`);
    }
    if (!Array.isArray(packageSpec.exports) || packageSpec.exports.length === 0) {
      throw new Error(`example ${id} package ${packageId} must export a declaration`);
    }
    const exports = new Set();
    for (const [exportIndex, declaration] of packageSpec.exports.entries()) {
      string(declaration, `example ${id} package ${packageId} exports[${exportIndex}]`);
      if (exports.has(declaration)) {
        throw new Error(`example ${id} package ${packageId} repeats export ${declaration}`);
      }
      exports.add(declaration);
    }
  }
  return manifest;
}

export async function discoverExampleCatalog(appRoot) {
  const examplesRoot = join(appRoot, "examples");
  const entries = await readdir(examplesRoot, { withFileTypes: true });
  const examples = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(examplesRoot, entry.name, "example.json");
    if (!(await stat(manifestPath).catch(() => null))?.isFile()) continue;
    const manifest = validateExampleManifest(
      JSON.parse(await readFile(manifestPath, "utf8")),
      { directory: entry.name },
    );
    const controllerPath = resolve(appRoot, manifest.controller);
    if (!(await stat(controllerPath).catch(() => null))?.isFile()) {
      throw new Error(`example ${manifest.id} controller is missing: ${manifest.controller}`);
    }
    examples.push(manifest);
  }
  if (examples.length === 0) throw new Error("example catalog is empty");
  const ids = new Set();
  for (const example of examples) {
    if (ids.has(example.id)) throw new Error(`duplicate example ID: ${example.id}`);
    ids.add(example.id);
  }
  examples.sort(
    (left, right) =>
      lifecycleOrder.get(left.lifecycle) - lifecycleOrder.get(right.lifecycle) ||
      left.id.localeCompare(right.id),
  );
  return {
    schemaVersion: 1,
    kind: "browser-benchmarks/example-catalog",
    examples,
  };
}
