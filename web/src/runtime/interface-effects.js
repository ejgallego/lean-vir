/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const EFFECT_LABELS = new Set(["pure", "io", "dom", "react"]);

export function isInterfaceEffectLabel(effect) {
  return EFFECT_LABELS.has(effect);
}

export function requireInterfaceEffect(effect, label) {
  if (!isInterfaceEffectLabel(effect)) {
    throw new Error(`${label} must be one of pure, io, dom, or react`);
  }
  return effect;
}

export function isEffectfulInterfaceEffect(effect) {
  return requireInterfaceEffect(effect, "effect") !== "pure";
}

export function interfaceEffectRuntimeTag(effect) {
  return isEffectfulInterfaceEffect(effect) ? 1 : 0;
}

export function sameRuntimeInterfaceEffect(expected, actual) {
  if (!isInterfaceEffectLabel(expected) || !isInterfaceEffectLabel(actual)) {
    return false;
  }
  return interfaceEffectRuntimeTag(expected) === interfaceEffectRuntimeTag(actual);
}

export function formatInterfaceEffect(effect) {
  switch (requireInterfaceEffect(effect, "effect")) {
    case "pure":
      return "";
    case "io":
      return "IO";
    case "dom":
      return "DomM";
    case "react":
      return "ReactM";
    default:
      return "";
  }
}

export function formatInterfaceEffectPrefix(effect) {
  const label = formatInterfaceEffect(effect);
  return label === "" ? "" : `${label} `;
}

export function formatInterfaceEffectSuffix(effect) {
  const label = formatInterfaceEffect(effect);
  return label === "" ? "" : ` ${label}`;
}
