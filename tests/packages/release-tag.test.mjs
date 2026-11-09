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

// Execute the workflow's publication script, without parsing YAML or contacting
// GitHub. Each fake command records both ordering and the visibility transition.
async function publication({
  tag = "v4.36.0-rc1",
  state = "absent",
  fail = "",
  recoveryFails = false,
} = {}) {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "vir-release-tag-"));
  try {
    const bin = join(directory, "bin"),
      log = join(directory, "commands.jsonl");
    await mkdir(bin);
    for (const command of ["gh", "node", "npm", "git", "curl", "cmp", "lake"]) {
      await writeFile(
        join(bin, command),
        `#!${process.execPath}\n` +
          `const fs=require('node:fs');const args=process.argv.slice(2);const command=${JSON.stringify(command)};\n` +
          `fs.appendFileSync(process.env.COMMAND_LOG,JSON.stringify({command,args,override:process.env.VIR_RUNTIME_PACK})+'\\n');\n` +
          `if(command==='gh'&&args[1]==='view'){if(process.env.RELEASE_STATE==='absent')process.exit(1);console.log(process.env.RELEASE_STATE==='draft'?'true':'false');}\n` +
          `if(command==='gh'&&args[1]==='edit'&&args.includes('--draft')&&process.env.RECOVERY_FAILS==='true')process.exit(31);\n` +
          `if(command==='git')console.log('a'.repeat(40));\n` +
          `if(command===process.env.FAIL_COMMAND)process.exit(23);\n`,
        { mode: 0o755 },
      );
    }
    for (const name of ["runtime.virres", "sdk.tar.gz", "stale.virres"])
      await writeFile(join(directory, name), "fixture");
    const script = fileURLToPath(
      new URL("../../scripts/publish-sdk-release.sh", import.meta.url),
    );
    const result = spawnSync(
      "bash",
      [script, tag, "runtime.virres", "sdk.tar.gz", "stale.virres"],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          COMMAND_LOG: log,
          RELEASE_STATE: state,
          FAIL_COMMAND: fail,
          RECOVERY_FAILS: String(recoveryFails),
          GITHUB_REPOSITORY: "owner/vir",
          VIR_RUNTIME_PACK: "must-be-cleared",
        },
      },
    );
    const commands = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    return { ...result, commands };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
for (const [tag, state] of [
  ["v4.36.0-rc1", "absent"],
  ["v4.36.0", "absent"],
  ["v4.36.0-rc1", "public"],
  ["v4.36.0-rc1", "draft"],
]) {
  test(`publishing metadata: ${tag}, state=${state}`, async () => {
    const result = await publication({ tag, state });
    assert.equal(result.status, 0, result.stderr);
    const { commands } = result;
    const creation = commands.find(
      (item) => item.command === "gh" && item.args[1] === "create",
    );
    if (state !== "absent")
      assert.equal(creation, undefined, "existing release is reused");
    else {
      assert.equal(creation.args[2], tag);
      assert.equal(creation.args.includes("--prerelease"), tag.includes("-rc"));
      assert.equal(
        creation.args.includes("--latest=false"),
        tag.includes("-rc"),
      );
      assert.ok(creation.args.includes("--verify-tag"));
      assert.ok(creation.args.includes("--draft"));
    }
    assert.ok(
      commands.some(
        (item) =>
          item.command === "node" &&
          item.args[0] === "scripts/resources/publish-runtime.mjs" &&
          item.args[1] === tag,
      ),
    );
    const probe = commands.find((item) => item.command === "npm");
    assert.equal(
      probe.override,
      undefined,
      "public probe must use default selection",
    );
    assert.deepEqual(probe.args, [
      "run",
      "test:resources:published",
      "--",
      "--expect-runtime-pack",
      "runtime.virres",
      "--stale-runtime-pack",
      "stale.virres",
    ]);
    assert.ok(
      commands.some(
        (item) =>
          item.command === "lake" && item.args.join(" ") === "build :virSdk",
      ),
    );
    assert.ok(
      !commands.some(
        (item) => item.args.includes("--draft") && item.args[1] === "edit",
      ),
    );
  });
}
for (const state of ["absent", "draft", "public"]) {
  for (const fail of ["node", "npm", "cmp", "lake"]) {
    test(`publication failure: ${state}, ${fail}`, async () => {
      const result = await publication({ state, fail });
      assert.equal(result.status, 23, result.stderr);
      const recovery = result.commands.filter(
        (item) =>
          item.command === "gh" &&
          item.args[1] === "edit" &&
          item.args.includes("--draft"),
      );
      assert.equal(recovery.length, state === "public" ? 0 : 1);
      if (recovery.length)
        assert.ok(recovery[0].args.includes("--latest=false"));
      if (fail === "node")
        assert.ok(
          !result.commands.some((item) => item.args.includes("--draft=false")),
          "failed upload stays draft",
        );
    });
  }
}
test("failed recovery preserves qualification failure and requests manual repair", async () => {
  const result = await publication({ fail: "npm", recoveryFails: true });
  assert.equal(result.status, 23);
  assert.match(result.stderr, /RELEASE_RECOVERY_FAILED: manually return/);
});
