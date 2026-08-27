/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
} from "../../scripts/packages/browser-package-config.mjs";
import { assertDistReady, requiredDistFiles } from "./harness.mjs";
import { isGeneratedPublicFile } from "../../scripts/packages/artifact-bundle.mjs";
import { IR_PACKAGE_MAGIC } from "../../scripts/packages/irpkg-format.mjs";
import {
  PACKAGE_FORMAT_VERSION,
  INTERFACE_MANIFEST_VERSION,
  RUNTIME_ABI_VERSION,
} from "../../scripts/packages/package-versions.mjs";
import { SDK_METADATA_FILES } from "../../scripts/packages/sdk-metadata.mjs";
import { sdkArchiveEntries } from "../../scripts/packages/sdk-payloads.mjs";

const distDir = new URL("../../web/dist/", import.meta.url);
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
    "lean-vir-local/demo.html",
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
  assert.ok(
    /(?:src|href)="\.\/assets\//.test(indexHtml),
    "local bundle should use relative asset paths",
  );
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
  assert.equal(manifest.packageFormatVersion, PACKAGE_FORMAT_VERSION);
  assert.equal(manifest.manifestVersion, INTERFACE_MANIFEST_VERSION);
  assert.equal(manifest.runtimeAbiVersion, RUNTIME_ABI_VERSION);
  assert.ok(Array.isArray(manifest.files));
  assert.equal(manifest.browser?.webAssetsModule, "js/vir-web-assets.js");
  assert.equal(manifest.browser?.runtimeModule, "js/vir-runtime.js");
  assert.equal(manifest.browser?.wasm, "wasm/vir-upstream.wasm");
  const browserFiles = new Set(manifest.browser?.files);
  for (const required of [
    ...SDK_METADATA_FILES,
    "js/vir-web-assets.js",
    "js/vir-runtime.js",
    "wasm/vir-upstream.wasm",
  ]) {
    assert.ok(browserFiles.has(required), `SDK browser profile omits ${required}`);
  }
  for (const excluded of [
    "wasm/vir-upstream.dev.wasm",
    "js/vir-runtime-node.js",
    "js/vir-react-host-bindings.js",
  ]) {
    assert.ok(!browserFiles.has(excluded), `SDK browser profile includes ${excluded}`);
  }
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  for (const path of SDK_METADATA_FILES) {
    const file = files.get(path);
    assert.ok(file, `SDK manifest does not list ${path}`);
    const { stdout: contents } = await execFileAsync("tar", ["-xOzf", archivePath, `lean-vir-sdk/${path}`]);
    assert.equal(file.byteSize, Buffer.byteLength(contents));
    assert.equal(file.sha256, createHash("sha256").update(contents).digest("hex"));
  }
  const { stdout: readme } = await execFileAsync("tar", ["-xOzf", archivePath, "lean-vir-sdk/README.txt"]);
  assert.match(readme, /one-root Lean library named for the program/);
  assert.match(readme, /one live Wasm instance and Lean heap/);
}

async function assertSurfaceReport() {
  const html = (await assertFile("surface/index.html", 100)).toString("utf8");
  assert.ok(html.includes("assets/app.js"), "surface report should load its application asset");
  assert.ok(html.includes("data/index.js"), "surface report should load its navigation index");
  await assertFile("surface/assets/app.js", 1024);
  await assertFile("surface/assets/style.css", 1024);
  await assertFile("surface/data/index.js", 1024);
  const sizeLinks = JSON.parse(await assertFile("surface/data/size-links.json", 100));
  assert.equal(sizeLinks.format, "lean-vir-surface-size-links");
  assert.equal(sizeLinks.version, 2);
  assert.ok(sizeLinks.externs.some((declaration) => declaration.targets.length > 0),
    "surface report should export backend targets for the size-report bridge");
  assert.ok(sizeLinks.externs.some((declaration) => declaration.primaryRoots > 0),
    "surface report should export measured primary-blocker pressure");
  assert.ok(sizeLinks.externs.some((declaration) => declaration.frontierCosts?.length > 0),
    "surface report should export exact frontier costs for the size-report bridge");

  const manifest = JSON.parse(await assertFile("surface/vir-surface-html.json", 100));
  assert.equal(manifest.format, "lean-vir-surface-html");
  assert.ok(manifest.selectedModules > 0, "surface report should select Lean library modules");
  assert.ok(manifest.declarations > 0, "surface report should contain Lean IR declarations");
  assert.ok(manifest.moduleDataFiles > 0, "surface report should contain per-module data files");
  assert.ok(manifest.frontierCosts?.candidates > 0,
    "surface report should contain current exact frontier measurements");
  assert.equal(manifest.frontierCosts.failedCandidates, 0,
    "surface report should not publish failed frontier measurements");
}

async function assertWasmSizeReport() {
  const html = (await assertFile("size/index.html", 100)).toString("utf8");
  assert.ok(html.includes("assets/app.js"), "Wasm size report should load its application asset");
  assert.ok(html.includes("data/index.js"), "Wasm size report should load its size index");
  await assertFile("size/assets/app.js", 1024);
  await assertFile("size/assets/style.css", 1024);
  await assertFile("size/data/index.js", 1024);

  const manifest = JSON.parse(await assertFile("size/vir-wasm-size-html.json", 100));
  assert.equal(manifest.format, "lean-vir-wasm-size-html");
  assert.ok(manifest.binaries.release.rawBytes > 0, "Wasm size report should describe a non-empty release binary");
  assert.ok(manifest.binaries.debug.rawBytes >= manifest.binaries.release.rawBytes,
    "Wasm size report debug companion should be at least as large as the stripped release binary");
  if (manifest.build?.profile === "release") {
    assert.ok(manifest.binaries.debug.rawBytes > manifest.binaries.release.rawBytes,
      "release Pages builds should strip the public Wasm while retaining a larger debug companion");
  }
  assert.ok(manifest.attribution.coverage > 0.99, "Wasm size report should attribute nearly all Code+Data bytes");
  assert.ok(manifest.attribution.objects > 0, "Wasm size report should contain retained objects");
  assert.ok(manifest.attribution.symbols > 0, "Wasm size report should contain retained symbols");
  assert.ok(manifest.attribution.connectedSymbols > 0,
    "Wasm size report should connect retained symbols to runnable-surface declarations");
  assert.ok(manifest.frontierCosts?.candidates > 0,
    "Wasm size report should contain current exact frontier measurements");
  assert.equal(manifest.frontierCosts.failedCandidates, 0,
    "Wasm size report should not publish failed frontier measurements");
  assert.equal(manifest.runtimeContext.archives, 3);
  assert.equal(manifest.runtimeContext.sourceMembers, manifest.runtimeContext.members,
    "every runtime-context member should have exact Lean source provenance");
  assert.equal(
    manifest.runtimeContext.nativeMembers + manifest.runtimeContext.programMembers,
    manifest.runtimeContext.members,
    "runtime context should separate native support from compiled Lean program members",
  );
  assert.ok(manifest.runtimeContext.members > manifest.runtimeContext.boundaryMembers,
    "runtime context should contain both inside- and outside-boundary archive members");
  assert.ok(manifest.runtimeContext.boundaryMembers > 0,
    "runtime context should identify current VIR boundary members");
  assert.ok(
    manifest.runtimeContext.boundaryDensity > 0
      && manifest.runtimeContext.boundaryDensity < 1,
    "runtime context should compute partial inside-boundary byte density",
  );
  assert.ok(manifest.runtimeContext.missingSurfaceEntries > 0,
    "runtime context should identify already-retained missing extern entries");
  assert.ok(manifest.runtimeContext.primaryRoots > 0,
    "runtime context should quantify measured primary-blocker pressure");
  assert.ok(manifest.runtimeContext.maxFrontierDensity > 0,
    "runtime context should normalize measured primary-blocker density");
  assert.ok(manifest.runtimeContext.sizedFunctions > 0,
    "runtime context should expose native functions below archive members");
  assert.ok(manifest.runtimeContext.sizedFunctionBytes > 0,
    "runtime context should measure native function bytes");
  assert.equal(
    manifest.runtimeContext.sizedFunctionBytes + manifest.runtimeContext.nonFunctionBytes,
    manifest.runtimeContext.memberBytes,
    "native function and explicit overhead bytes should cover every archive member byte",
  );
  assert.ok(manifest.runtimeContext.retainedFunctions > 0,
    "runtime context should match native functions to retained Wasm symbols");
  assert.ok(manifest.runtimeContext.retainedFunctions < manifest.runtimeContext.boundarySizedFunctions,
    "exact retained-function matching should refine whole-object boundary membership");
  assert.ok(
    manifest.runtimeContext.retainedNativeFunctionBytes
      <= manifest.runtimeContext.boundarySizedFunctionBytes,
    "matched native function bytes should fit within boundary-object function bytes",
  );
  assert.ok(manifest.runtimeContext.retainedWasmFunctionBytes > 0,
    "matched native functions should expose retained Wasm bytes");
}

const indexHtml = await assertHtmlAssetLinks("index.html");
const demoHtml = await assertHtmlAssetLinks("demo.html");
const devHtml = await assertHtmlAssetLinks("dev.html");
const formatHtml = await assertHtmlAssetLinks("format.html");
const reactHtml = await assertHtmlAssetLinks("react.html");

assertLink(indexHtml, "demo.html");
assertLink(indexHtml, "dev.html");
assertLink(indexHtml, "react.html");
assertLink(indexHtml, "downloads/lean-vir-local.tar.gz");
assertLink(indexHtml, "downloads/lean-vir-sdk.tar.gz");
assertLink(indexHtml, "surface/");
assertLink(indexHtml, "size/");
assertLink(indexHtml, "format.html?case=list&amp;width=12");
assertLink(indexHtml, "benchmarks/");
assertLink(demoHtml, "index.html");
assertLink(demoHtml, "surface/");
assertLink(demoHtml, "size/");
assertLink(demoHtml, "dev.html?package=local-quickstart.irpkg&amp;entry=Quickstart.total");
assertLink(demoHtml, `dev.html?package=${defaultPackageFile}&amp;entry=Vir_Fixtures_InterfaceShapes_profileStatsBump`);
assertLink(demoHtml, `dev.html?package=${hostPackageFile}&amp;entry=HostInterop_titleHandshake`);
assertLink(demoHtml, `dev.html?package=${leanPackageFile}&amp;entry=Vir_Fixtures_ExprPrinter_exprKindScore`);
assertLink(demoHtml, `dev.html?package=${boundaryPackageFile}&amp;entry=Vir_Fixtures_Boundary_floatScaleScore`);
assert.ok(devHtml.includes("dev-package-url"), "dev.html should contain package runner controls");
assert.ok(devHtml.includes("dev-package-preset"), "dev.html should contain package presets");
assert.ok(devHtml.includes("npm run generate:irpkg -- path/File.lean"), "dev.html should show the package command shape");
assert.ok(formatHtml.includes("format-width-range"), "format.html should contain width controls");
assert.ok(formatHtml.includes("format-output"), "format.html should contain rendered output controls");
assert.ok(reactHtml.includes("react-pet-root"), "react.html should contain the React Tamagotchi mount");
assert.ok(!reactHtml.includes("react-counter-root"), "react.html should keep tutorial counters out of the flagship page");

for (const file of generatedPublicFiles) {
  await assertFile(file, minGeneratedPublicFileSize(file));
}
await assertDistReady(fileURLToPath(distDir));
await assertStalePackageRejectedBeforeBrowser();
await assertLocalBundle("downloads/lean-vir-local.tar.gz");
await assertSdkBundle("downloads/lean-vir-sdk.tar.gz");
await assertSurfaceReport();
await assertWasmSizeReport();

console.log(`pages artifact ok: ${join("web", "dist")} contains landing, runtime diagnostics, runner, React Tamagotchi, format workbench, runnable-surface and Wasm-size reports, wasm, focused manifest packages, local bundle, and SDK bundle`);

function minGeneratedPublicFileSize(file) {
  return localPackageFileSet.has(file) ? 128 : 1024;
}

async function assertStalePackageRejectedBeforeBrowser() {
  const staleRoot = await mkdtemp(join(tmpdir(), "lean-vir-stale-dist-"));
  try {
    for (const file of requiredDistFiles) {
      await copyFile(new URL(file, distDir), join(staleRoot, file));
    }
    const bytes = Uint8Array.from(await assertFile(defaultPackageFile, 128));
    const versionOffset = 4 + new TextEncoder().encode(IR_PACKAGE_MAGIC).byteLength;
    const staleVersion = PACKAGE_FORMAT_VERSION - 1;
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      .setUint32(versionOffset, staleVersion, true);
    await writeFile(join(staleRoot, defaultPackageFile), bytes);

    await assert.rejects(
      () => assertDistReady(staleRoot),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(defaultPackageFile));
        assert.match(error.message, new RegExp(`unsupported IR package version ${staleVersion}`));
        assert.match(error.message, /run npm run build:site first/);
        return true;
      },
    );
  } finally {
    await rm(staleRoot, { recursive: true, force: true });
  }
}
