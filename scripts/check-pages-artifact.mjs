/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const distDir = new URL("../web/dist/", import.meta.url);

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

const indexHtml = await assertHtmlAssetLinks("index.html");
const devHtml = await assertHtmlAssetLinks("dev.html");
const formatHtml = await assertHtmlAssetLinks("format.html");

assertLink(indexHtml, "dev.html");
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

console.log(`pages artifact ok: ${join("web", "dist")} contains landing, runner, format workbench, wasm, and focused manifest packages`);
