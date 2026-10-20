/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestModuleProject } from "../support/module-project.mjs";

// Compile the same source used by the Wasm smoke test. Its #guards check writer
// preparation and literal output without requiring a published runtime or SDK.
const directory = await mkdtemp(join(tmpdir(), "vir-writer-native-"));
try {
  const project = await createTestModuleProject({ directory, modules: {
    JsonSafeWriterValues: await readFile(
      new URL("../../fixtures/runtime/JsonSafeWriterValues.lean", import.meta.url), "utf8"),
  } });
  const result = project.build();
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  console.log("JSON-safe writer native contracts passed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
