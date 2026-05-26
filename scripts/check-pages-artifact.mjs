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

assertLink(indexHtml, "dev.html");
assertLink(indexHtml, "dev.html?package=local-fib.irpkg&amp;entry=fib");
assertLink(indexHtml, "dev.html?package=local-mergesort.irpkg&amp;entry=SortDemo_demoFromArray");
assertLink(indexHtml, "dev.html?package=demo-host.irpkg&amp;entry=HostInterop_titleHandshake");
assertLink(indexHtml, "dev.html?package=fixtures-basic.irpkg&amp;entry=Vir_Fixtures_InterfaceShapes_profileStatsBump");
assert.ok(devHtml.includes("dev-package-url"), "dev.html should contain package runner controls");

await assertFile("vir-upstream.wasm", 1024);
await assertFile("fixtures-basic.irpkg", 1024);
await assertFile("demo-host.irpkg", 1024);
await assertFile("fixtures-lean.irpkg", 1024);
await assertFile("fixtures-boundary.irpkg", 1024);
await assertFile("local-fib.irpkg", 128);
await assertFile("local-mergesort.irpkg", 128);

console.log(`pages artifact ok: ${join("web", "dist")} contains landing, runner, wasm, and focused manifest packages`);
