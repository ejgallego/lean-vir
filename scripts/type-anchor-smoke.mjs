#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const tmp = await mkdtemp(join(tmpdir(), "lean-vir-type-anchors-"));

try {
  const types = join(tmp, "types.d.ts");
  const anchors = join(tmp, "anchors.json");
  const descriptors = join(tmp, "descriptors.json");
  const manifest = join(tmp, "manifest.json");
  const report = join(tmp, "report.json");
  const rendered = join(tmp, "anchors.md");

  await writeFile(types, `export namespace Demo {
  /** Box hover docs. */
  export interface Box {
    value: string;
  }

  /** Lean exact integer shape. */
  export type Count = string | number | bigint;

  /** Callable fixture. */
  export type BoxFn = (box: Demo.Box, count: Demo.Count) => Demo.Box;
}
`);

  await writeFile(anchors, `${JSON.stringify({
    version: 1,
    anchors: [
      { id: "box", lean: "Demo.Box", ts: "Demo.Box" },
      { id: "box_fn", lean: "Demo.bump", ts: "Demo.BoxFn" },
      { id: "missing", lean: "Demo.Missing", ts: "Demo.Box" },
    ],
  }, null, 2)}\n`);

  const boxType = {
    type: "Demo.Box",
    wireTag: 20,
    kind: "structure",
    name: "Demo.Box",
    objectFieldCount: 1,
    usizeFieldCount: 0,
    scalarByteSize: 0,
    fields: [
      {
        name: "value",
        type: { type: "String", wireTag: 3 },
        layout: { kind: "object", index: 0 },
      },
    ],
  };

  await writeFile(manifest, `${JSON.stringify({
    version: 1,
    artifact: "lean-vir-ir-package",
    metadata: {},
    exports: [
      {
        id: "bump",
        jsName: "bump",
        entry: "Demo.bump",
        source: "Demo.lean",
        args: [
          { name: "box", type: boxType },
          { name: "count", type: { type: "Nat", wireTag: 0 } },
        ],
        result: boxType,
        effect: "pure",
      },
    ],
    hostImports: [],
    diagnostics: [],
  }, null, 2)}\n`);

  run(["scripts/generate-ts-descriptors.mjs", "--anchors", anchors, "--out", descriptors, types]);
  run(["scripts/check-type-anchors.mjs", "--descriptors", descriptors, "--manifest", manifest, "--out", report]);
  run(["scripts/render-type-anchors.mjs", "--report", report, "--out", rendered]);

  const comparison = JSON.parse(await readFile(report, "utf8"));
  assert.deepEqual(comparison.summary, {
    exact: 1,
    compatible: 1,
    weak: 0,
    missing: 1,
  });
  const markdown = await readFile(rendered, "utf8");
  assert.match(markdown, /href="types\.d\.ts#L3-L5"/);
  assert.match(markdown, /title="exact: Demo\.Box -&gt; Demo\.Box/);
  assert.match(markdown, /missing Lean descriptor Demo\.Missing/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log("type anchor smoke ok");

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
