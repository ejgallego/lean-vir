/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkReleaseTag, releaseTagFromToolchain } from "../../scripts/release-tag.mjs";

for (const [toolchain, expected] of [
  ["leanprover/lean4:v4.35.0-rc4\n", "v4.35.0-rc4"],
  ["leanprover/lean4:v4.35.0", "v4.35.0"],
  ["leanprover/lean4:v4.35.1", "v4.35.1"],
  ["leanprover/lean4:v4.36.0-rc1", "v4.36.0-rc1"],
]) test(`Lean release tag: ${expected}`, () => assert.equal(releaseTagFromToolchain(toolchain), expected));

for (const toolchain of ["leanprover/lean4:nightly", "custom-lean", "leanprover/lean4:v4.35", "leanprover/lean4:v4.35.0-rc4-extra"])
  test(`unsupported release toolchain: ${toolchain}`, () => assert.throws(() => releaseTagFromToolchain(toolchain), /unsupported release toolchain/));

test("milestone and mismatched Lean tags cannot publish", () => {
  for (const tag of ["v0.1.0", "0.1.1", "4.34", "4.35", "4.35-rc3", "4.35-rc4",
    "v4.35-rc4", "v4.35.0", "v4.35.0-rc3"])
    assert.throws(() => checkReleaseTag(tag, "leanprover/lean4:v4.35.0-rc4"), /expected v4\.35\.0-rc4/);
});

test("workflow command checks the pinned toolchain from outside the checkout", async () => {
  const script = fileURLToPath(new URL("../../scripts/release-tag.mjs", import.meta.url));
  const toolchain = await readFile(new URL("../../lean-toolchain", import.meta.url), "utf8");
  const expected = releaseTagFromToolchain(toolchain);
  const result = spawnSync(process.execPath, [script, "--check", expected], { cwd: "/tmp", encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), expected);
  const wrong = spawnSync(process.execPath, [script, "--check", "0.1.1"], { cwd: "/tmp", encoding: "utf8" });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /does not match lean-toolchain/);
});

for (const [tag, exists] of [["v4.36.0-rc1", false], ["v4.36.0", false], ["v4.36.0-rc1", true]]) {
  test(`publishing metadata: ${tag}, existing=${exists}`, async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const directory = await mkdtemp(join(tmpdir(), "vir-release-tag-"));
    try {
      const workflow = await readFile(new URL("../../.github/workflows/release-sdk.yml", import.meta.url), "utf8");
      const publish = workflow.split("      - name: Publish durable runtime artifacts\n")[1];
      assert.ok(publish, "publishing step exists");
      const script = publish.split("        run: |\n")[1].split("\n")
        .map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");
      const bin = join(directory, "bin"), log = join(directory, "commands.jsonl");
      await mkdir(bin);
      for (const command of ["gh", "node"]) {
        await writeFile(join(bin, command), `#!${process.execPath}\n` +
          `const fs=require('node:fs');const args=process.argv.slice(2);\n` +
          `fs.appendFileSync(process.env.COMMAND_LOG,JSON.stringify({command:${JSON.stringify(command)},args})+'\\n');\n` +
          `if(${JSON.stringify(command)}==='gh'&&args[0]==='release'&&args[1]==='view')process.exit(process.env.RELEASE_EXISTS==='true'?0:1);\n`,
        { mode: 0o755 });
      }
      const result = spawnSync("bash", ["-eu", "-c", script], {
        cwd: directory, encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COMMAND_LOG: log,
          RELEASE_EXISTS: String(exists), GITHUB_REF_NAME: tag },
      });
      assert.equal(result.status, 0, result.stderr);
      const commands = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
      const creation = commands.find(item => item.command === "gh" && item.args[1] === "create");
      if (exists) assert.equal(creation, undefined, "existing release is reused");
      else {
        assert.equal(creation.args[2], tag);
        assert.equal(creation.args.includes("--prerelease"), tag.includes("-rc"));
        assert.equal(creation.args.includes("--latest=false"), tag.includes("-rc"));
        assert.ok(creation.args.includes("--verify-tag"));
      }
      assert.ok(commands.some(item => item.command === "node" &&
        item.args[0] === "scripts/resources/publish-runtime.mjs" && item.args[1] === tag));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
