/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawn, spawnSync } from "node:child_process";

export function runSync(cmd, args, {
  cwd,
  capture = false,
  trimStdout = true,
  encoding = "utf8",
  ...options
} = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with status ${result.status}\n${result.stderr ?? ""}`);
  }
  const stdout = result.stdout ?? "";
  return trimStdout ? stdout.trim() : stdout;
}

export function runAsync(cmd, args, { cwd, capture = false, ...options } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      ...options,
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", (error) => {
      resolve({
        ok: false,
        status: null,
        stdout,
        stderr: stderr || String(error),
      });
    });
    child.on("close", (status) => {
      resolve({
        ok: status === 0,
        status,
        stdout,
        stderr,
      });
    });
  });
}

export async function mapWithLimit(items, limit, fn) {
  if (items.length === 0) return [];
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
