import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";

import { launchBenchmarkBrowser } from "../scripts/browser-utils.mjs";
import { appRoot } from "../scripts/package-root.mjs";
import { runSync } from "../scripts/process-utils.mjs";
import { readVirPackageInfo } from "../scripts/vir-package-reader.mjs";
import {
  exactObject,
  identifier,
  isIdentifier,
  object,
  string,
} from "../scripts/validation-utils.mjs";
import { startBenchmarkServer } from "./harness.mjs";

test("configuration validators share identifier and exact-object semantics", () => {
  assert.equal(isIdentifier("prettyM.default-1"), true);
  assert.equal(isIdentifier("../prettyM"), false);
  assert.equal(identifier("prettyM", "example ID"), "prettyM");
  assert.equal(string("Pretty M", "example title"), "Pretty M");
  assert.deepEqual(object({ value: 1 }, "config"), { value: 1 });
  assert.deepEqual(
    exactObject({ value: 1 }, ["value"], "config"),
    { value: 1 },
  );
  assert.throws(() => identifier("bad/id", "example ID"), /not a safe identifier/);
  assert.throws(() => object([], "config"), /config must be an object/);
  assert.throws(
    () => exactObject({ value: 1, typo: true }, ["value"], "config"),
    /config has unknown property typo/,
  );
});

test("VIR package admission reads metadata without producer tooling", () => {
  const manifest = {
    version: 7,
    metadata: { leanVersion: "4.33.0", leanGithash: "abc" },
    exports: [{ entry: "Demo.run" }],
  };
  const inspected = readVirPackageInfo(virPackageBytes(10, manifest));
  assert.equal(inspected.package.version, 10);
  assert.deepEqual(inspected.manifest, manifest);
  assert.throws(
    () => readVirPackageInfo(virPackageBytes(10, manifest).subarray(0, -1)),
    /exceeds package byte length/,
  );
});

test("synchronous process runner captures output and reports stderr", () => {
  assert.equal(
    runSync(
      process.execPath,
      ["-e", "process.stdout.write('ready\\n')"],
      { capture: true },
    ),
    "ready",
  );
  assert.throws(
    () => runSync(
      process.execPath,
      ["-e", "process.stderr.write('failure detail\\n'); process.exit(7)"],
      { capture: true },
    ),
    /failed with status 7\nfailure detail/,
  );
  assert.throws(
    () => runSync("vir-command-that-does-not-exist", [], { capture: true }),
    (error) =>
      error.message.includes("failed to start") && error.cause?.code === "ENOENT",
  );
  assert.throws(
    () => runSync(
      process.execPath,
      ["-e", "process.kill(process.pid, 'SIGTERM')"],
      { capture: true },
    ),
    /terminated by signal SIGTERM/,
  );
  assert.deepEqual(
    JSON.parse(
      runSync(
        process.execPath,
        [
          "-e",
          "process.stdout.write(JSON.stringify([process.cwd(), process.env.VIR_INFRA_TEST]))",
        ],
        {
          cwd: appRoot,
          env: { ...process.env, VIR_INFRA_TEST: "forwarded" },
          capture: true,
        },
      ),
    ),
    [appRoot, "forwarded"],
  );
});

test("benchmark server helper waits for a configured path and shutdown", async () => {
  const port = 20_000 + (process.pid % 20_000);
  const artifactsRoot = join(appRoot, "_artifacts");
  await mkdir(artifactsRoot, { recursive: true });
  const directory = await mkdtemp(join(artifactsRoot, "server-test-"));
  const readinessPath = "/benchmarks/";
  await mkdir(join(directory, "benchmarks"));
  await writeFile(join(directory, "benchmarks/index.html"), "ready\n");
  let server = null;
  try {
    server = await startBenchmarkServer({
      port,
      directory,
      readinessPath,
    });
    assert.equal((await fetch(server.origin)).status, 404);
    const response = await fetch(new URL(readinessPath, server.origin));
    assert.equal(response.status, 200);
  } finally {
    await server?.close();
    await rm(directory, { recursive: true });
  }
  assert.notEqual(server, null);
  await assert.rejects(fetch(server.origin));
});

test("benchmark server helper reports startup failure", async () => {
  const blocker = createServer((_request, response) => response.end("occupied"));
  blocker.listen(0, "127.0.0.1");
  await once(blocker, "listening");
  const address = blocker.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  try {
    await assert.rejects(
      startBenchmarkServer({
        port: address.port,
        directory: appRoot,
        label: "colliding benchmark server",
      }),
      /colliding benchmark server exited with 1 before readiness/,
    );
  } finally {
    const closed = once(blocker, "close");
    blocker.close();
    await closed;
  }
});

test("explicit Chromium paths are never silently replaced", async () => {
  const previous = process.env.CHROMIUM;
  const configured = join(appRoot, "test-results", "missing-chromium");
  process.env.CHROMIUM = configured;
  try {
    await assert.rejects(
      launchBenchmarkBrowser(),
      (error) => error.message.includes(configured),
    );
  } finally {
    if (previous === undefined) delete process.env.CHROMIUM;
    else process.env.CHROMIUM = previous;
  }
});

function virPackageBytes(version, manifest) {
  const encoder = new TextEncoder();
  const magic = encoder.encode("lean-vir-ir-package");
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const sectionCount = 5;
  const headerBytes = 4 + magic.byteLength + 8 + 4 + sectionCount * 12;
  const manifestSectionBytes = 4 + manifestBytes.byteLength;
  const bytes = new Uint8Array(headerBytes + manifestSectionBytes);
  writeU32(bytes, 0, magic.byteLength);
  bytes.set(magic, 4);
  let offset = 4 + magic.byteLength;
  writeU32(bytes, offset, version);
  writeU32(bytes, offset + 4, 1);
  writeU32(bytes, offset + 8, sectionCount);
  offset += 12;
  for (let kind = 1; kind <= sectionCount; kind += 1) {
    writeU32(bytes, offset, kind);
    writeU32(bytes, offset + 4, headerBytes);
    writeU32(bytes, offset + 8, kind === 5 ? manifestSectionBytes : 0);
    offset += 12;
  }
  writeU32(bytes, headerBytes, manifestBytes.byteLength);
  bytes.set(manifestBytes, headerBytes + 4);
  return bytes;
}

function writeU32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}
