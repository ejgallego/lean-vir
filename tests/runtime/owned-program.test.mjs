/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */
import assert from "node:assert/strict";
import test from "node:test";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime.js";
import {
  descriptorContentId,
  sha256Hex,
} from "../../web/src/resources/descriptor.js";
import { VIR_COMPATIBILITY_VERSION } from "../../web/src/runtime/versions.js";
import {
  IR_PACKAGE_MAGIC,
  IR_PACKAGE_VERSION,
  irPackageManifestChecksum,
  validateIrPackageSetMembers,
} from "../../web/src/runtime/ir-package.js";
import {
  INTERFACE_MANIFEST_ARTIFACT,
  INTERFACE_MANIFEST_VERSION,
} from "../../web/src/runtime/interface-manifest.js";
import { encodeInterfaceManifest } from "../../scripts/packages/irpkg-format.mjs";
import { primitiveBoundary } from "../support/interface-fixtures.mjs";

// Valid real Wasm compilation and actual envelope/package admission. Runtime
// initialization/installation/calls are modeled here; the smoke uses Lean/Wasm.
const wasm = Uint8Array.of(
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  5,
  3,
  1,
  0,
  1,
  7,
  10,
  1,
  6,
  109,
  101,
  109,
  111,
  114,
  121,
  2,
  0,
);
const nat = primitiveBoundary("nat", "bigint");
const entry = {
  entry: "Root.run",
  nameKey: "s526f6f74/s72756e/",
  args: [],
  result: nat,
  effect: "pure",
  startup: false,
};
const expected = () => ({
  "Root.run": { args: [], result: nat, effect: "pure" },
});
const encoder = new TextEncoder();
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

function packageBytes(
  module = "Root",
  role = "root",
  revision = "test-revision",
) {
  const manifest = encodeInterfaceManifest({
    artifact: INTERFACE_MANIFEST_ARTIFACT,
    version: INTERFACE_MANIFEST_VERSION,
    metadata: {
      packageFormatVersion: IR_PACKAGE_VERSION,
      manifestVersion: INTERFACE_MANIFEST_VERSION,
      leanVersion: "test",
      leanToolchain: "test",
      leanGithash: revision,
      packageSetMember: { module, role },
      targets:
        role === "root"
          ? [
              {
                mode: "markedModule",
                module,
                roots: [],
                resolvedRoots: ["Root.run"],
              },
            ]
          : [],
    },
    exports: role === "root" ? [entry] : [],
  });
  const json = encoder.encode(JSON.stringify(manifest)),
    magic = encoder.encode(IR_PACKAGE_MAGIC);
  const headerSize = 4 + magic.length + 12 + 5 * 12;
  const output = new Uint8Array(headerSize + 16 + 12 + json.length),
    view = new DataView(output.buffer);
  let cursor = 0;
  const u32 = (n) => {
    view.setUint32(cursor, n, true);
    cursor += 4;
  };
  u32(magic.length);
  output.set(magic, cursor);
  cursor += magic.length;
  u32(IR_PACKAGE_VERSION);
  u32(0);
  u32(5);
  for (let i = 0; i < 5; i++) {
    u32(i + 1);
    u32(headerSize + i * 4);
    u32(i === 4 ? 12 + json.length : 4);
  }
  cursor = headerSize + 16;
  view.setBigUint64(cursor, irPackageManifestChecksum(json), true);
  cursor += 8;
  u32(json.length);
  output.set(json, cursor);
  return output;
}
async function envelope({
  revision = "test-revision",
  version = VIR_COMPATIBILITY_VERSION,
  bytes = wasm,
} = {}) {
  const descriptor = {
    schemaVersion: 2,
    logicalId: "test/runtime",
    kind: "runtime",
    compatibility: { leanRevision: revision, virVersion: version },
    files: [
      {
        path: "runtime.wasm",
        mediaType: "application/wasm",
        byteLength: bytes.length,
        sha256: await sha256Hex(bytes),
      },
      {
        path: "runtime.js",
        mediaType: "text/javascript",
        byteLength: 0,
        sha256: await sha256Hex(new Uint8Array()),
      },
    ],
    fileEntries: [
      { role: "wasm", path: "runtime.wasm" },
      { role: "runtimeModule", path: "runtime.js" },
    ],
  };
  return { descriptor, contentId: await descriptorContentId(descriptor) };
}
async function fixture(options = {}) {
  const runtimeManifest = await envelope(options);
  const wasmBytes = Uint8Array.from(wasm);
  const factory = createVirRuntimeFactory({
    wasmBytes,
    runtimeManifest,
    expectedRuntimeContentId: runtimeManifest.contentId,
    fetchBytes: () => {
      throw new Error("byte admission must not fetch");
    },
  });
  const state = {
    started: deferred(),
    initialized: 0,
    disposed: 0,
    modules: [],
    runtimes: [],
    installs: 0,
  };
  factory.instantiateModule = (module) => {
    state.initialized++;
    state.started.resolve();
    state.modules.push(module);
    const runtime = {
      failure: null,
      interfaceManifest: null,
      installIrPackageSetBytes(bytes) {
        state.installs++;
        if (state.installError) throw state.installError;
        this.interfaceManifest = {
          exports: validateIrPackageSetMembers(bytes).manifests.at(-1).exports,
        };
      },
      callEntry() {
        if (this.failure) throw this.failure;
        return 42n;
      },
      callWith(opts, name) {
        assert.equal(name, "Root.run");
        return opts.resultRepresentation === "json-safe-v1" ? "42" : 42n;
      },
      dispose() {
        state.disposed++;
        state.onDispose?.();
        if (state.cleanupError) throw state.cleanupError;
      },
    };
    state.runtimes.push(runtime);
    return state.late ? state.late.promise.then(() => runtime) : runtime;
  };
  return {
    factory,
    state,
    runtimeManifest,
    wasmBytes,
    open: (opts = {}) =>
      factory.createProgram({
        irPackageSet: [packageBytes()],
        expectedExports: expected(),
        ...opts,
      }),
  };
}

test("owned programs verify bytes, share only their module and restrict the facade to root entries", async () => {
  const h = await fixture();
  const dependency = packageBytes("Dependency", "dependency");
  const a = await h.open({ irPackageSet: [dependency, packageBytes()] }),
    b = await h.open();
  assert.equal(a.call("Root.run"), 42n);
  assert.equal(
    a.callWith({ resultRepresentation: "json-safe-v1" }, "Root.run"),
    "42",
  );
  assert.throws(() => a.call("Dependency.hidden"), /unknown program export/);
  assert.equal(h.state.modules[0], h.state.modules[1]);
  assert.equal(await h.factory.module(), h.state.modules[0]);
  h.state.runtimes[0].failure = new Error("fatal");
  assert.equal(a.status, "failed");
  assert.equal(b.status, "active");
  a.dispose();
  a.dispose();
  assert.equal(a.status, "disposed");
  assert.throws(() => a.call("Root.run"), /disposed/);
  assert.equal(b.call("Root.run"), 42n);
  b.dispose();
  assert.equal(h.state.disposed, 2);
});

test("runtime association and operation inputs are snapshotted before awaiting", async () => {
  const h = await fixture();
  h.wasmBytes.fill(0);
  h.runtimeManifest.descriptor.compatibility.leanRevision = "mutated";
  h.factory.wasmBytes = Uint8Array.of(0);
  h.factory.wasmModule = new WebAssembly.Module(wasm);
  const bytes = packageBytes(),
    contracts = structuredClone(expected());
  const pending = h.open({ irPackageSet: [bytes], expectedExports: contracts });
  bytes.fill(0);
  contracts["Root.run"].result = primitiveBoundary("string", "string");
  const program = await pending;
  assert.notEqual(h.state.modules[0], h.factory.wasmModule);
  assert.equal(program.call("Root.run"), 42n);
  program.dispose();
});

for (const [name, modify, pattern] of [
  [
    "signature",
    async (h) => ({
      expectedExports: {
        "Root.run": {
          args: [],
          result: primitiveBoundary("string", "string"),
          effect: "pure",
        },
      },
    }),
    /signature/,
  ],
  [
    "compiler",
    async (h) => ({ irPackageSet: [packageBytes("Root", "root", "other")] }),
    /compiled identity/,
  ],
  [
    "member order",
    async (h) => ({
      irPackageSet: [packageBytes(), packageBytes("Dependency", "dependency")],
    }),
    /role/,
  ],
  [
    "malformed package",
    async (h) => ({ irPackageSet: [Uint8Array.of(0)] }),
    /invalid/,
  ],
])
  test(`owned program rejects ${name} before initialization`, async () => {
    const h = await fixture();
    await assert.rejects(
      h.open(await modify(h)),
      (error) =>
        error.phase === "program-validation" &&
        pattern.test(error.cause.message),
    );
    assert.equal(h.state.initialized, 0);
  });

for (const [name, options] of [
  ["profile", { version: VIR_COMPATIBILITY_VERSION + 1 }],
  ["Wasm digest", { bytes: Uint8Array.of(0) }],
])
  test(`owned program rejects wrong ${name} before initialization`, async () => {
    const h = await fixture(options);
    await assert.rejects(h.open(), (error) => error.phase === "compatibility");
    assert.equal(h.state.initialized, 0);
  });

test("bare modules and caller-asserted identities do not establish a verified runtime association", async () => {
  const runtimeManifest = await envelope();
  assert.throws(
    () =>
      createVirRuntimeFactory({
        wasmModule: new WebAssembly.Module(wasm),
        runtimeManifest,
        expectedRuntimeContentId: runtimeManifest.contentId,
      }),
    /owned programs require/,
  );
  const factory = createVirRuntimeFactory({ wasmBytes: wasm });
  await assert.rejects(
    factory.createProgram({ irPackageSet: [packageBytes()] }),
    /compatibility/,
  );
  const wrong = createVirRuntimeFactory({
    wasmBytes: wasm,
    runtimeManifest,
    expectedRuntimeContentId: "0".repeat(64),
  });
  await assert.rejects(
    wrong.createProgram({ irPackageSet: [packageBytes()] }),
    (error) => /content identity/.test(error.cause.message),
  );
});

test("pre-abort and late creation preserve primary abort and cleanup errors", async () => {
  const h = await fixture(),
    controller = new AbortController();
  controller.abort("before");
  await assert.rejects(
    h.open({ signal: controller.signal }),
    (error) => error.name === "AbortError" && error.cause === "before",
  );
  assert.equal(h.state.initialized, 0);
  const late = deferred();
  h.state.late = late;
  const abort = new AbortController(),
    cleanup = new Error("cleanup");
  h.state.cleanupError = cleanup;
  const opening = h.open({ signal: abort.signal });
  // Wait for the modeled instantiator, not a timing-dependent sleep.
  await Promise.race([h.state.started.promise, opening]);
  abort.abort("late");
  late.resolve();
  await assert.rejects(
    opening,
    (error) =>
      error.name === "AbortError" &&
      error.cause === "late" &&
      error.cleanupError === cleanup &&
      Object.getOwnPropertyDescriptor(error, "cleanupError").writable === false,
  );
  assert.equal(h.state.disposed, 1);
  assert.equal(h.state.installs, 0);
});

test("installation failure owns the instance and retains cleanup failure", async () => {
  const h = await fixture(),
    primary = new Error("install"),
    cleanup = new Error("cleanup");
  h.state.installError = primary;
  h.state.cleanupError = cleanup;
  await assert.rejects(
    h.open(),
    (error) => error.cause === primary && error.cleanupError === cleanup,
  );
  assert.equal(h.state.disposed, 1);
});

test("in-memory owned creation installs no acquisition timer", async () => {
  const h = await fixture();
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  let timers = 0,
    clears = 0;
  try {
    globalThis.setTimeout = (...args) => {
      timers++;
      return originalSet(...args);
    };
    globalThis.clearTimeout = (...args) => {
      clears++;
      return originalClear(...args);
    };
    const program = await h.open();
    program.dispose();
    assert.equal(timers, 0);
    assert.equal(clears, 0);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});

test("facade detaches ownership before reentrant or throwing cleanup", async () => {
  const h = await fixture(),
    cleanup = new Error("cleanup");
  const program = await h.open();
  h.state.onDispose = () => {
    assert.equal(program.status, "disposed");
    assert.throws(() => program.call("Root.run"), /disposed/);
    assert.throws(() => program.callWith({}, "Root.run"), /disposed/);
    program.dispose();
  };
  h.state.cleanupError = cleanup;
  assert.throws(
    () => program.dispose(),
    (error) => error === cleanup,
  );
  program.dispose();
  assert.equal(h.state.disposed, 1);
});
