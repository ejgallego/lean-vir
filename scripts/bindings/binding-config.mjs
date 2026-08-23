/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { repositoryRoot } from "../repository-paths.mjs";

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

function validateLibrarySemantics(config, label) {
  const rootIds = new Set();
  for (const root of config.roots) {
    if (rootIds.has(root.id)) throw new Error(`${label} repeats root id ${root.id}`);
    rootIds.add(root.id);
  }
}

export async function validateBindingConfig(config, path = schemaPath) {
  const label = labelFor(path);
  const validate = await bindingConfigValidator();
  if (!validate(config)) throw new Error(validationMessage(label, validate.errors ?? []));
  validateLibrarySemantics(config, label);
  return { ...config, path: label };
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
