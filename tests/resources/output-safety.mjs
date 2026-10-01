// Run only in an owned isolated fixture. Restore every moved path even on failure.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function checkFacetOutputSafety({ client, env, evidence }) {
  const buildDir = join(client, "build with spaces");
  const failures = [];
  for (const [relative, ancestors, suffixes] of [
    [
      "vir/resources/programs/ClientResources.virres",
      ["vir", "vir/resources", "vir/resources/programs", null],
      ["", ".trace", ".hash"],
    ],
    [
      "vir/programs/Client/Program.virprogram",
      ["vir/programs", "vir/programs/Client", null],
      ["", ".trace", ".hash"],
    ],
    ["vir/programs/Client/Program.setup.json", [null], [""]],
  ]) {
    for (const ancestor of ancestors) {
      for (const suffix of ancestor ? [null] : suffixes) {
        const label = `output-safety-${relative.replaceAll("/", "-")}-${ancestor?.replaceAll("/", "-") ?? (suffix || "pack")}`;
        const dir = join(evidence, label);
        mkdirSync(dir);
        const victim = join(buildDir, ancestor ?? relative + suffix);
        const retained = join(dir, "retained");
        const target = join(dir, "outside");
        const sentinel = Buffer.from(`untouched ${label}\n`);
        const files = ancestor
          ? [
              join(target, relative.slice(ancestor.length + 1)),
              join(target, relative.slice(ancestor.length + 1) + ".setup.json"),
            ]
          : [target];
        for (const file of files) {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, sentinel);
        }
        mkdirSync(dirname(victim), { recursive: true });
        const existed = existsSync(victim);
        if (existed) renameSync(victim, retained);
        symlinkSync(target, victim);
        try {
          const result = spawnSync(
            "lake",
            ["build", "ClientResources:virResourcePack"],
            {
              cwd: client,
              env,
              encoding: "utf8",
              timeout: 180000,
              maxBuffer: 8 * 1024 * 1024,
            },
          );
          const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
          writeFileSync(join(dir, "build.log"), log);
          assert.ifError(result.error);
          // Check preservation before diagnostics: an eventual rejection is too late.
          for (const file of files)
            assert.deepEqual(readFileSync(file), sentinel, file);
          assert.ok(
            lstatSync(victim).isSymbolicLink(),
            "guard must not unlink aliases",
          );
          assert.notEqual(result.status, 0, log);
          assert.match(log, /UNSAFE_RESOURCE_(DIRECTORY|FILE)/);
        } catch (error) {
          failures.push(`${label}: ${error.message}`);
        } finally {
          // This is the symlink we created, never its external target.
          try {
            if (lstatSync(victim).isSymbolicLink()) unlinkSync(victim);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          if (existsSync(victim))
            renameSync(victim, join(dir, "unexpected-output"));
          if (existed) renameSync(retained, victim);
        }
      }
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
}
