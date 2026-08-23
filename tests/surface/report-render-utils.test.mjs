/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  scriptSafeJson,
  stageStaticReportShell,
} from "../../scripts/analysis/report-render-utils.mjs";

test("scriptSafeJson prevents inline script termination and preserves JSON data", () => {
  const value = {
    markup: "</script><script>alert('unexpected')</script>",
    separators: "before\u2028middle\u2029after",
  };
  const encoded = scriptSafeJson(value);

  assert.equal(encoded.includes("<"), false);
  assert.equal(encoded.includes("\u2028"), false);
  assert.equal(encoded.includes("\u2029"), false);
  assert.match(encoded, /\\u003c\/script>/);
  assert.match(encoded, /\\u2028/);
  assert.match(encoded, /\\u2029/);
  assert.deepEqual(JSON.parse(encoded), value);
});

test("static report shells preserve their maintained source assets", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "vir-report-shell-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const templateDir = join(temporary, "template");
  const outputDir = join(temporary, "output");
  const assets = new Map([
    ["index.html", "<main>report</main>\n"],
    ["app.js", "globalThis.ready = true;\n"],
    ["style.css", "main { color: teal; }\n"],
  ]);
  await mkdir(templateDir, { recursive: true });
  await Promise.all(
    [...assets].map(async ([name, contents]) => {
      await writeFile(join(templateDir, name), contents);
    }),
  );

  const bytes = await stageStaticReportShell(templateDir, outputDir);

  assert.equal(
    bytes,
    [...assets.values()].reduce(
      (total, value) => total + Buffer.byteLength(value),
      0,
    ),
  );
  assert.equal(
    await readFile(join(outputDir, "index.html"), "utf8"),
    assets.get("index.html"),
  );
  assert.equal(
    await readFile(join(outputDir, "assets", "app.js"), "utf8"),
    assets.get("app.js"),
  );
  assert.equal(
    await readFile(join(outputDir, "assets", "style.css"), "utf8"),
    assets.get("style.css"),
  );
});
