import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { normalizeTypeAnchorManifest } from "../../scripts/bindings/type-anchor-manifest.mjs";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";

test("type anchor normalization preserves module provenance and reviewed aliases", () => {
  const manifest = {
    metadata: { targets: [{ module: "TypeAnchorFixture", mode: "explicit" }] },
    exports: [{ entry: "identity", source: "module TypeAnchorFixture" }],
    hostImports: [{ source: "imported by module TypeAnchorFixture" }],
  };
  const aliases = [
    {
      lean: "Root",
      via: "identity",
      descriptor: "resource",
      source: "fixtures/Root.lean",
    },
  ];
  const before = structuredClone(manifest);
  assert.deepEqual(normalizeTypeAnchorManifest(manifest, []), manifest);
  const normalized = normalizeTypeAnchorManifest(manifest, aliases);
  assert.deepEqual(normalized, {
    ...manifest,
    metadata: { ...manifest.metadata, typeAnchorAliases: aliases },
  });
  assert.deepEqual(manifest, before);
  assert.equal(Object.hasOwn(normalized.metadata, "generatedAt"), false);
});

test("type anchor CLI rejects source inputs and unsafe module/output arguments before building", () => {
  const standard = [
    "--roots",
    "fixtures/type-anchors/vir-v1.roots.txt",
    "--out",
    "build/type-descriptors/unit-only.manifest.json",
  ];
  for (const [args, diagnostic] of [
    [["--source", "Fixture.lean"], /unknown option --source/],
    [standard, /--module is required/],
    [[...standard, "--module", "Fixture.lean"], /module identity/],
    [[...standard, "--module", "+TypeAnchorFixture"], /module identity/],
    [
      [
        ...standard,
        "--module",
        "TypeAnchorFixture",
        "--package",
        "same",
        "--report",
        "same",
      ],
      /output collision/,
    ],
    [
      [
        ...standard,
        "--module",
        "TypeAnchorFixture",
        "--package",
        "build/type-descriptors/unit-only.manifest.json",
      ],
      /manifest output must differ/,
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/bindings/generate-lean-type-anchor-manifest.mjs", ...args],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, diagnostic);
    assert.equal(result.stdout, "");
  }
});
