import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";

for (const failure of ["exit", "spawn"]) {
  test(`cache campaign retains evidence on ${failure} failure without --keep`, () => {
    const root = mkdtempSync(path.join(tmpdir(), "vir-cache-failure-test-"));
    try {
      const producer = path.join(root, "input");
      const bin = path.join(root, "bin");
      mkdirSync(producer);
      mkdirSync(bin);
      writeFileSync(
        path.join(producer, "lakefile.lean"),
        "-- startup failure control\n",
      );
      writeFileSync(path.join(producer, "lean-toolchain"), "unused\n");
      if (failure === "exit") {
        writeFileSync(
          path.join(bin, "lake"),
          "#!/bin/sh\necho captured-stdout\necho captured-stderr >&2\nexit 7\n",
          { mode: 0o755 },
        );
      }
      const result = spawnSync(
        process.execPath,
        [
          path.join(repositoryRoot, "tests/packages/lake-cache-artifacts.mjs"),
          "--producer",
          producer,
        ],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            TMPDIR: root,
            PATH: bin,
            VIR_LAKE_CACHE_ARTIFACTS_KEEP: "0",
          },
        },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      const retained = readdirSync(root).filter((name) =>
        name.startsWith("vir-lake-cache-artifacts-"),
      );
      assert.equal(retained.length, 1, "failed campaign deleted its workspace");
      const workspace = path.join(root, retained[0]);
      assert.ok(
        result.stdout.includes(
          `VIR Lake cache artifact workspace: ${workspace}`,
        ),
      );
      const log = readFileSync(path.join(workspace, "logs/cold.log"), "utf8");
      if (failure === "exit") {
        assert.match(log, /captured-stdout/);
        assert.match(log, /captured-stderr/);
      } else {
        assert.match(log, /spawnSync lake ENOENT/);
      }
    } finally {
      // These are deliberately failed startup controls, not real campaign evidence.
      rmSync(root, { recursive: true, force: true });
    }
  });
}
