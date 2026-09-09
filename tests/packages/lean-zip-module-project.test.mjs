import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLeanZipModuleProject } from "../../scripts/packages/lean-zip/module-project.mjs";

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "vir-zip-project-unit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const client = join(root, 'client "quoted"');
  const producer = join(root, "producer with spaces");
  for (const path of [client, producer]) {
    await mkdir(path);
    await writeFile(join(path, "lean-toolchain"), "pinned-toolchain\n");
  }
  return { directory: join(root, "project"), client, producer };
}

test("dependent project names compiled roots without copying client configuration", async (t) => {
  const paths = await workspace(t);
  const originals = {
    "lakefile.lean": "client-specific configuration\n",
    "lake-manifest.json": '{"pins":"unchanged"}\n',
    "Client.lean": "uncommitted client source\n",
  };
  for (const [file, contents] of Object.entries(originals)) {
    await writeFile(join(paths.client, file), contents);
  }
  const project = await createLeanZipModuleProject(paths);
  assert.equal(project.directory, paths.directory);
  assert.ok(Object.isFrozen(project));
  const config = await readFile(
    join(project.directory, "lakefile.toml"),
    "utf8",
  );
  for (const path of [
    paths.client,
    paths.producer,
    join(paths.producer, "fixtures/lean-zip"),
  ]) {
    assert.ok(config.includes(JSON.stringify(path)));
  }
  assert.match(config, /roots = \["VirLeanZipAcceptance.Exports"\]/);
  assert.match(config, /root = "VirLeanZipAcceptance.NativeOracle"/);
  assert.doesNotMatch(config, /client-specific/);
  assert.equal(
    await readFile(join(project.directory, "lean-toolchain"), "utf8"),
    "pinned-toolchain\n",
  );
  for (const [file, contents] of Object.entries(originals)) {
    assert.equal(await readFile(join(paths.client, file), "utf8"), contents);
  }
});

test("toolchain mismatch fails before creating the project", async (t) => {
  const paths = await workspace(t);
  await writeFile(
    join(paths.client, "lean-toolchain"),
    "different-toolchain\n",
  );
  await assert.rejects(
    createLeanZipModuleProject(paths),
    /Lean toolchain mismatch/,
  );
  await assert.rejects(readdir(paths.directory), { code: "ENOENT" });
});

test("existing directories are never overwritten or removed", async (t) => {
  const paths = await workspace(t);
  await mkdir(paths.directory);
  await writeFile(join(paths.directory, "lakefile.toml"), "caller-owned\n");
  await assert.rejects(createLeanZipModuleProject(paths), { code: "EEXIST" });
  assert.equal(
    await readFile(join(paths.directory, "lakefile.toml"), "utf8"),
    "caller-owned\n",
  );
});
