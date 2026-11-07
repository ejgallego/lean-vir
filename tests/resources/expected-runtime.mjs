// Assertion-only release oracle. It never changes acquisition, cache or source selection.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { encodeDescriptor } from "../../web/src/resources/descriptor.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function readRuntimeExpectation(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "5649525245530001");
  const end = 12 + bytes.readUInt32LE(8);
  const raw = bytes.subarray(12, end),
    descriptor = JSON.parse(raw);
  assert.equal(descriptor.kind, "runtime");
  assert.ok(
    raw.equals(Buffer.from(encodeDescriptor(descriptor))),
    "expected descriptor must be canonical",
  );
  const contentId = hash(
    Buffer.concat([Buffer.from("vir-resource-bundle-v2\n"), raw]),
  );
  let offset = end;
  const files = new Map();
  for (const file of descriptor.files) {
    const payload = bytes.subarray(offset, offset + file.byteLength);
    offset += file.byteLength;
    assert.equal(payload.length, file.byteLength);
    assert.equal(hash(payload), file.sha256);
    files.set(file.path, payload);
  }
  assert.equal(offset, bytes.length);
  return { bytes, descriptor, contentId, files };
}
export function assertProducedRuntime(bytes, expected, label) {
  assert.ok(
    bytes.equals(expected.bytes),
    `RUNTIME_RELEASE_MISMATCH: ${label} differs from independently produced ${expected.contentId}`,
  );
}
export function assertEmittedRuntime(site, expected) {
  const directory = join(site, expected.contentId);
  assert.ok(
    existsSync(join(directory, "bundle.json")),
    `RUNTIME_RELEASE_MISMATCH: emitted site lacks produced ${expected.contentId}`,
  );
  const manifest = JSON.parse(readFileSync(join(directory, "bundle.json")));
  assert.equal(manifest.contentId, expected.contentId);
  assert.deepEqual(manifest.descriptor, expected.descriptor);
  for (const [path, bytes] of expected.files)
    assert.deepEqual(
      readFileSync(join(directory, path)),
      bytes,
      `emitted runtime ${path}`,
    );
}
export function assertHistoricalStaleRuntime(stale, expected) {
  assert.equal(
    stale.contentId,
    "426c9d2cc37e7e4cb74295555e785b446ad72dcc15279822e3fbaedb366158bb",
  );
  assert.equal(
    hash(stale.bytes),
    "110ec5424de49e9b66f4fb3bede1cf5ccb631d5fbd84a4723e228907b86e8f1c",
  );
  assert.deepEqual(
    stale.descriptor.compatibility,
    expected.descriptor.compatibility,
    "the historical regression must be same-profile; preserve a real same-profile fixture on upgrades",
  );
  assert.notEqual(stale.contentId, expected.contentId);
  assert.throws(
    () => assertProducedRuntime(stale.bytes, expected, "historical426c"),
    /RUNTIME_RELEASE_MISMATCH/,
  );
}
