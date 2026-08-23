/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { compareText, isSurfaceAbi } from "./surface-report-schema.mjs";

const FORMAT = "lean-vir-client-native-externs";
const VERSION = 1;
const FIELDS = new Set(["format", "version", "modules", "externs", "providerSources"]);

export function parseClientNativeSurfaceProfile(value, label = "client-native extern manifest") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: expected a JSON object`);
  }
  const unknown = Object.keys(value).find((field) => !FIELDS.has(field));
  if (unknown) throw new Error(`${label}: unknown field ${JSON.stringify(unknown)}`);
  if (value.format !== FORMAT || value.version !== VERSION) {
    throw new Error(`${label}: expected ${FORMAT} version ${VERSION}`);
  }
  for (const field of ["modules", "externs", "providerSources"]) {
    validateNames(value[field], field, label);
  }
  return {
    modules: [...value.modules],
    externs: [...value.externs],
    providerSources: [...value.providerSources],
  };
}

export function addClientNativeSurfaceCapabilities(capabilityReport, graph, profile) {
  const result = structuredClone(capabilityReport);
  const capabilities = result.runtimeCapabilities.nativeExterns;
  const capabilityNames = new Set(capabilities.map((entry) => entry.name));
  const nodes = new Map();
  for (const node of graph.nodes) {
    if (typeof node?.name !== "string" || node.name.length === 0 || nodes.has(node.name)) {
      throw new Error("surface graph must contain unique non-empty node names");
    }
    nodes.set(node.name, node);
  }
  for (const name of profile.externs) {
    if (capabilityNames.has(name)) {
      throw new Error(`client-native extern ${JSON.stringify(name)} collides with a VIR capability`);
    }
    const node = nodes.get(name);
    if (node?.kind !== "extern" || !isSurfaceAbi(node.abi)) {
      throw new Error(
        `client-native extern ${JSON.stringify(name)} is not a captured extern with ABI metadata`,
      );
    }
    capabilities.push({
      name,
      symbol: cSymbol(node, name),
      generateBoxedWrapper: true,
      params: node.abi.params.map((param, index) => ({
        index: Number.isInteger(param.index) && param.index >= 0 ? param.index : index + 1,
        borrow: param.borrow,
        type: param.type,
      })),
      resultType: node.abi.resultType,
      deps: [],
    });
    capabilityNames.add(name);
  }
  capabilities.sort((lhs, rhs) => compareText(lhs.name, rhs.name));
  result.runtimeCapabilities.nativeExternCount = capabilities.length;
  return result;
}

function validateNames(values, field, label) {
  if (!Array.isArray(values) || values.length === 0
      || values.some((value) => typeof value !== "string" || value.length === 0)
      || new Set(values).size !== values.length) {
    throw new Error(`${label}: field ${JSON.stringify(field)} must contain unique non-empty strings`);
  }
}

function cSymbol(node, name) {
  const targets = Array.isArray(node.targets) ? node.targets : [];
  const standard = targets.find((target) =>
    target?.kind === "standard" && target.backend === "c" && target.value)
    ?? targets.find((target) =>
      target?.kind === "standard" && target.backend === "all" && target.value);
  if (!standard) {
    throw new Error(`client-native extern ${JSON.stringify(name)} has no standard C symbol`);
  }
  return standard.value;
}
