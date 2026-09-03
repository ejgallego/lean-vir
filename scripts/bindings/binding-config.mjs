/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { repositoryRoot } from "../repository-paths.mjs";
import { validateGenerationProfile } from "./binding-modalities.mjs";

const schemaPath = resolve(repositoryRoot, "Vir/bindings.schema.json");
let validatorPromise = null;

function labelFor(path) {
  const label = relative(repositoryRoot, path);
  return label.startsWith("../") ? path : label;
}

async function bindingConfigValidator() {
  validatorPromise ??= readFile(schemaPath, "utf8").then((text) => {
    const schema = JSON.parse(text);
    return new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
  });
  return validatorPromise;
}

function errorLocation(error) {
  const path = error.instancePath || "/";
  if (error.keyword !== "additionalProperties") return path;
  return `${path === "/" ? "" : path}/${error.params.additionalProperty}`;
}

function validationMessage(label, errors) {
  const details = errors.map((error) =>
    `${errorLocation(error)} ${error.message}`).join("; ");
  return `${label} does not match Vir/bindings.schema.json: ${details}`;
}

function deriveGeneratedMembers(config) {
  if (config.generation === undefined) return config;
  const members = [...new Set(config.roots.flatMap((root) =>
    (root.mappings ?? []).map((mapping) => mapping.typescript)))].sort();
  return {
    ...config,
    generation: { ...config.generation, members },
  };
}

function validateLibrarySemantics(config, label) {
  validateGenerationProfile(config.generation, `${label} generation`);
  const rootIds = new Set();
  const generated = new Set(config.generation?.members ?? []);
  for (const member of Object.keys(config.generation?.methodPolicies ?? {})) {
    if (!generated.has(member)) {
      throw new Error(`${label} defines a method policy for unselected member ${member}`);
    }
  }
  for (const root of config.roots) {
    if (rootIds.has(root.id)) throw new Error(`${label} repeats root id ${root.id}`);
    rootIds.add(root.id);
    const unsupported = root.unsupported ?? [];
    const unsupportedIds = new Set(unsupported.map((entry) => entry.typescript));
    if (unsupportedIds.size !== unsupported.length) {
      throw new Error(`${label} repeats an unsupported TypeScript entry in root ${root.id}`);
    }
    const mapped = new Set((root.mappings ?? []).map((entry) => entry.typescript));
    const contradictory = unsupported.find((entry) => mapped.has(entry.typescript));
    if (contradictory !== undefined) {
      throw new Error(
        `${label} marks mapped TypeScript entry ${contradictory.typescript} unsupported in root ${root.id}`,
      );
    }
  }
}

export async function validateBindingConfig(config, path = schemaPath) {
  const label = labelFor(path);
  const validate = await bindingConfigValidator();
  if (!validate(config)) throw new Error(validationMessage(label, validate.errors ?? []));
  const normalized = deriveGeneratedMembers(config);
  validateLibrarySemantics(normalized, label);
  return { ...normalized, path: label };
}

export async function loadBindingConfig(path) {
  const label = labelFor(path);
  let config;
  try {
    config = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
  return validateBindingConfig(config, path);
}

export async function discoverBindingConfigPaths(directory) {
  const paths = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && entry.name.endsWith(".bindings.json")) paths.push(child);
    }
  }
  await visit(directory);
  return paths.sort();
}
