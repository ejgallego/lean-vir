/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  boundaryPackageFile,
  defaultPackageFile,
  generatedPublicFiles,
  hostPackageFile,
  leanPackageFile,
  localPackageFiles,
} from "./browser-package-config.mjs";
import { isGeneratedPublicFile } from "./file-utils.mjs";
import { sdkArchiveEntries } from "./sdk-payloads.mjs";

const distDir = new URL("../web/dist/", import.meta.url);
const execFileAsync = promisify(execFile);
const generatedPublicFileSet = new Set(generatedPublicFiles);
const localPackageFileSet = new Set(localPackageFiles);

async function assertFile(path, minSize = 1) {
  const file = new URL(path, distDir);
  const info = await stat(file);
  assert.ok(info.size >= minSize, `${path} should be at least ${minSize} bytes`);
  return readFile(file);
}

function assertLink(html, href) {
  assert.ok(html.includes(href), `missing landing link: ${href}`);
}

async function assertHtmlAssetLinks(htmlPath) {
  const html = (await assertFile(htmlPath, 100)).toString("utf8");
  for (const match of html.matchAll(/(?:src|href)="\/lean-vir\/(assets\/[^"]+)"/g)) {
    await assertFile(match[1], 1);
  }
  return html;
}

async function assertLocalBundle(path) {
  const archive = new URL(path, distDir);
  await assertFile(path, 1024);
  const archivePath = fileURLToPath(archive);
  const { stdout } = await execFileAsync("tar", ["-tzf", archivePath]);
  const entries = new Set(stdout.trim().split(/\r?\n/).filter(Boolean));
  const requiredEntries = [
    "lean-vir-local/README.txt",
    "lean-vir-local/LICENSE",
    "lean-vir-local/NOTICE",
    "lean-vir-local/index.html",
    "lean-vir-local/dev.html",
    "lean-vir-local/format.html",
    "lean-vir-local/react.html",
    "lean-vir-local/runtime-example.html",
    ...generatedPublicFiles.map((file) => `lean-vir-local/${file}`),
  ];
  for (const entry of requiredEntries) {
    assert.ok(entries.has(entry), `local bundle missing ${entry}`);
  }
  for (const entry of entries) {
    const match = /^lean-vir-local\/([^/]+)$/.exec(entry);
    if (!match) continue;
    const basename = match[1];
    if (isGeneratedPublicFile(basename)) {
      assert.ok(generatedPublicFileSet.has(basename), `local bundle contains unexpected generated payload ${entry}`);
    }
  }
  assert.ok(
    [...entries].some((entry) => entry.startsWith("lean-vir-local/assets/")),
    "local bundle should contain built Vite assets",
  );

  const { stdout: indexHtml } = await execFileAsync("tar", ["-xOzf", archivePath, "lean-vir-local/index.html"]);
  assert.ok(indexHtml.includes('src="./assets/'), "local bundle should use relative asset paths");
}

async function assertSdkBundle(path) {
  const archive = new URL(path, distDir);
  await assertFile(path, 1024);
  const archivePath = fileURLToPath(archive);
  const { stdout } = await execFileAsync("tar", ["-tzf", archivePath]);
  const entries = new Set(stdout.trim().split(/\r?\n/).filter(Boolean));
  for (const entry of sdkArchiveEntries()) {
    assert.ok(entries.has(entry), `SDK bundle missing ${entry}`);
  }
  const { stdout: manifestText } = await execFileAsync("tar", ["-xOzf", archivePath, "lean-vir-sdk/lean-vir-artifact.json"]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.packageFormatVersion, 7);
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.runtimeAbiVersion, 1);
  assert.ok(Array.isArray(manifest.files));
}

const indexHtml = await assertHtmlAssetLinks("index.html");
const devHtml = await assertHtmlAssetLinks("dev.html");
const formatHtml = await assertHtmlAssetLinks("format.html");
const reactHtml = await assertHtmlAssetLinks("react.html");

assertLink(indexHtml, "dev.html");
assertLink(indexHtml, "react.html");
assertLink(indexHtml, "downloads/lean-vir-local.tar.gz");
assertLink(indexHtml, "downloads/lean-vir-sdk.tar.gz");
assertLink(indexHtml, "format.html?case=list&amp;width=12");
assertLink(indexHtml, "dev.html?package=local-quickstart.irpkg&amp;entry=Quickstart.total");
assertLink(indexHtml, `dev.html?package=${defaultPackageFile}&amp;entry=Vir_Fixtures_InterfaceShapes_profileStatsBump`);
assertLink(indexHtml, `dev.html?package=${hostPackageFile}&amp;entry=HostInterop_titleHandshake`);
assertLink(indexHtml, `dev.html?package=${leanPackageFile}&amp;entry=Vir_Fixtures_ExprPrinter_exprKindScore`);
assertLink(indexHtml, `dev.html?package=${boundaryPackageFile}&amp;entry=Vir_Fixtures_Boundary_floatScaleScore`);
assert.ok(devHtml.includes("dev-package-url"), "dev.html should contain package runner controls");
assert.ok(devHtml.includes("dev-package-preset"), "dev.html should contain package presets");
assert.ok(devHtml.includes("npm run generate:irpkg -- path/File.lean"), "dev.html should show the package command shape");
assert.ok(formatHtml.includes("format-width-range"), "format.html should contain width controls");
assert.ok(formatHtml.includes("format-output"), "format.html should contain rendered output controls");
assert.ok(reactHtml.includes("react-counter-root"), "react.html should contain the React counter mount");
assert.ok(reactHtml.includes("react-attributes-root"), "react.html should contain the React attributes mount");
assert.ok(reactHtml.includes("react-pet-root"), "react.html should contain the React Tamagotchi mount");

for (const file of generatedPublicFiles) {
  await assertFile(file, minGeneratedPublicFileSize(file));
}
await assertLocalBundle("downloads/lean-vir-local.tar.gz");
await assertSdkBundle("downloads/lean-vir-sdk.tar.gz");

console.log(`pages artifact ok: ${join("web", "dist")} contains landing, runner, React review, format workbench, wasm, focused manifest packages, local bundle, and SDK bundle`);

function minGeneratedPublicFileSize(file) {
  return localPackageFileSet.has(file) ? 128 : 1024;
}
