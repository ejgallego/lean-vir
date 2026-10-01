/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  collectCleanupError,
  throwCollectedErrors,
} from "./runtime/cleanup.js";

export const VIR_HOST_DISPOSE = Symbol.for("lean-vir.hostDispose");

export function disposeHostBindings(bindings) {
  const disposer = bindings?.[VIR_HOST_DISPOSE];
  if (typeof disposer === "function") disposer.call(bindings);
}

let externrefTableSupport = null;

export function hasExternrefTableSupport() {
  if (externrefTableSupport !== null) return externrefTableSupport;
  try {
    const table = new WebAssembly.Table({ element: "externref", initial: 1 });
    const values = [null, undefined, "externref", 3n, Object.freeze({})];
    table.grow(values.length - 1, null);
    values.forEach((value, index) => table.set(index, value));
    externrefTableSupport = values.every((value, index) =>
      Object.is(table.get(index), value),
    );
  } catch {
    externrefTableSupport = false;
  }
  return externrefTableSupport;
}

export function requireExternrefTableSupport() {
  if (!hasExternrefTableSupport()) {
    throw new Error(
      "Lean VIR JavaScript values require WebAssembly externref support",
    );
  }
}

const hostCallTransactions = [];

export function beginHostCallTransaction() {
  const transaction = { rollbacks: [], active: true };
  hostCallTransactions.push(transaction);
  return transaction;
}

export function registerHostCallRollback(rollback) {
  if (typeof rollback !== "function") {
    throw new Error("host call rollback must be a function");
  }
  const transaction = hostCallTransactions.at(-1);
  if (transaction === undefined || !transaction.active) return false;
  transaction.rollbacks.push(rollback);
  return true;
}

export function commitHostCallTransaction(transaction) {
  closeHostCallTransaction(transaction);
  transaction.rollbacks.length = 0;
  return undefined;
}

export function abortHostCallTransaction(transaction) {
  closeHostCallTransaction(transaction);
  const errors = [];
  for (const rollback of transaction.rollbacks.reverse()) {
    collectCleanupError(errors, rollback);
  }
  transaction.rollbacks.length = 0;
  throwCollectedErrors(errors, "host call rollback failed");
  return undefined;
}

function closeHostCallTransaction(transaction) {
  if (hostCallTransactions.at(-1) !== transaction || !transaction?.active) {
    throw new Error("host call transactions must close in stack order");
  }
  transaction.active = false;
  hostCallTransactions.pop();
}
