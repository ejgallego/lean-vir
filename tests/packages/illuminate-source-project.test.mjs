import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createSourceView,
  rootModule,
} from "../../scripts/packages/illuminate/source-project.mjs";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";

test("Illuminate adapter preserves pinned sources and isolates Lake configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vir-illuminate-project-"));
  try {
    const client = join(directory, "client");
    const outputs = join(directory, "outputs");
    await mkdir(client);
    await mkdir(outputs);
    const git = (...args) =>
      execFileSync("git", args, { cwd: client, stdio: "pipe" });
    git("init");
    const lakefile =
      'import Lake\nopen Lake DSL\nrequire lean_vir from "vir"\npackage illuminate\n';
    await writeFile(join(client, "lakefile.lean"), lakefile);
    await writeFile(join(client, "lean-toolchain"), "pinned-toolchain\n");
    await writeFile(
      join(client, "lake-manifest.json"),
      '{"pins":"unchanged"}\n',
    );
    git("add", ".");
    git(
      "-c",
      "user.name=VIR Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    );
    await writeFile(join(client, "lakefile.lean"), "uncommitted client edit\n");

    const project = await createSourceView(client, repositoryRoot, outputs);
    const config = await readFile(
      join(project.sourceView, "lakefile.lean"),
      "utf8",
    );
    assert.equal(
      config,
      `${lakefile}\nlean_lib VirIlluminateAcceptance where\n  roots := #[\`${rootModule}]\n`,
    );
    for (const file of ["lean-toolchain", "lake-manifest.json"]) {
      assert.deepEqual(
        await readFile(join(project.sourceView, file)),
        await readFile(join(client, file)),
      );
    }
    assert.deepEqual(
      await readFile(
        join(project.sourceView, "VirIlluminateAcceptance/Exports.lean"),
      ),
      await readFile(
        join(
          repositoryRoot,
          "fixtures/illuminate/VirIlluminateAcceptance/Exports.lean",
        ),
      ),
    );
    assert.equal(
      await readlink(join(project.sourceView, "vir")),
      repositoryRoot,
    );
    assert.equal(
      await readFile(join(client, "lakefile.lean"), "utf8"),
      "uncommitted client edit\n",
    );

    // A missing adapter must remove only its own partially prepared workspace.
    const before = await readdir(outputs);
    await assert.rejects(
      createSourceView(client, directory, outputs),
      /ENOENT/,
    );
    assert.deepEqual(await readdir(outputs), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
