import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  descriptorContentId,
  encodeDescriptor,
  sha256Hex,
  requireSha256,
  validateDescriptor,
  validateEnvelope,
} from "../../web/src/resources/descriptor.js";

if (globalThis.crypto === undefined) globalThis.crypto = webcrypto;

test("reports unavailable SHA-256 capability, not a protocol guess", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    for (const value of [undefined, {}, { subtle: {} }]) {
      Object.defineProperty(globalThis, "crypto", { value, configurable: true });
      assert.throws(requireSha256, /WebCrypto SHA-256.*secure context.*HTTPS.*localhost/);
      await assert.rejects(sha256Hex(new Uint8Array()), /WebCrypto SHA-256/);
    }
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
    assert.equal(requireSha256(), webcrypto.subtle);
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
});

const emptySha256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const abcSha256 =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const identity =
  "31aa0de3db1b738af032d0a1c98074426f9b0cad7657d79035c62284d87c2d8e";

function runtime(overrides = {}) {
  return {
    schemaVersion: 1,
    logicalId: "test/λ😀\n\u0001",
    kind: "runtime",
    compatibility: {
      leanRevision: "470d5ce1400764999581fd26d5d72b00d990b0f4",
      virVersion: 1,
    },
    files: [
      {
        path: "runtime.js",
        mediaType: "text/javascript",
        byteLength: 3,
        sha256: abcSha256,
      },
      {
        path: "runtime.wasm",
        mediaType: "application/wasm",
        byteLength: 0,
        sha256: emptySha256,
      },
    ],
    fileEntries: [
      { role: "runtimeModule", path: "runtime.js" },
      { role: "wasm", path: "runtime.wasm" },
    ],
    exports: [],
    ...overrides,
  };
}

// Shared with Unit.lean: lexical portability, not a filesystem qualification.
const portablePaths = JSON.parse(readFileSync(new URL("./portable-paths.json", import.meta.url)));
for (const { paths, code } of portablePaths) {
  test(`portable inventory ${JSON.stringify(paths)}: ${code}`, () => {
    for (const names of [paths, [...paths].reverse()]) {
      const descriptor = runtime({
        files: names.map(path => ({ path, mediaType: "text/plain", byteLength: 0, sha256: emptySha256 })),
        fileEntries: [{ role: "runtimeModule", path: names[0] }, { role: "wasm", path: names[0] }],
      });
      if (code === "OK") {
        const actual = validateDescriptor(descriptor);
        assert.deepEqual(actual.files.map(f => f.path).sort(), [...names].sort());
      } else assert.throws(() => validateDescriptor(descriptor), new RegExp(code));
    }
  });
}

test("canonical v1 identity and Unicode/control spelling match Lean", async () => {
  const encoded = new TextDecoder().decode(encodeDescriptor(runtime()));
  assert.equal(encoded.includes("\\u000a\\u0001"), true);
  assert.equal(encoded.includes("λ😀"), true);
  assert.equal(await descriptorContentId(runtime()), identity);
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), abcSha256);
});

test("normalizes inventories by UTF-8 path and role order", () => {
  const input = runtime({
    files: [
      {
        path: "z.js",
        mediaType: "text/javascript",
        byteLength: 0,
        sha256: emptySha256,
      },
      {
        path: "runtime.wasm",
        mediaType: "application/wasm",
        byteLength: 0,
        sha256: emptySha256,
      },
      {
        path: "runtime.js",
        mediaType: "text/javascript",
        byteLength: 3,
        sha256: abcSha256,
      },
    ],
    fileEntries: [
      { role: "wasm", path: "runtime.wasm" },
      { role: "runtimeModule", path: "runtime.js" },
    ],
  });
  const normalized = validateDescriptor(input);
  assert.deepEqual(
    normalized.files.map(({ path }) => path),
    ["runtime.js", "runtime.wasm", "z.js"],
  );
  assert.deepEqual(
    normalized.fileEntries.map(({ role }) => role),
    ["runtimeModule", "wasm"],
  );
  assert.notEqual(normalized, input);
});

test("uses UTF-8 lexical order for Unicode export roles", () => {
  const program = runtime({
    kind: "program",
    files: [
      {
        path: "program.json",
        mediaType: "application/json",
        byteLength: 0,
        sha256: emptySha256,
      },
    ],
    fileEntries: [{ role: "programSet", path: "program.json" }],
    exports: [
      { role: "\u{10000}", declaration: "Test.astral", interfaceId: "test-v1" },
      { role: "\ue000", declaration: "Test.private", interfaceId: "test-v1" },
    ],
  });
  assert.deepEqual(
    validateDescriptor(program).exports.map(({ role }) => role),
    ["\ue000", "\u{10000}"],
  );
});

test("envelope validates its canonical content identity", async () => {
  const descriptor = runtime();
  const contentId = await descriptorContentId(descriptor);
  assert.deepEqual(await validateEnvelope({ contentId, descriptor }), {
    contentId,
    descriptor: validateDescriptor(descriptor),
  });
  await assert.rejects(
    validateEnvelope({ contentId: "wrong", descriptor }),
    /CONTENT_ID_MISMATCH/,
  );
});

test("reserves the envelope's complete root namespace, not nested filenames", () => {
  for (const path of [
    "bundle.json",
    "BUNDLE.JSON",
    "bundle.json/child",
    "BUNDLE.JSON/child/nested",
  ]) {
    const descriptor = runtime();
    descriptor.files.push({
      path,
      mediaType: "text/plain",
      byteLength: 0,
      sha256: emptySha256,
    });
    assert.throws(() => validateDescriptor(descriptor), /INVALID_PATH/);
  }
  const descriptor = runtime();
  descriptor.files.push({
    path: "assets/bundle.json",
    mediaType: "application/json",
    byteLength: 0,
    sha256: emptySha256,
  });
  assert.doesNotThrow(() => validateDescriptor(descriptor));
});

test("rejects representative v1 schema, metadata, path, and role failures", () => {
  const cases = [
    [runtime({ extra: true }), "INVALID_DESCRIPTOR"],
    [runtime({ schemaVersion: 0 }), "SCHEMA_VERSION"],
    [
      runtime({
        compatibility: {
          leanBuildId: "470d5ce1400764999581fd26d5d72b00d990b0f4",
          runtimeAbi: "test-abi",
          jsApiVersion: 1,
          irFormatVersion: 11,
        },
      }),
      "INVALID_COMPATIBILITY",
    ],
    [
      runtime({ compatibility: { ...runtime().compatibility, runtimeAbi: "test-abi" } }),
      "INVALID_COMPATIBILITY",
    ],
    [
      runtime({ compatibility: { ...runtime().compatibility, virVersion: 0 } }),
      "INVALID_VERSION",
    ],
    [runtime({ logicalId: "\ud800" }), "INVALID_METADATA"],
    [
      runtime({
        files: [
          { ...runtime().files[0], path: "BUNDLE.JSON" },
          runtime().files[1],
        ],
      }),
      "INVALID_PATH",
    ],
    [
      runtime({
        files: [
          ...runtime().files,
          {
            path: "runtime.js/child",
            mediaType: "text/plain",
            byteLength: 0,
            sha256: emptySha256,
          },
        ],
      }),
      "PATH_PREFIX_CONFLICT",
    ],
    [
      runtime({
        fileEntries: [
          { role: "wasm", path: "runtime.wasm" },
          { role: "wasm", path: "runtime.js" },
        ],
      }),
      "DUPLICATE_ROLE",
    ],
    [runtime({ fileEntries: [] }), "MISSING_ROLE"],
    [
      runtime({
        exports: [
          { role: "run", declaration: "Test.run", interfaceId: "test-v1" },
        ],
      }),
      "RUNTIME_EXPORTS",
    ],
    [
      runtime({
        files: [
          { ...runtime().files[0], byteLength: Number.MAX_SAFE_INTEGER },
          runtime().files[1],
        ],
      }),
      "PAYLOAD_LIMIT",
    ],
  ];
  for (const [value, code] of cases) {
    assert.throws(() => validateDescriptor(value), new RegExp(code));
  }
});
