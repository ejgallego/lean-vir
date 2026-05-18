import { readFile } from "node:fs/promises";

const wasm = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
const mod = new WebAssembly.Module(wasm);
const imports = {};

for (const spec of WebAssembly.Module.imports(mod)) {
  if (!imports[spec.module]) {
    imports[spec.module] = {};
  }
  if (spec.kind === "function") {
    imports[spec.module][spec.name] = (...args) => {
      if (spec.module === "wasi_snapshot_preview1" && spec.name === "proc_exit") {
        throw new Error(`WASI proc_exit(${args[0]})`);
      }
      return 0;
    };
  }
}

const { exports } = await WebAssembly.instantiate(mod, imports);
exports.__wasm_call_ctors?.();

if (typeof exports.vir_upstream_fib !== "function") {
  throw new Error("vir_upstream_fib export is missing");
}
if (exports.vir_upstream_target_pointer_bytes() !== 4) {
  throw new Error("upstream wasm target layout guard failed");
}

const cases = [
  [0, 0],
  [1, 1],
  [8, 21],
  [10, 55],
];

for (const [input, expected] of cases) {
  const actual = exports.vir_upstream_fib(input);
  if (actual !== expected) {
    throw new Error(`upstream fib ${input}: expected ${expected}, got ${actual}`);
  }
}

console.log("upstream smoke ok: fib 8 = 21, fib 10 = 55");
