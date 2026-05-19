import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";

const wasmPath = process.argv[2] ?? "build/upstream-probe/vir-engine-bench.wasm";
const bytes = await readFile(wasmPath);
const wasi = new WASI({
  version: "preview1",
  args: [wasmPath],
  env: {},
});

const module = await WebAssembly.compile(bytes);
const instance = await WebAssembly.instantiate(module, {
  wasi_snapshot_preview1: wasi.wasiImport,
});

wasi.start(instance);
