/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("source fetching selects the pinned distribution and rejects a different compiler", async () => {
  const root = await mkdtemp("/tmp/vir-fetch-source-");
  try {
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "bin"));
    await copyFile(new URL("../../scripts/fetch-lean-source.sh", import.meta.url), join(root, "scripts/fetch.sh"));
    const log = join(root, "git.jsonl");
    await writeFile(join(root, "bin/git"), `#!${process.execPath}
const fs = require("node:fs"), args = process.argv.slice(2);
fs.appendFileSync(process.env.GIT_LOG, JSON.stringify(args)+"\\n");
if (args.includes("rev-parse")) console.log("a".repeat(40));
if (args[0] === "clone") fs.mkdirSync("third_party/lean4-src/.git", {recursive:true});
`, { mode: 0o755 });
    await writeFile(join(root, "bin/lean"), "#!/bin/sh\nprintf '%s\\n' \"$COMPILER_REV\"\n", { mode: 0o755 });
    const run = () => spawnSync("bash", ["scripts/fetch.sh"], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, GIT_LOG: log,
        COMPILER_REV: "a".repeat(40) },
    });
    await writeFile(join(root, "lean-toolchain"), "leanprover/lean4:v4.35.0\n");
    assert.equal(run().status, 0);
    await writeFile(join(root, "lean-toolchain"), "leanprover/lean4-nightly:nightly-2026-10-13\n");
    assert.equal(run().status, 0);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.ok(calls.some(args => args[0] === "clone" && args.includes("v4.35.0") && args.includes("https://github.com/leanprover/lean4.git")));
    assert.ok(calls.some(args => args.includes("fetch") && args.includes("nightly-2026-10-13") && args.includes("https://github.com/leanprover/lean4-nightly.git")));
    const mismatch = spawnSync("bash", ["scripts/fetch.sh"], {
      cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`,
        GIT_LOG: log, COMPILER_REV: "b".repeat(40) },
    });
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /does not match the pinned compiler revision/);
    await writeFile(join(root, "lean-toolchain"), "leanprover/lean4-nightly:nightly\n");
    const before = await readFile(log, "utf8");
    assert.equal(run().status, 1);
    assert.equal(await readFile(log, "utf8"), before, "floating nightly rejected before fetching");
  } finally { await rm(root, { recursive: true, force: true }); }
});
