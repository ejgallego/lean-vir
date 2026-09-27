import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";

const wasi = new WASI({ version: "preview1", returnOnExit: true });
const { instance } = await WebAssembly.instantiate(await readFile(process.argv[2]), {
  wasi_snapshot_preview1: {
    ...wasi.wasiImport,
    clock_time_get() { throw new Error("constructor initialization must not require a clock"); },
  },
});
const status = wasi.start(instance);
if (status !== 0) throw new Error(`constructor checks failed with exit ${status}`);
