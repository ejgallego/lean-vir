/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const distDir = new URL("../web/dist/", import.meta.url);
const execFileAsync = promisify(execFile);

async function assertFile(path, minSize = 1) {
  const file = new URL(path, distDir);
  await access(file);
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
  const expectedPayloads = new Set([
    "vir-upstream.wasm",
    "fixtures-basic.irpkg",
    "demo-host.irpkg",
    "pretty-printer.irpkg",
    "fixtures-lean.irpkg",
    "fixtures-boundary.irpkg",
    "local-quickstart.irpkg",
    "local-fib.irpkg",
    "local-mergesort.irpkg",
  ]);
  const requiredEntries = [
    "lean-vir-local/README.txt",
    "lean-vir-local/LICENSE",
    "lean-vir-local/NOTICE",
    "lean-vir-local/index.html",
    "lean-vir-local/dev.html",
    "lean-vir-local/format.html",
    "lean-vir-local/runtime-example.html",
    "lean-vir-local/vir-upstream.wasm",
    "lean-vir-local/local-quickstart.irpkg",
    "lean-vir-local/fixtures-basic.irpkg",
    "lean-vir-local/demo-host.irpkg",
  ];
  for (const entry of requiredEntries) {
    assert.ok(entries.has(entry), `local bundle missing ${entry}`);
  }
  for (const entry of entries) {
    const match = /^lean-vir-local\/([^/]+)$/.exec(entry);
    if (!match) continue;
    const basename = match[1];
    if (/\.(wasm|irpkg|input\.json|report\.md)$/.test(basename)) {
      assert.ok(expectedPayloads.has(basename), `local bundle contains unexpected generated payload ${entry}`);
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
  const requiredEntries = [
    "lean-vir-sdk/README.txt",
    "lean-vir-sdk/LICENSE",
    "lean-vir-sdk/NOTICE",
    "lean-vir-sdk/lean-vir-artifact.json",
    "lean-vir-sdk/wasm/vir-upstream.wasm",
    "lean-vir-sdk/js/vir-runtime.js",
    "lean-vir-sdk/js/vir-runtime-node.js",
    "lean-vir-sdk/js/vir-host-bindings.js",
    "lean-vir-sdk/js/interface-manifest.js",
  ];
  for (const entry of requiredEntries) {
    assert.ok(entries.has(entry), `SDK bundle missing ${entry}`);
  }
  const { stdout: manifestText } = await execFileAsync("tar", ["-xOzf", archivePath, "lean-vir-sdk/lean-vir-artifact.json"]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.packageFormatVersion, 5);
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.runtimeAbiVersion, 1);
  assert.ok(Array.isArray(manifest.files));
}

const indexHtml = await assertHtmlAssetLinks("index.html");
const devHtml = await assertHtmlAssetLinks("dev.html");
const formatHtml = await assertHtmlAssetLinks("format.html");

assertLink(indexHtml, "dev.html");
assertLink(indexHtml, "downloads/lean-vir-local.tar.gz");
assertLink(indexHtml, "downloads/lean-vir-sdk.tar.gz");
assertLink(indexHtml, "format.html?case=list&amp;width=12");
assertLink(indexHtml, "dev.html?package=local-quickstart.irpkg&amp;entry=Quickstart.total");
assertLink(indexHtml, "dev.html?package=fixtures-basic.irpkg&amp;entry=Vir_Fixtures_InterfaceShapes_profileStatsBump");
assertLink(indexHtml, "dev.html?package=demo-host.irpkg&amp;entry=HostInterop_titleHandshake");
assertLink(indexHtml, "dev.html?package=fixtures-lean.irpkg&amp;entry=Vir_Fixtures_ExprPrinter_exprKindScore");
assertLink(indexHtml, "dev.html?package=fixtures-boundary.irpkg&amp;entry=Vir_Fixtures_Boundary_floatScaleScore");
assert.ok(devHtml.includes("dev-package-url"), "dev.html should contain package runner controls");
assert.ok(devHtml.includes("dev-package-preset"), "dev.html should contain package presets");
assert.ok(devHtml.includes("npm run generate:irpkg -- path/File.lean"), "dev.html should show the package command shape");
assert.ok(formatHtml.includes("format-width-range"), "format.html should contain width controls");
assert.ok(formatHtml.includes("format-output"), "format.html should contain rendered output controls");

await assertFile("vir-upstream.wasm", 1024);
await assertFile("fixtures-basic.irpkg", 1024);
await assertFile("demo-host.irpkg", 1024);
await assertFile("pretty-printer.irpkg", 1024);
await assertFile("fixtures-lean.irpkg", 1024);
await assertFile("fixtures-boundary.irpkg", 1024);
await assertFile("local-quickstart.irpkg", 128);
await assertFile("local-fib.irpkg", 128);
await assertFile("local-mergesort.irpkg", 128);
await assertLocalBundle("downloads/lean-vir-local.tar.gz");
await assertSdkBundle("downloads/lean-vir-sdk.tar.gz");

console.log(`pages artifact ok: ${join("web", "dist")} contains landing, runner, format workbench, wasm, focused manifest packages, local bundle, and SDK bundle`);
