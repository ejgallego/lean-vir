// Diagnostic acceptance, not a timing benchmark. Observe real Wasm memories
// through weak references without adding public runtime instrumentation.
import assert from "node:assert/strict";
import { evaluate } from "../browser/harness.mjs";

export async function measureResourceRetention(cdp, record) {
  await cdp.send("HeapProfiler.enable");
  await evaluate(cdp, `(() => {
    const original = WebAssembly.Instance;
    globalThis.resourceRetention = { original, memories: [], held: [] };
    WebAssembly.Instance = new Proxy(original, {construct(target, args) {
      const instance = Reflect.construct(target, args);
      resourceRetention.memories.push(new WeakRef(instance.exports.memory));
      return instance;
    }});
  })()`);
  const observations = [];
  async function sample(phase) {
    // Separate protocol turns: WeakRef.deref keeps a target alive for the
    // current job. No inspected remote object handles are retained by CDP.
    await cdp.send("HeapProfiler.collectGarbage");
    const memory = await evaluate(cdp, `(() => {
      const capacities = resourceRetention.memories.map(ref =>
        ref.deref()?.buffer.byteLength ?? 0);
      return {created: capacities.length, live: capacities.filter(Boolean).length,
        capacities};
    })()`);
    const heap = await cdp.send("Runtime.getHeapUsage");
    const observation = { phase, ...memory, heap };
    observations.push(observation);
    await record(observations);
    return observation;
  }
  try {
    const baseline = await sample("baseline");
    assert.equal(baseline.created, 0);
    await evaluate(cdp, `(async () => {
      resourceRetention.held.push(await openResourceProgram());
    })()`);
    const live = await sample("live-control");
    assert.equal(live.created, 1, "probe must observe the actual Wasm instance");
    assert.equal(live.live, 1, "a live program must retain its memory");
    for (let batch = 0; batch < 3; batch++) {
      const value = await evaluate(cdp, `(() => {
        let result;
        for (let i = 0; i < 100; i++) result = resourceRetention.held[0].call('score');
        return result;
      })()`);
      assert.equal(value, "6093");
      await sample(`100-score-calls-${batch + 1}`);
    }
    await evaluate(cdp, `resourceRetention.held[0].dispose()`);
    assert.equal((await sample("disposed-facade-held")).live, 0,
      "a disposed facade must release its runtime even while the facade is held");
    const disposed = await evaluate(cdp, `(() => {
      resourceRetention.held[0].dispose();
      try { resourceRetention.held[0].call('score'); return false; }
      catch (error) { return /disposed/.test(error.message); }
    })()`);
    assert.equal(disposed, true, "released facade keeps disposal semantics");
    await evaluate(cdp, `resourceRetention.held.length = 0`);
    assert.equal((await sample("disposed-facade-released")).live, 0);
    for (let batch = 0; batch < 3; batch++) {
      const values = await evaluate(cdp, `(async () => {
        const values = [];
        for (let i = 0; i < 4; i++) {
          const program = await openResourceProgram();
          try { values.push(program.call('score')); }
          finally { program.dispose(); program.dispose(); }
        }
        return values;
      })()`);
      assert.deepEqual(values, Array(4).fill("6093"));
      const released = await sample(`four-create-call-dispose-${batch + 1}`);
      assert.equal(released.created, 1 + 4 * (batch + 1));
      assert.equal(released.live, 0, "released programs must be collectable");
    }
    await evaluate(cdp, `(async () => {
      resourceRetention.held.push(await openResourceProgram());
    })()`);
    const cleanup = await evaluate(cdp, `(() => {
      const program = resourceRetention.held[0];
      const original = Array.from;
      const fault = new Error('injected host cleanup failure');
      let injected = false, caught = false;
      // Synchronous test-only fault at runtime callback-set cleanup. No Wasm
      // bytes or public API are changed; restore the builtin before returning.
      Array.from = function(value, ...args) {
        if (!injected && value instanceof Set) { injected = true; throw fault; }
        return original.call(this, value, ...args);
      };
      const contains = error => error === fault ||
        (error instanceof AggregateError && error.errors.some(contains));
      try { program.dispose(); } catch (error) { caught = contains(error); }
      finally { Array.from = original; }
      program.dispose();
      let rejected = false;
      try { program.call('score'); } catch { rejected = true; }
      return {injected, caught, rejected, status: program.status};
    })()`);
    assert.deepEqual(cleanup, { injected: true, caught: true, rejected: true, status: "disposed" });
    assert.equal((await sample("throwing-cleanup-facade-held")).live, 0,
      "throwing cleanup must not retain the runtime through a held facade");
    return observations;
  } finally {
    await evaluate(cdp, `(() => {
      for (const program of resourceRetention.held) program.dispose();
      WebAssembly.Instance = resourceRetention.original;
      delete globalThis.resourceRetention;
    })()`);
    await cdp.send("HeapProfiler.disable");
  }
}
