import { readFile } from "node:fs/promises";

const wasm = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
const irPackage = await readFile(new URL("../web/public/vir-demo.irpkg", import.meta.url));
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

if (typeof exports.vir_alloc_bytes !== "function") {
  throw new Error("vir_alloc_bytes export is missing");
}
if (typeof exports.vir_load_ir_package !== "function") {
  throw new Error("vir_load_ir_package export is missing");
}
if (!exports.memory) {
  throw new Error("memory export is missing");
}
if (typeof exports.vir_upstream_fib !== "function") {
  throw new Error("vir_upstream_fib export is missing");
}
if (typeof exports.vir_upstream_tamagotchi_step !== "function") {
  throw new Error("vir_upstream_tamagotchi_step export is missing");
}
if (typeof exports.vir_upstream_tamagotchi_run_demo !== "function") {
  throw new Error("vir_upstream_tamagotchi_run_demo export is missing");
}
if (typeof exports.vir_eval_const_nat !== "function") {
  throw new Error("vir_eval_const_nat export is missing");
}
if (exports.vir_upstream_target_pointer_bytes() !== 4) {
  throw new Error("upstream wasm target layout guard failed");
}

const packagePtr = exports.vir_alloc_bytes(irPackage.byteLength);
try {
  new Uint8Array(exports.memory.buffer, packagePtr, irPackage.byteLength).set(irPackage);
  const loadedDecls = exports.vir_load_ir_package(packagePtr, irPackage.byteLength);
  if (loadedDecls === 0) {
    throw new Error("IR package load failed");
  }
} finally {
  exports.vir_free_bytes?.(packagePtr);
}

const fibCases = [
  [0, 0],
  [1, 1],
  [8, 21],
  [10, 55],
  [12, 144],
  [17, 1597],
];

for (const [input, expected] of fibCases) {
  const actual = exports.vir_upstream_fib(input);
  if (actual !== expected) {
    throw new Error(`upstream fib ${input}: expected ${expected}, got ${actual}`);
  }
}

const mood = {
  happy: 0,
  hungry: 1,
  sleepy: 2,
  angry: 3,
  asleep: 4,
  dead: 5,
};

const action = {
  feed: 0,
  play: 1,
  nap: 2,
  wake: 3,
  ignore: 4,
};

const stepCases = [
  [mood.happy, action.ignore, mood.hungry],
  [mood.hungry, action.feed, mood.happy],
  [mood.happy, action.play, mood.sleepy],
  [mood.sleepy, action.nap, mood.asleep],
  [mood.asleep, action.wake, mood.happy],
  [mood.hungry, action.ignore, mood.angry],
  [mood.angry, action.ignore, mood.dead],
];

for (const [current, act, expected] of stepCases) {
  const actual = exports.vir_upstream_tamagotchi_step(current, act);
  if (actual !== expected) {
    throw new Error(`upstream Tamagotchi.step ${current} ${act}: expected ${expected}, got ${actual}`);
  }
}

let current = mood.happy;
const trace = [current];
for (const act of [action.ignore, action.feed, action.play, action.nap, action.wake, action.ignore, action.ignore]) {
  current = exports.vir_upstream_tamagotchi_step(current, act);
  trace.push(current);
}

const expectedTrace = [mood.happy, mood.hungry, mood.happy, mood.sleepy, mood.asleep, mood.happy, mood.hungry, mood.angry];
if (trace.join(",") !== expectedTrace.join(",")) {
  throw new Error(`upstream Tamagotchi trace: expected ${expectedTrace}, got ${trace}`);
}

const runDemo = exports.vir_upstream_tamagotchi_run_demo();
if (runDemo !== mood.angry) {
  throw new Error(`upstream Tamagotchi.run demoScript: expected ${mood.angry}, got ${runDemo}`);
}

function evalConstNat(name) {
  const bytes = new TextEncoder().encode(name);
  const ptr = exports.vir_alloc_bytes(bytes.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, ptr, bytes.byteLength).set(bytes);
    return exports.vir_eval_const_nat(ptr, bytes.byteLength);
  } finally {
    exports.vir_free_bytes?.(ptr);
  }
}

const sortChecksum = evalConstNat("SortDemo.demo");
if (sortChecksum !== 192) {
  throw new Error(`upstream SortDemo.demo: expected 192, got ${sortChecksum}`);
}

console.log("upstream smoke ok: fib 17 = 1597, Tamagotchi ends angry, SortDemo checksum = 192");
