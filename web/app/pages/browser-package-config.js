/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { requireModuleIdentity } from "../../src/runtime/module-name.js";

export const browserPackageConfigVersion = 2;

const configKeys = new Set(["version", "defaultPackage", "hostPackage", "packages", "localPackages"]);
const packageKeys = new Set([
  "id",
  "file",
  "label",
  "report",
  "lakeTargets",
  "targets",
  "fixtureInputs",
]);
const targetKeys = new Set(["module", "roots", "packageOnly"]);
const fixtureInputKeys = new Set(["source", "module"]);
const localPackageKeys = new Set(["file", "label"]);

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function rejectUnknownFields(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${label}: unknown field ${key}`);
  }
}

function validateStringArray(value, label) {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  for (const [index, entry] of value.entries()) {
    requireNonEmptyString(entry, `${label}[${index}]`);
  }
}

function validateOptionalString(value, label) {
  if (value !== undefined) requireNonEmptyString(value, label);
}

function requireName(value, label) {
  // Lean owns escaped-name syntax; only validate the transport boundary here.
  requireModuleIdentity(value, label);
  if (value.startsWith("--")) throw new Error(`${label} must not be an option`);
}

function validateTarget(target, packageId, index) {
  const label = `${packageId}: target at index ${index}`;
  requireObject(target, label);
  rejectUnknownFields(target, targetKeys, label);
  requireName(target.module, label);
  if (!Array.isArray(target.roots) || target.roots.length === 0) {
    throw new Error(`${label} roots must be a non-empty array`);
  }
  for (const [rootIndex, root] of target.roots.entries()) {
    requireName(root, `${label} roots[${rootIndex}]`);
  }
  if (target.packageOnly !== undefined && typeof target.packageOnly !== "boolean") {
    throw new Error(`${label} packageOnly must be a boolean`);
  }
}

function validatePackageSpec(spec, index) {
  const label = `browser package at index ${index}`;
  requireObject(spec, label);
  rejectUnknownFields(spec, packageKeys, label);
  requireNonEmptyString(spec.id, `${label} id`);
  requireNonEmptyString(spec.file, `${label} file`);
  validateOptionalString(spec.label, `${spec.id}: label`);
  validateOptionalString(spec.report, `${spec.id}: report`);
  if (spec.fixtureInputs !== undefined && !Array.isArray(spec.fixtureInputs)) {
    throw new Error(`${spec.id}: fixtureInputs must be an array`);
  }
  for (const [inputIndex, input] of (spec.fixtureInputs ?? []).entries()) {
    const inputLabel = `${spec.id}: fixture input at index ${inputIndex}`;
    requireObject(input, inputLabel);
    rejectUnknownFields(input, fixtureInputKeys, inputLabel);
    requireNonEmptyString(input.source, `${inputLabel} source`);
    requireName(input.module, inputLabel);
  }
  validateStringArray(spec.lakeTargets, `${spec.id}: lakeTargets`);
  if (spec.targets !== undefined && !Array.isArray(spec.targets)) {
    throw new Error(`${spec.id}: targets must be an array`);
  }
  for (const [targetIndex, target] of (spec.targets ?? []).entries()) {
    validateTarget(target, spec.id, targetIndex);
  }
}

function validateLocalPackagePreset(preset, index) {
  const label = `local browser package at index ${index}`;
  requireObject(preset, label);
  rejectUnknownFields(preset, localPackageKeys, label);
  requireNonEmptyString(preset.file, `${label} file`);
  validateOptionalString(preset.label, `${label} label`);
}

export function deriveBrowserPackageConfig(browserPackageConfig) {
  requireObject(browserPackageConfig, "browser package config");
  rejectUnknownFields(browserPackageConfig, configKeys, "browser package config");
  if (browserPackageConfig.version !== browserPackageConfigVersion) {
    throw new Error(
      `browser package config version must be ${browserPackageConfigVersion}, got `
      + JSON.stringify(browserPackageConfig.version),
    );
  }
  if (!Array.isArray(browserPackageConfig.packages) || browserPackageConfig.packages.length === 0) {
    throw new Error("browser package config packages must be a non-empty array");
  }
  if (browserPackageConfig.localPackages !== undefined
      && !Array.isArray(browserPackageConfig.localPackages)) {
    throw new Error("browser package config localPackages must be an array");
  }

  const wasmPublicFile = "vir-upstream.wasm";
  const wasmDevPublicFile = "vir-upstream.dev.wasm";
  const packageSpecs = browserPackageConfig.packages;
  const localPackagePresets = browserPackageConfig.localPackages ?? [];
  const packageFileById = new Map();
  const artifactFiles = new Set();
  const packageFileByFixtureSource = new Map();
  const fixtureSourceByModule = new Map();

  for (const [index, spec] of packageSpecs.entries()) {
    validatePackageSpec(spec, index);
    if (packageFileById.has(spec.id)) {
      throw new Error(`duplicate browser package id ${JSON.stringify(spec.id)}`);
    }
    if (artifactFiles.has(spec.file)) {
      throw new Error(`duplicate browser package file ${JSON.stringify(spec.file)}`);
    }
    packageFileById.set(spec.id, spec.file);
    artifactFiles.add(spec.file);
    for (const { source, module } of spec.fixtureInputs ?? []) {
      const existing = packageFileByFixtureSource.get(source);
      if (existing !== undefined) {
        throw new Error(
          `${source}: fixture source is assigned to both ${existing} and ${spec.file}`,
        );
      }
      const existingSource = fixtureSourceByModule.get(module);
      if (existingSource !== undefined && existingSource !== source) {
        throw new Error(
          `${module}: fixture module is assigned to both ${existingSource} and ${source}`,
        );
      }
      fixtureSourceByModule.set(module, source);
      packageFileByFixtureSource.set(source, spec.file);
    }
  }

  for (const [index, preset] of localPackagePresets.entries()) {
    validateLocalPackagePreset(preset, index);
    if (artifactFiles.has(preset.file)) {
      throw new Error(`duplicate browser package file ${JSON.stringify(preset.file)}`);
    }
    artifactFiles.add(preset.file);
  }

  const packageFiles = packageSpecs.map((spec) => spec.file);
  const localPackageFiles = localPackagePresets.map((preset) => preset.file);
  const packagePresets = [
    ...packageSpecs.map((spec) => ({
      file: spec.file,
      label: spec.label ?? spec.id,
    })),
    ...localPackagePresets,
  ];
  function requiredPackageFile(id, label) {
    requireNonEmptyString(id, label);
    const file = packageFileById.get(id);
    if (file === undefined) {
      throw new Error(`${label} references unknown browser package ${JSON.stringify(id)}`);
    }
    return file;
  }

  const defaultPackageFile = requiredPackageFile(
    browserPackageConfig.defaultPackage,
    "browser package config defaultPackage",
  );
  const hostPackageFile = requiredPackageFile(
    browserPackageConfig.hostPackage,
    "browser package config hostPackage",
  );
  const prettyPackageFile = requiredPackageFile("pretty-printer", "pretty-printer package");
  const leanPackageFile = requiredPackageFile("fixtures-lean", "fixtures-lean package");
  const boundaryPackageFile = requiredPackageFile("fixtures-boundary", "fixtures-boundary package");
  const benchmarkPublicFiles = [wasmPublicFile, defaultPackageFile, hostPackageFile, prettyPackageFile];
  const generatedPublicFiles = [
    wasmPublicFile,
    wasmDevPublicFile,
    ...packageFiles,
    ...localPackageFiles,
  ];

  function packageFileForFixtureSource(source) {
    const file = packageFileByFixtureSource.get(source);
    if (file === undefined) {
      throw new Error(`${source}: fixture source is not assigned to a browser package`);
    }
    return file;
  }

  function validateFixturePackageCoverage(fixtures) {
    const manifestSources = new Set(fixtures.map((fixture) => fixture.source));
    for (const source of manifestSources) packageFileForFixtureSource(source);
    for (const source of packageFileByFixtureSource.keys()) {
      if (!manifestSources.has(source)) {
        throw new Error(`${source}: browser package assignment has no manifest fixtures`);
      }
    }
    return fixtures;
  }

  function publicArtifactPath(file) {
    return `web/public/${file}`;
  }

  return {
    wasmPublicFile,
    wasmDevPublicFile,
    packageSpecs,
    packageFiles,
    localPackageFiles,
    benchmarkArtifactPaths: benchmarkPublicFiles.map(publicArtifactPath),
    generatedPublicFiles,
    packagePresets,
    defaultPackageFile,
    hostPackageFile,
    prettyPackageFile,
    leanPackageFile,
    boundaryPackageFile,
    packageFileForFixtureSource,
    validateFixturePackageCoverage,
    publicArtifactPath,
  };
}
