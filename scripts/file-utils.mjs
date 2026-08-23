/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";

const chromiumExecutablePaths = [
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  // Keep the snap launcher last: its transient systemd scope can fail before
  // Chromium starts even when a directly installed browser is available.
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const chromiumExecutableNames = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];

export async function copyFileWithDirs(source, dest) {
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(source, dest);
}

export async function pathExists(path, mode = fsConstants.R_OK) {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

function isPathLikeExecutableName(name) {
  return name.includes("/") || name.includes("\\");
}

async function isExecutable(path) {
  return pathExists(path, fsConstants.X_OK);
}

async function findExecutableInPath(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = resolve(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

export async function preferredExecutablePath(preferred, fallback) {
  return (await isExecutable(preferred)) ? preferred : fallback;
}

export async function findChromiumExecutable(configured = process.env.CHROMIUM) {
  if (configured) {
    if (isPathLikeExecutableName(configured)) {
      return (await isExecutable(configured)) ? configured : null;
    }
    return findExecutableInPath(configured);
  }
  for (const candidate of chromiumExecutablePaths) {
    if (await isExecutable(candidate)) return candidate;
  }
  for (const name of chromiumExecutableNames) {
    const found = await findExecutableInPath(name);
    if (found) return found;
  }
  return null;
}

export async function requireChromiumExecutable(configured = process.env.CHROMIUM) {
  const executable = await findChromiumExecutable(configured);
  if (executable) return executable;
  if (configured) {
    throw new Error(
      isPathLikeExecutableName(configured)
        ? `CHROMIUM is set to ${configured}, but that file is not executable`
        : `CHROMIUM is set to ${configured}, but it was not found on PATH`,
    );
  }
  throw new Error(
    `Chromium executable not found. Set CHROMIUM=/path/to/chromium before running npm run test:pages:browser`,
  );
}
