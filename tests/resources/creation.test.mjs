import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import {
  descriptorContentId,
  sha256Hex,
} from "../../web/src/resources/descriptor.js";

// Exercise the real loader, envelope integrity and export resolver. Substitute
// only the expensive package/runtime boundaries; browser.mjs admits real IR/Wasm.
const compiled = await build({
  entryPoints: [
    new URL("../../web/src/resource-program.js", import.meta.url).pathname,
  ],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  define: {
    "import.meta.url": JSON.stringify("http://vir.test/runtime/runtime.js"),
  },
  plugins: [
    {
      name: "creation-boundaries",
      setup(builder) {
        builder.onLoad({ filter: /\/vir-runtime\.js$/ }, () => ({
          contents:
            "export const createVirRuntimeFactory = options => globalThis.resourceCreationTest.factory(options);",
        }));
        builder.onLoad({ filter: /\/runtime\/ir-package\.js$/ }, () => ({
          contents:
            "export const IR_PACKAGE_VERSION = 11; export const validateIrPackageSetMembers = () => ({manifests: [globalThis.resourceCreationTest.manifest]});",
        }));
      },
    },
  ],
});
const { createProgram } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString("base64")}`
);
const nat = { type: "Nat", interfaceTag: 0 };
const entry = {
  entry: "Root.run",
  id: "run",
  jsName: "run",
  args: [],
  result: nat,
  effect: "pure",
};
const expected = () => ({
  run: {
    declaration: "Root.run",
    interfaceId: "test-run-v1",
    signature: { args: [], result: { ...nat }, effect: "pure" },
  },
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

async function fixture(body) {
  const oldFetch = globalThis.fetch,
    oldState = globalThis.resourceCreationTest;
  const oldSetTimeout = globalThis.setTimeout,
    oldClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  globalThis.setTimeout = (callback, delay) => {
    const token = {};
    timers.set(token, { callback, delay });
    return token;
  };
  globalThis.clearTimeout = (token) => timers.delete(token);
  const inventory = new Map(),
    requests = [];
  const compatibility = { leanRevision: "test-revision", virVersion: 1 };
  for (const kind of ["runtime", "program"]) {
    const files =
      kind === "runtime"
        ? [
            ["runtime.js", "export {}", "text/javascript"],
            ["runtime.wasm", "wasm", "application/wasm"],
          ]
        : [["set.json", "{}", "application/json"]];
    const descriptor = {
      schemaVersion: 1,
      logicalId: `test/${kind}`,
      kind,
      compatibility,
      files: await Promise.all(
        files.map(async ([path, text, mediaType]) => {
          const bytes = new TextEncoder().encode(text);
          inventory.set(`/${kind}/${path}`, { bytes, mediaType });
          return {
            path,
            mediaType,
            byteLength: bytes.length,
            sha256: await sha256Hex(bytes),
          };
        }),
      ),
      fileEntries:
        kind === "runtime"
          ? [
              { role: "runtimeModule", path: "runtime.js" },
              { role: "wasm", path: "runtime.wasm" },
            ]
          : [{ role: "programSet", path: "set.json" }],
      exports:
        kind === "runtime"
          ? []
          : [
              {
                role: "run",
                declaration: "Root.run",
                interfaceId: "test-run-v1",
              },
              {
                role: "extra",
                declaration: "Root.extra",
                interfaceId: "extra-v1",
              },
            ],
    };
    inventory.set(`/${kind}/bundle.json`, {
      mediaType: "application/json",
      bytes: new TextEncoder().encode(
        JSON.stringify({
          descriptor,
          contentId: await descriptorContentId(descriptor),
        }),
      ),
    });
  }
  const started = deferred(),
    creation = deferred();
  const state = {
    requests,
    started,
    creation,
    timers,
    instances: 0,
    disposed: 0,
    calls: 0,
    manifest: {
      metadata: { leanGithash: compatibility.leanRevision },
      exports: [
        structuredClone(entry),
        { ...entry, entry: "Root.extra", id: "extra", jsName: "extra" },
      ],
    },
    factory() {
      return {
        async fetchIrPackageSet() {
          return { members: [{ bytes: new Uint8Array() }] };
        },
        async createRuntime() {
          state.instances++;
          started.resolve();
          return creation.promise;
        },
      };
    },
    runtime: {
      failure: null,
      interfaceManifest: {
        exports: [
          structuredClone(entry),
          { ...entry, entry: "Root.extra", id: "extra", jsName: "extra" },
        ],
      },
      callEntry() {
        state.calls++;
        return 42;
      },
      dispose() {
        state.disposed++;
      },
    },
    options: {
      runtimeManifestUrl: new URL("http://vir.test/runtime/bundle.json"),
      programManifestUrl: new URL("http://vir.test/program/bundle.json"),
    },
  };
  globalThis.resourceCreationTest = state;
  state.respond = (url) => {
    const item = inventory.get(new URL(url).pathname);
    return new Response(item.bytes, {
      headers: { "content-type": item.mediaType },
    });
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ path: new URL(url).pathname, signal: options.signal });
    if (state.fetchOverride) return state.fetchOverride(url, options);
    return state.respond(url);
  };
  try {
    await body(state);
    assert.equal(timers.size, 0, "all creation timers detached");
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.resourceCreationTest = oldState;
    globalThis.setTimeout = oldSetTimeout;
    globalThis.clearTimeout = oldClearTimeout;
  }
}

function trackedController() {
  const controller = new AbortController(),
    listeners = new Set();
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (name, listener, options) => {
    if (name === "abort") listeners.add(listener);
    return add(name, listener, options);
  };
  controller.signal.removeEventListener = (name, listener) => {
    if (name === "abort") listeners.delete(listener);
    return remove(name, listener);
  };
  return { controller, listeners };
}

test("wrong ABI is rejected at admission, not ignored or instantiated (semantic red)", async () =>
  fixture(async (s) => {
    const exports = expected();
    exports.run.signature.result = { type: "String", interfaceTag: 3 };
    // Non-enumerable own options reach the old two-key loader, exposing ignored
    // expectations rather than merely its unsupported-option guard.
    Object.defineProperty(s.options, "expectedExports", { value: exports });
    s.creation.resolve(s.runtime);
    await assert.rejects(
      createProgram(s.options),
      (e) => e.phase === "program-validation",
    );
    assert.equal(s.instances, 0);
  }));

test("abort during deferred creation disposes the late instance instead of handing it off (semantic red)", async () =>
  fixture(async (s) => {
    const controller = new AbortController(),
      reason = { cancelled: true };
    Object.defineProperty(s.options, "signal", { value: controller.signal });
    const pending = createProgram(s.options);
    const rejected = assert.rejects(
      pending,
      (e) => e.name === "AbortError" && e.cause === reason,
    );
    await s.started.promise;
    controller.abort(reason);
    s.creation.resolve(s.runtime);
    await rejected;
    assert.equal(s.disposed, 1);
    assert.equal(s.calls, 0);
  }));

for (const [name, change] of [
  [
    "missing role",
    (e) => {
      e.missing = e.run;
      delete e.run;
    },
  ],
  [
    "wrong ID",
    (e) => {
      e.run.interfaceId = "test-run-v2";
    },
  ],
  [
    "wrong declaration",
    (e) => {
      e.run.declaration = "Dependency.run";
    },
  ],
  [
    "convenience alias",
    (e) => {
      e.run.declaration = "run";
    },
  ],
  [
    "argument count",
    (e) => {
      e.run.signature.args.push(nat);
    },
  ],
  [
    "result type",
    (e) => {
      e.run.signature.result = { type: "String", interfaceTag: 3 };
    },
  ],
  [
    "effect",
    (e) => {
      e.run.signature.effect = "io";
    },
  ],
])
  test(`strict admission rejects ${name} before runtime creation`, async () =>
    fixture(async (s) => {
      const exports = expected();
      change(exports);
      await assert.rejects(
        createProgram({ ...s.options, expectedExports: exports }),
        (e) => e.phase === "program-validation",
      );
      assert.equal(s.instances, 0);
      assert.equal(s.calls, 0);
      if (
        [
          "missing role",
          "wrong ID",
          "wrong declaration",
          "convenience alias",
        ].includes(name)
      )
        assert.ok(
          s.requests.every((r) => r.path.endsWith("bundle.json")),
          "metadata mismatch needs no payloads",
        );
    }));

test("correct subset, extra roles and reordered keys admit; mutation after await cannot weaken the snapshot", async () =>
  fixture(async (s) => {
    const exports = expected(),
      saved = structuredClone(exports);
    s.manifest.exports[0].args = [{ name: "display parameter", type: nat }];
    s.runtime.interfaceManifest.exports[0].args = [
      { name: "other display name", type: nat },
    ];
    exports.run.signature.args = [
      { interfaceTag: 0, type: "Nat", diagnostics: { ignored: true } },
    ];
    const pending = createProgram({ ...s.options, expectedExports: exports });
    exports.run.declaration = "not the snapshotted declaration";
    exports.run.signature.args[0].interfaceTag = 3;
    await s.started.promise;
    s.creation.resolve(s.runtime);
    const program = await pending;
    assert.equal(program.call("run"), 42);
    assert.equal(program.status, "active");
    program.dispose();
    program.dispose();
    assert.equal(s.disposed, 1);
    assert.equal(saved.run.declaration, "Root.run");
  }));

for (const value of [
  null,
  [],
  { run: {} },
  {
    run: {
      declaration: "Root.run",
      interfaceId: "test-run-v1",
      signature: { args: [], result: nat },
    },
  },
])
  test(`malformed expectation rejects before I/O: ${JSON.stringify(value)}`, async () =>
    fixture(async (s) => {
      await assert.rejects(
        createProgram({ ...s.options, expectedExports: value }),
        (e) => e.phase === "program-validation",
      );
      assert.equal(s.requests.length, 0);
      assert.equal(s.instances, 0);
    }));

test("already aborted request performs no I/O/allocation or listener registration", async () =>
  fixture(async (s) => {
    const { controller, listeners } = trackedController();
    const reason = { reason: "stop" };
    controller.abort(reason);
    await assert.rejects(
      createProgram({ ...s.options, signal: controller.signal }),
      (e) => e.name === "AbortError" && e.cause === reason,
    );
    assert.equal(s.requests.length, 0);
    assert.equal(s.instances, 0);
    assert.equal(listeners.size, 0);
  }));

for (const path of [
  "/runtime/bundle.json",
  "/program/bundle.json",
  "/runtime/runtime.wasm",
  "/program/set.json",
])
  test(`abort while fetching ${path} cancels acquired request and detaches`, async () =>
    fixture(async (s) => {
      const waiting = deferred(),
        { controller, listeners } = trackedController();
      let requestSignal;
      s.fetchOverride = (url, options) => {
        if (new URL(url).pathname !== path) return s.respond(url);
        requestSignal = options.signal;
        waiting.resolve();
        return new Promise((_, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(options.signal.reason),
            { once: true },
          ),
        );
      };
      const pending = createProgram({
        ...s.options,
        signal: controller.signal,
      });
      const rejected = assert.rejects(pending, (e) => e.name === "AbortError");
      await waiting.promise;
      controller.abort();
      await rejected;
      assert.equal(requestSignal.aborted, true);
      assert.equal(listeners.size, 0);
      assert.equal(s.instances, 0);
    }));

for (const cleanup of [
  new Error("cleanup"),
  undefined,
  null,
  { raw: "cleanup" },
])
  test(`cancellation keeps own readonly cleanup diagnostic (${String(cleanup)})`, async () =>
    fixture(async (s) => {
      const { controller, listeners } = trackedController(),
        reason = { raw: "abort" };
      s.runtime.dispose = () => {
        s.disposed++;
        throw cleanup;
      };
      const pending = createProgram({
        ...s.options,
        signal: controller.signal,
      });
      const rejected = assert.rejects(pending, (e) => {
        assert.equal(e.name, "AbortError");
        assert.equal(e.cause, reason);
        assert.equal(Object.hasOwn(e, "cleanupError"), true);
        assert.equal(e.cleanupError, cleanup);
        assert.equal(
          Object.getOwnPropertyDescriptor(e, "cleanupError").writable,
          false,
        );
        return true;
      });
      await s.started.promise;
      controller.abort(reason);
      s.creation.resolve(s.runtime);
      await rejected;
      assert.equal(s.disposed, 1);
      assert.equal(listeners.size, 0);
    }));

test("post-handoff abort owns nothing; explicit throwing disposal is terminal and attempted once", async () =>
  fixture(async (s) => {
    const { controller, listeners } = trackedController(),
      raw = { cleanup: true };
    s.creation.resolve(s.runtime);
    const program = await createProgram({
      ...s.options,
      signal: controller.signal,
      expectedExports: expected(),
    });
    assert.equal(listeners.size, 0);
    assert.equal(s.timers.size, 0);
    controller.abort();
    assert.equal(program.call("run"), 42);
    assert.equal(s.disposed, 0);
    s.runtime.dispose = () => {
      s.disposed++;
      throw raw;
    };
    assert.throws(
      () => program.dispose(),
      (e) => e === raw,
    );
    assert.equal(program.status, "disposed");
    program.dispose();
    assert.equal(s.disposed, 1);
  }));

test("timeout stays primary when creation settles and a later caller abort arrives during throwing cleanup", async () =>
  fixture(async (s) => {
    const controller = new AbortController(),
      cleanup = { raw: true };
    s.runtime.dispose = () => {
      s.disposed++;
      controller.abort("late");
      throw cleanup;
    };
    const pending = createProgram({ ...s.options, signal: controller.signal });
    const rejected = assert.rejects(
      pending,
      (e) =>
        e.name === "TimeoutError" &&
        e.phase === "runtime-creation" &&
        e.cleanupError === cleanup,
    );
    await s.started.promise;
    assert.equal([...s.timers.values()][0].delay, 120000);
    [...s.timers.values()][0].callback();
    s.creation.resolve(s.runtime);
    await rejected;
    assert.equal(s.disposed, 1);
  }));

test("non-cancellation error preserves raw primary cause and secondary cleanup, without inspecting either", async () =>
  fixture(async (s) => {
    const controller = new AbortController(),
      raw = new Proxy(
        {},
        {
          get() {
            throw new Error("must not inspect raw cause");
          },
        },
      );
    s.runtime.interfaceManifest = {
      get exports() {
        throw raw;
      },
    };
    s.runtime.dispose = () => {
      s.disposed++;
      controller.abort("late");
      throw undefined;
    };
    s.creation.resolve(s.runtime);
    await assert.rejects(
      createProgram({ ...s.options, signal: controller.signal }),
      (e) =>
        e.name === "Error" &&
        e.phase === "runtime-creation" &&
        e.cause === raw &&
        Object.hasOwn(e, "cleanupError") &&
        e.cleanupError === undefined,
    );
    assert.equal(s.disposed, 1);
  }));

for (const order of [
  [0, 1],
  [1, 0],
])
  test(`independent attempts with aborted A and healthy B (${order})`, async () =>
    fixture(async (s) => {
      const attempts = [deferred(), deferred()],
        starts = [deferred(), deferred()];
      const disposed = [0, 0];
      let next = 0;
      s.factory = () => ({
        async fetchIrPackageSet() {
          return { members: [{ bytes: new Uint8Array() }] };
        },
        async createRuntime() {
          const i = next++;
          starts[i].resolve();
          return attempts[i].promise;
        },
      });
      const controllers = [new AbortController(), new AbortController()];
      const pendingA = createProgram({
        ...s.options,
        signal: controllers[0].signal,
      });
      const rejectedA = assert.rejects(
        pendingA,
        (e) => e.name === "AbortError",
      );
      await starts[0].promise;
      const pendingB = createProgram({
        ...s.options,
        signal: controllers[1].signal,
      });
      await starts[1].promise;
      controllers[0].abort();
      for (const i of order)
        attempts[i].resolve({
          ...s.runtime,
          dispose() {
            disposed[i]++;
          },
        });
      await rejectedA;
      const program = await pendingB;
      assert.deepEqual(disposed, [1, 0]);
      assert.equal(program.call("run"), 42);
      program.dispose();
      assert.deepEqual(disposed, [1, 1]);
    }));

test("late runtime rejection after cancellation retains abort reason and cannot invent an owned instance", async () =>
  fixture(async (s) => {
    const controller = new AbortController(),
      reason = { cancel: true };
    const pending = createProgram({ ...s.options, signal: controller.signal });
    const rejected = assert.rejects(
      pending,
      (e) =>
        e.name === "AbortError" &&
        e.cause === reason &&
        !Object.hasOwn(e, "cleanupError"),
    );
    await s.started.promise;
    controller.abort(reason);
    s.creation.reject({ raw: "creation failure" });
    await rejected;
    assert.equal(s.disposed, 0);
  }));

test("same arity with wrong argument type rejects at admission", async () =>
  fixture(async (s) => {
    s.manifest.exports[0].args = [{ name: "n", type: nat }];
    const exports = expected();
    exports.run.signature.args = [{ type: "String", interfaceTag: 3 }];
    await assert.rejects(
      createProgram({ ...s.options, expectedExports: exports }),
      (e) => e.phase === "program-validation",
    );
    assert.equal(s.instances, 0);
  }));

test("abort at the final installed-interface boundary cannot race a successful handoff", async () =>
  fixture(async (s) => {
    const controller = new AbortController();
    const entries = s.runtime.interfaceManifest.exports;
    s.runtime.interfaceManifest = {
      get exports() {
        controller.abort("at handoff");
        return entries;
      },
    };
    s.creation.resolve(s.runtime);
    await assert.rejects(
      createProgram({ ...s.options, signal: controller.signal }),
      (e) => e.name === "AbortError" && e.cause === "at handoff",
    );
    assert.equal(s.disposed, 1);
  }));
