import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractTar,
  inside,
  readJson,
  replaceDirectoryAtomically,
  sha256,
  verifyArtifactSet,
} from "./artifact-set-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const options = {
    lock: "artifact-set.lock.json",
    archive: null,
    setsDir: "_artifacts/sets",
    stage: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--lock") options.lock = argv[++index];
    else if (argument === "--archive") options.archive = argv[++index];
    else if (argument === "--sets-dir") options.setsDir = argv[++index];
    else if (argument === "--no-stage") options.stage = false;
    else if (argument === "--help" || argument === "-h") {
      console.log(`Usage: node scripts/fetch-artifact-set.mjs [options]

Fetch or import the locked artifact set, verify it before extraction, verify
every extracted member, and optionally stage it for the webapp. Local archive
overrides must remain inside this application directory.

  --lock PATH       lockfile (default: artifact-set.lock.json)
  --archive PATH    workspace-local release archive instead of lock URL
  --sets-dir PATH   verified installation root (default: _artifacts/sets)
  --no-stage        verify and install the set without staging artifacts`);
      process.exit(0);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

async function downloadArchive(lock) {
  const url = lock.archive?.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(
      "artifact set is not published yet; pass --archive with the workspace-local prototype release",
    );
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`artifact URL must use HTTPS: ${url}`);
  }
  const downloads = inside(appRoot, "_artifacts/downloads", "cache download");
  await mkdir(downloads, { recursive: true });
  const cached = resolve(downloads, `${lock.archive.sha256}.tar`);
  if (existsSync(cached)) {
    const bytes = await readFile(cached);
    if (bytes.length === lock.archive.bytes && sha256(bytes) === lock.archive.sha256) {
      return bytes;
    }
    await rm(cached, { force: true });
  }
  const response = await fetch(parsed, { redirect: "follow" });
  if (!response.ok) throw new Error(`artifact download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyArchive(bytes, lock);
  const partial = `${cached}.partial-${process.pid}`;
  await writeFile(partial, bytes);
  await rename(partial, cached);
  return bytes;
}

function verifyArchive(bytes, lock) {
  if (lock.archive?.format !== "ustar") {
    throw new Error(`unsupported artifact archive format: ${lock.archive?.format}`);
  }
  if (bytes.length !== lock.archive.bytes) {
    throw new Error(
      `artifact archive size mismatch: expected ${lock.archive.bytes}, got ${bytes.length}`,
    );
  }
  const digest = sha256(bytes);
  if (digest !== lock.archive.sha256) {
    throw new Error(`artifact archive digest mismatch: expected ${lock.archive.sha256}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const lockPath = inside(appRoot, options.lock, "read lockfile");
  const lock = await readJson(lockPath);
  if (
    ![1, 2].includes(lock.schemaVersion) ||
    typeof lock.setId !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(lock.setId)
  ) {
    throw new Error("unsupported artifact-set lockfile");
  }

  const bytes = options.archive
    ? await readFile(inside(appRoot, options.archive, "read archive"))
    : await downloadArchive(lock);
  verifyArchive(bytes, lock);

  const sets = inside(appRoot, options.setsDir, "install artifact set");
  const destination = resolve(sets, lock.setId);
  let manifest;
  if (existsSync(destination)) {
    manifest = await verifyArtifactSet(destination, lock);
    console.log(`verified cached artifact set: ${relative(appRoot, destination)}`);
  } else {
    const temporary = resolve(sets, `.${lock.setId}.partial-${process.pid}`);
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    try {
      await extractTar(bytes, temporary);
      manifest = await verifyArtifactSet(temporary, lock);
      await replaceDirectoryAtomically(temporary, destination);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    console.log(`installed artifact set: ${relative(appRoot, destination)}`);
  }

  if (options.stage) {
    const result = spawnSync(
      process.execPath,
      [resolve(appRoot, "scripts/stage-artifact-set.mjs"), destination],
      { cwd: appRoot, stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`artifact staging failed with status ${result.status}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
