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
assertLink(indexHtml, "dev.html?package=local-fib.irpkg&amp;spec=local-fib.input.json&amp;entry=fib");
assertLink(indexHtml, "dev.html?package=local-mergesort.irpkg&amp;spec=local-mergesort.input.json&amp;entry=sort-array");
assertLink(indexHtml, "dev.html?package=vir-demo.irpkg&amp;entry=sort-array");
assert.ok(devHtml.includes("dev-package-url"), "dev.html should contain package runner controls");

await assertFile("vir-upstream.wasm", 1024);
await assertFile("vir-demo.irpkg", 1024);
await assertFile("local-fib.irpkg", 128);
await assertFile("local-mergesort.irpkg", 128);

const fibSpec = JSON.parse((await assertFile("local-fib.input.json", 1)).toString("utf8"));
assert.equal(fibSpec.version, 1);
assert.equal(fibSpec.entries?.[0]?.id, "fib");
assert.equal(fibSpec.entries?.[0]?.inputs?.[0]?.type, "Nat");

const mergeSpec = JSON.parse((await assertFile("local-mergesort.input.json", 1)).toString("utf8"));
assert.equal(mergeSpec.version, 1);
assert.ok(
  mergeSpec.entries?.some((entry) => entry.id === "sort-array" && entry.inputs?.[0]?.type === "Array Nat"),
  "mergesort spec should expose sort-array : Array Nat -> Nat",
);

console.log(`pages artifact ok: ${join("web", "dist")} contains landing, runner, wasm, packages, and specs`);
