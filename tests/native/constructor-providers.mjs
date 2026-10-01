import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";

const wasm = await readFile(process.argv[2]);

async function run(args = []) {
  const wasi = new WASI({
    version: "preview1",
    returnOnExit: true,
    args: ["constructor-providers.wasm", ...args],
  });
  const { instance } = await WebAssembly.instantiate(wasm, {
    env: {
      vir_resource_release() {
        throw new Error("a foreign external object must not release a JS resource root");
      },
    },
    wasi_snapshot_preview1: {
      ...wasi.wasiImport,
      clock_time_get() { throw new Error("constructor initialization must not require a clock"); },
    },
  });
  return wasi.start(instance);
}

const status = await run();
if (status !== 0) throw new Error(`constructor checks failed with exit ${status}`);

await assert.rejects(
  () => run(["--same-cell-recursion"]),
  WebAssembly.RuntimeError,
  "same-cell initialization must trap before re-entering the initializer",
);
