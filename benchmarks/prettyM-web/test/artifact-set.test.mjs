import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  canonicalJson,
  createTar,
  extractTar,
  safeArchivePath,
  verifyArtifactSet,
} from "../scripts/artifact-set-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = join(appRoot, "test-results", "artifact-set-unit");

test("creates a deterministic normalized tar and extracts only regular files", async () => {
  const source = join(scratch, "source");
  const extracted = join(scratch, "extracted");
  await rm(scratch, { recursive: true, force: true });
  await mkdir(join(source, "nested"), { recursive: true });
  await writeFile(join(source, "z.txt"), "last\n");
  await writeFile(join(source, "nested", "a.txt"), "first\n");

  const paths = ["z.txt", "nested/a.txt"];
  const first = await createTar(source, paths);
  const second = await createTar(source, paths.toReversed());
  assert.deepEqual(first, second);
  assert.deepEqual(await extractTar(first, extracted), [
    "nested/a.txt",
    "z.txt",
  ]);
  assert.equal(await readFile(join(extracted, "nested", "a.txt"), "utf8"), "first\n");
  assert.equal(await readFile(join(extracted, "z.txt"), "utf8"), "last\n");
});

test("rejects unsafe paths and corrupted headers", async () => {
  for (const path of ["/absolute", "../escape", "a/../escape", "a\\b"])
    assert.throws(() => safeArchivePath(path), /unsafe archive path/);

  const source = join(scratch, "corrupt-source");
  const extracted = join(scratch, "corrupt-extracted");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "safe.txt"), "safe\n");
  const archive = await createTar(source, ["safe.txt"]);
  archive[0] ^= 1;
  await assert.rejects(() => extractTar(archive, extracted), /tar checksum/);
});

test("canonical JSON is independent of object insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, b: 3 } }),
    canonicalJson({ a: { b: 3, y: 2 }, z: 1 }),
  );
});

test("rejects undeclared artifact-set members", async () => {
  const directory = join(scratch, "unexpected-member");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "ARTIFACT_SET.json"),
    canonicalJson({
      schemaVersion: 1,
      kind: "prettyM-artifact-set",
      setId: "prettyM-test",
      files: {},
    }),
  );
  await writeFile(join(directory, "SHA256SUMS"), "");
  await writeFile(join(directory, "surprise.txt"), "not declared\n");
  await assert.rejects(
    () => verifyArtifactSet(directory),
    /unexpected member/,
  );
});
