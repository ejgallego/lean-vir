/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */
import assert from "node:assert/strict";
import test from "node:test";
import { VirRuntimeFactory } from "../../web/src/runtime/factory.js";
import { createVirRuntimeFactory as createNodeFactory } from "../../web/src/vir-runtime-node.js";
import { createVirRuntimeFactory as createBrowserFactory } from "../../web/src/vir-runtime.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";
import { VIR_HOST_DISPOSE } from "../../web/src/host-boundary.js";
import {
  createHostLifecycle,
  createTimerHostBindings,
} from "../../web/src/host/vir-active-host-bindings.js";

// Real unloaded runtimes, with no compiler or mocked WebAssembly implementation.
const module = new WebAssembly.Module(Uint8Array.of(
  0, 97, 115, 109, 1, 0, 0, 0,
  5, 3, 1, 0, 1,
  7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0,
));
const noMemory = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));

function activeBindings() {
  const lifecycle = createHostLifecycle();
  let disposals = 0;
  const bindings = {
    ...createTimerHostBindings(lifecycle),
    [VIR_HOST_DISPOSE]() {
      disposals++;
      lifecycle.dispose();
    },
  };
  bindings["browser.timer.setInterval"](() => {}, 60_000);
  return { bindings, lifecycle, get disposals() { return disposals; } };
}

for (const [entry, createFactory] of [["Node", createNodeFactory], ["browser", createBrowserFactory]]) {
  for (const map of [false, true]) {
    test(`${entry} entry honors an application-owned default ${map ? "Map" : "object"}`, async () => {
      const service = activeBindings();
      const bindings = map ? new Map(Object.entries(service.bindings)) : service.bindings;
      bindings[VIR_HOST_DISPOSE] = service.bindings[VIR_HOST_DISPOSE];
      const factory = createFactory({ wasmModule: module, defaultHostBindings: bindings });
      const runtime = await factory.createRuntime();
      try {
        assert.equal(runtime.hostState.defaultBindings, bindings);
        runtime.dispose();
        assert.equal(service.disposals, 0);
        assert.equal(service.lifecycle.phase, "active");
      } finally {
        runtime.dispose();
        bindings[VIR_HOST_DISPOSE]();
      }
    });
  }

  test(`${entry} entry owns fresh default results on disposal and failed creation`, async () => {
    const services = [];
    let fail = false;
    const factory = createFactory({
      wasmModule: module,
      defaultHostBindings: () => {
        const service = activeBindings();
        services.push(service);
        return service.bindings;
      },
      imports: () => {
        if (fail) throw new Error("import sentinel");
        return {};
      },
    });
    const first = await factory.createRuntime();
    const second = await factory.createRuntime();
    try {
      assert.equal(services.length, 2);
      first.dispose();
      assert.equal(services[0].disposals, 1);
      assert.equal(services[1].lifecycle.phase, "active");
      fail = true;
      await assert.rejects(factory.createRuntime(), /import sentinel/);
      assert.equal(services.length, 3);
      assert.equal(services[2].disposals, 1);
      assert.equal(services[2].lifecycle.debugResourceCounts().active, 0);
      assert.equal(services[1].disposals, 0);
    } finally {
      first.dispose();
      second.dispose();
      for (const service of services) service.lifecycle.dispose();
    }
    assert.equal(services[1].disposals, 1);
  });
}

for (const option of ["hostBindings", "defaultHostBindings"]) {
  for (const map of [false, true]) {
    test(`supplied ${option} ${map ? "Map" : "object"} stays application-owned across factories`, async () => {
      const service = activeBindings();
      const bindings = map ? new Map(Object.entries(service.bindings)) : service.bindings;
      bindings[VIR_HOST_DISPOSE] = service.bindings[VIR_HOST_DISPOSE];
      const factory = new VirRuntimeFactory({ wasmModule: module, [option]: bindings });
      const other = new VirRuntimeFactory({ wasmModule: module, [option]: bindings });
      const first = await factory.instantiate();
      const second = await other.instantiate();
      const state = first.hostState;
      try {
        first.dispose();
        second.requireLiveRuntime();
        second.dispose();
        second.dispose();
        // Failure after host-state creation also leaves supplied services alone.
        const broken = new VirRuntimeFactory({
          wasmModule: module, [option]: bindings,
          imports: () => { throw new Error("import sentinel"); },
        });
        await assert.rejects(broken.instantiate(), /import sentinel/);
        assert.equal(service.disposals, 0);
        assert.equal(service.lifecycle.phase, "active");
        assert.equal(service.lifecycle.debugResourceCounts().active, 1);
        service.bindings["browser.timer.setInterval"](() => {}, 60_000);
        assert.equal(service.lifecycle.debugResourceCounts().active, 2);
        assert.equal(state.resourceRootCounts().active, 0);
        assert.equal(state.userBindings, null);
        assert.equal(state.defaultBindings, null);
      } finally {
        first.dispose();
        second.dispose();
        bindings[VIR_HOST_DISPOSE]();
      }
      assert.equal(service.disposals, 1);
      assert.equal(service.lifecycle.debugResourceCounts().active, 0);
    });
  }
}

test("supplied disposers are never inspected, including direct host-state disposal", async () => {
  let reads = 0;
  const supplied = Object.defineProperty({}, VIR_HOST_DISPOSE, {
    get() { reads++; throw new Error("application disposer getter"); },
  });
  const runtime = await new VirRuntimeFactory({
    wasmModule: module, hostBindings: supplied, defaultHostBindings: supplied,
  }).instantiate();
  runtime.dispose();
  const state = new VirHostState({ hostBindings: supplied, defaultHostBindings: supplied });
  state.dispose();
  state.dispose();
  assert.equal(reads, 0);
  assert.equal(state.resourceRootCounts().active, 0);
  assert.equal(state.userBindings, null);
  assert.equal(state.defaultBindings, null);
});

test("fresh default-provider results are independently runtime-owned", async () => {
  const services = [];
  const factory = new VirRuntimeFactory({
    wasmModule: module,
    defaultHostBindings: () => {
      const service = activeBindings();
      services.push(service);
      return service.bindings;
    },
  });
  const first = await factory.instantiate();
  const second = await factory.instantiate();
  try {
    first.dispose();
    first.dispose();
    assert.equal(services[0].disposals, 1);
    assert.equal(services[0].lifecycle.debugResourceCounts().active, 0);
    assert.equal(services[1].disposals, 0);
    assert.equal(services[1].lifecycle.phase, "active");
    second.requireLiveRuntime();
  } finally {
    first.dispose();
    second.dispose();
  }
  assert.equal(services[1].disposals, 1);
  assert.equal(services[1].lifecycle.debugResourceCounts().active, 0);
});

for (const failure of ["imports", "memory"]) {
  test(`failed ${failure} construction disposes its fresh default provider`, async () => {
    const service = activeBindings();
    let state;
    const factory = new VirRuntimeFactory({
      wasmModule: failure === "memory" ? noMemory : module,
      defaultHostBindings: () => service.bindings,
      imports: (_module, hostState) => {
        state = hostState;
        if (failure === "imports") throw new Error("import sentinel");
        return {};
      },
    });
    try {
      await assert.rejects(factory.instantiate(), /import sentinel|memory export is missing/);
      assert.equal(service.disposals, 1);
      assert.equal(service.lifecycle.debugResourceCounts().active, 0);
      assert.equal(state.disposed, true);
      assert.equal(state.defaultBindings, null);
      state.dispose();
      assert.equal(service.disposals, 1);
    } finally {
      service.lifecycle.dispose();
    }
  });
}

test("owned-provider cleanup failure still drops map references in a hostless runtime", async () => {
  const failure = new Error("provider cleanup sentinel");
  let disposals = 0;
  const runtime = await new VirRuntimeFactory({
    wasmModule: module,
    defaultHostBindings: () => ({
      [VIR_HOST_DISPOSE]() { disposals++; throw failure; },
    }),
  }).instantiate();
  const state = runtime.hostState;
  assert.throws(() => runtime.dispose(), error => error === failure);
  assert.equal(disposals, 1);
  assert.equal(state.resourceRootCounts().active, 0);
  assert.equal(state.userBindings, null);
  assert.equal(state.defaultBindings, null);
  runtime.dispose();
  assert.equal(disposals, 1);
});

test("a failed fresh-provider builder leaves supplied services application-owned", async () => {
  const failure = new Error("provider builder sentinel");
  let suppliedDisposals = 0;
  const factory = new VirRuntimeFactory({
    wasmModule: module,
    hostBindings: { [VIR_HOST_DISPOSE]() { suppliedDisposals++; } },
    defaultHostBindings: () => { throw failure; },
  });
  await assert.rejects(factory.instantiate(), error => error === failure);
  assert.equal(suppliedDisposals, 0);
});

test("failed creation retains both the original and owned-provider cleanup errors", async () => {
  const failure = new Error("import sentinel");
  const cleanup = new Error("cleanup sentinel");
  let state, disposals = 0;
  const factory = new VirRuntimeFactory({
    wasmModule: module,
    defaultHostBindings: () => ({
      [VIR_HOST_DISPOSE]() { disposals++; throw cleanup; },
    }),
    imports: (_module, hostState) => {
      state = hostState;
      throw failure;
    },
  });
  await assert.rejects(factory.instantiate(), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [failure, cleanup]);
    return true;
  });
  assert.equal(state.resourceRootCounts().active, 0);
  assert.equal(state.defaultBindings, null);
  state.dispose();
  assert.equal(disposals, 1);
});
