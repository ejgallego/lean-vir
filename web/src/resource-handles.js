/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const RESOURCE_CELL = Symbol("lean-vir.resourceCell");
const RESOURCE_CELL_BRAND = Symbol("lean-vir.resourceCellBrand");

export function createResourceObject(value) {
  if (value === null || value === undefined) {
    throw new Error("resource object value must not be null");
  }
  return createResourceObjectFromCell(createResourceCell(value));
}

export function createResourceObjectFromCell(cell) {
  if (!isResourceCell(cell)) {
    throw new Error("resource cell must be a Lean VIR resource cell");
  }
  const resource = {};
  Object.defineProperty(resource, RESOURCE_CELL, { value: cell });
  return Object.freeze(resource);
}

export function resourceObjectCell(resource) {
  return resource?.[RESOURCE_CELL];
}

export function resourceObjectValue(resource) {
  return resourceObjectCell(resource)?.value;
}

export function resourceObjectExternref(resource) {
  const cell = resourceObjectCell(resource);
  return isResourceCell(cell) && cell.value !== null && cell.value !== undefined ? cell : null;
}

export function releaseResourceObject(resource) {
  const cell = resourceObjectCell(resource);
  if (isResourceCell(cell)) {
    cell.value = null;
  }
}

export function isResourceObject(resource) {
  return isResourceCell(resourceObjectCell(resource));
}

export function isResourceCell(cell) {
  return cell !== null && typeof cell === "object" && cell[RESOURCE_CELL_BRAND] === true;
}

function createResourceCell(value) {
  const cell = { value };
  Object.defineProperty(cell, RESOURCE_CELL_BRAND, { value: true });
  return cell;
}
