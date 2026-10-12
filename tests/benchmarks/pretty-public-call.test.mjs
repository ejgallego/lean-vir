import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { screenPrettyPublicCalls } from "../../benchmarks/harness/pretty-public-call.js";

const core = await readFile(new URL("../../benchmarks/browser/examples/prettyM/benchmark-core.js", import.meta.url), "utf8");
const corpus = [
  { format: "hello", width: 8, indent: 0, result: { segments: [{ text: "hello", tags: ["7"] }] } },
  { format: null, width: 80, indent: 0, result: { segments: [] } },
];
function fixture() {
  let tick = 0;
  const context = vm.createContext({ performance: { now: () => ++tick }, setTimeout });
  vm.runInContext(core, context);
  const calls = [];
  const format = (program, value, width, indent) => {
    calls.push({ side: program.side, value, width, indent });
    return value === null ? [] : [{ text: value, tags: [7n] }];
  };
  return { calls, options: {
    corpus, programs: { control: { side: "control" }, candidate: { side: "candidate" } },
    format, sample: context.runDifferentialSamples, repeats: 3, warmups: 2, rounds: 8,
    now: () => ++tick,
  } };
}

test("actual browser sampler retains balanced raw batches and native text/tag equality", async () => {
  const { options, calls } = fixture();
  const result = await screenPrettyPublicCalls(options);
  assert.equal(result.passed, true);
  const measured = result.observations.filter(r => r.phase === "measured");
  assert.equal(measured.length, 16);
  assert.deepEqual(measured.slice(0, 8).map(r => r.side),
    ["control", "candidate", "candidate", "control", "control", "candidate", "candidate", "control"]);
  assert.ok(measured.every(r => r.calls === 6 && r.elapsedMs > 0 && r.ok));
  assert.deepEqual(result.checkedOutputs.control, corpus.map(c => c.result.segments));
  assert.ok(calls.every(c => (c.value === null ? c.width === 80 : c.width === 8) && c.indent === 0));
});

test("reversed setup uses the opposite measured starting order", async () => {
  const { options } = fixture();
  const result = await screenPrettyPublicCalls({ ...options, reverse: true });
  assert.equal(result.passed, true);
  assert.deepEqual(result.observations.filter(r => r.phase === "measured").slice(0, 2).map(r => r.side),
    ["candidate", "control"]);
});

test("native JSON field order does not change segment semantics", async () => {
  const { options } = fixture();
  const reordered = options.corpus.map(c => ({ ...c, result: { segments:
    c.result.segments.map(({ text, tags }) => ({ tags, text })) } }));
  assert.equal((await screenPrettyPublicCalls({ ...options, corpus: reordered })).passed, true);
});

test("native mismatch and lost tag representation prevent a timing claim", async () => {
  for (const wrong of [{ text: "different", tags: [7n] }, { text: "hello", tags: [7] }]) {
    const { options } = fixture();
    const original = options.format;
    const result = await screenPrettyPublicCalls({ ...options,
      format: (program, ...args) => program.side === "candidate" && args[0] !== null ? [wrong] : original(program, ...args),
    });
    assert.equal(result.passed, false);
    assert.match(result.error.message, /oracle|BigInts/);
    assert.equal(result.observations.length, 0);
  }
});

test("a timed candidate failure survives with earlier successful observations", async () => {
  const { options } = fixture();
  const original = options.format;
  let candidateCalls = 0;
  const result = await screenPrettyPublicCalls({ ...options,
    format: (program, ...args) => {
      if (program.side === "candidate" && ++candidateCalls > 2) throw new Error("candidate stopped");
      return original(program, ...args);
    },
  });
  assert.equal(result.passed, false);
  assert.equal(result.error.message, "candidate stopped");
  assert.ok(result.observations.some(r => r.side === "control" && r.ok));
  assert.equal(result.observations.at(-1).ok, false);
  assert.ok(result.observations.at(-1).elapsedMs > 0);
});

test("calibration is control-only and freezes one repeat count for both sides", async () => {
  const { options } = fixture();
  const result = await screenPrettyPublicCalls({ ...options, repeats: null, targetMs: 4 });
  assert.equal(result.passed, true);
  assert.ok(result.observations.filter(r => r.phase === "calibration").every(r => r.side === "control"));
  assert.ok(result.observations.filter(r => r.phase !== "calibration").every(r => r.repeats === result.repeats));
});

test("reject invalid protocol before calling either side", async () => {
  const { options, calls } = fixture();
  for (const bad of [{ rounds: 3 }, { warmups: -1 }, { repeats: 0 }]) {
    await assert.rejects(screenPrettyPublicCalls({ ...options, ...bad }));
  }
  assert.equal(calls.length, 0);
});

test("comparison preserves segment and nested tag order", async () => {
  for (const change of [segments => segments.toReversed(),
    segments => segments.map(s => ({ ...s, tags: s.tags.toReversed() }))]) {
    const { options } = fixture();
    const expected = [{ text: "a", tags: [7n, 8n] }, { text: "b", tags: [7n] }];
    const selected = [{ format: "tagged", width: 8, indent: 0,
      result: { segments: expected.map(s => ({ text: s.text, tags: s.tags.map(String) })) } }];
    const result = await screenPrettyPublicCalls({ ...options, corpus: selected,
      format: program => program.side === "candidate" ? change(expected) : expected });
    assert.equal(result.passed, false);
    assert.match(result.error.message, /native oracle/);
  }
});

test("CLI help is build-free and an existing output is never overwritten", async t => {
  const driver = new URL("../../benchmarks/harness/bench-prettym-browser.mjs", import.meta.url);
  assert.equal(spawnSync(process.execPath, [driver.pathname, "--help"]).status, 0);
  const dir = await mkdtemp(join(tmpdir(), "vir-pretty-report-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, "completed");
  await mkdir(output);
  await writeFile(join(output, "report.json"), '{"status":"passed"}\n');
  const run = spawnSync(process.execPath, [driver.pathname, "--site", dir,
    "--corpus", join(dir, "missing.json"), "--adapter", join(dir, "missing.js"), "--output", output]);
  assert.notEqual(run.status, 0);
  assert.equal(await readFile(join(output, "report.json"), "utf8"), '{"status":"passed"}\n');
});
