/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, resolve } from "node:path";

const checks = [];

function record(kind, name, detail) {
  checks.push({ kind, name, detail });
  const label = kind === "ok" ? "OK" : kind === "warn" ? "WARN" : "FAIL";
  console.log(`${label} ${name}${detail ? `: ${detail}` : ""}`);
}

function commandVersion(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    return { ok: false, detail: detail || `${command} exited with status ${result.status}` };
  }
  return { ok: true, detail: (result.stdout || result.stderr).trim().split(/\r?\n/)[0] };
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    return { ok: false, detail: detail || `${command} exited with status ${result.status}` };
  }
  return { ok: true, detail: result.stdout.trim() };
}

async function exists(path, mode = fsConstants.R_OK) {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

async function checkCommand(name, command, args) {
  const result = commandVersion(command, args);
  record(result.ok ? "ok" : "fail", name, result.detail);
}

async function checkPath(name, path, help, mode = fsConstants.R_OK) {
  if (await exists(path, mode)) {
    record("ok", name, path);
  } else {
    record("fail", name, `${path} missing; ${help}`);
  }
}

async function expectedLeanSourceCommit() {
  const source = await readFile("scripts/fetch-lean-source.sh", "utf8");
  const match = source.match(/\bgit\s+-C\s+third_party\/lean4-src\s+checkout\s+([0-9a-f]{40})\b/);
  if (!match) {
    return null;
  }
  return match[1];
}

async function checkLeanSourceCommit() {
  const expected = await expectedLeanSourceCommit();
  if (!expected) {
    record("warn", "Lean source commit", "could not find pinned checkout commit in scripts/fetch-lean-source.sh");
    return;
  }
  const actual = commandOutput("git", ["-C", "third_party/lean4-src", "rev-parse", "HEAD"]);
  if (!actual.ok) {
    record("fail", "Lean source commit", actual.detail);
    return;
  }
  if (actual.detail === expected) {
    record("ok", "Lean source commit", actual.detail);
  } else {
    record(
      "fail",
      "Lean source commit",
      `${actual.detail}; expected ${expected}; run npm run fetch:lean`,
    );
  }
}

async function findExecutableInPath(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = resolve(dir, name);
    if (await exists(candidate, fsConstants.X_OK)) return candidate;
  }
  return null;
}

async function chromiumPath() {
  const configured = process.env.CHROMIUM;
  if (configured) {
    if (configured.includes("/") || configured.includes("\\")) {
      return (await exists(configured, fsConstants.X_OK)) ? configured : null;
    }
    return findExecutableInPath(configured);
  }
  const directCandidates = [
    "/snap/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const candidate of directCandidates) {
    if (await exists(candidate, fsConstants.X_OK)) return candidate;
  }
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const found = await findExecutableInPath(name);
    if (found) return found;
  }
  return null;
}

console.log(`Lean VIR doctor`);
console.log(`node: ${process.version}`);

await checkCommand("npm", "npm", ["--version"]);
await checkCommand("lean", "lean", ["--version"]);
await checkCommand("lake", "lake", ["--version"]);
await checkPath(
  "Lean source",
  "third_party/lean4-src/src/library/ir_interpreter.cpp",
  "run npm run fetch:lean",
);
if (await exists("third_party/lean4-src/.git")) {
  await checkLeanSourceCommit();
}

const wasiPath = process.env.WASI_SDK_PATH ?? ".tools/wasi-sdk";
await checkPath(
  "WASI clang++",
  resolve(wasiPath, "bin", "clang++"),
  "run npm run install:wasi or set WASI_SDK_PATH",
  fsConstants.X_OK,
);

await checkPath("upstream WASM", "web/public/vir-upstream.wasm", "run npm run build:demo");
await checkPath("browser package", "web/public/fixtures-basic.irpkg", "run npm run build:demo");

const chromium = await chromiumPath();
if (chromium) {
  record("ok", "Chromium", chromium);
} else {
  record("warn", "Chromium", "not found; set CHROMIUM=/path/to/chromium for npm run test:pages:browser");
}

const failures = checks.filter((check) => check.kind === "fail");
const warnings = checks.filter((check) => check.kind === "warn");
console.log();
console.log(`doctor summary: ${checks.length - failures.length - warnings.length} ok, ${warnings.length} warnings, ${failures.length} failures`);
if (failures.length !== 0) {
  process.exit(1);
}
