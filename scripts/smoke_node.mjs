import { readFile } from "node:fs/promises";

const wasm = await readFile(new URL("../web/public/vir.wasm", import.meta.url));
const imports = {
  wasi_snapshot_preview1: {
    proc_exit(code) {
      throw new Error(`WASI proc_exit(${code})`);
    },
  },
};

const { instance } = await WebAssembly.instantiate(wasm, imports);
const { vir_fib, vir_target_pointer_bytes, vir_target_size_t_bytes, vir_target_layout_ok } = instance.exports;

if (typeof vir_fib !== "function") {
  throw new Error("vir_fib export is missing");
}
if (vir_target_pointer_bytes() !== 4 || vir_target_size_t_bytes() !== 4 || vir_target_layout_ok() !== 1) {
  throw new Error("wasm target layout guard failed");
}

const cases = [
  [0, 0],
  [1, 1],
  [8, 21],
  [10, 55],
];

for (const [input, expected] of cases) {
  const actual = vir_fib(input);
  if (actual !== expected) {
    throw new Error(`fib ${input}: expected ${expected}, got ${actual}`);
  }
}

console.log("smoke ok: fib 8 = 21, fib 10 = 55");

