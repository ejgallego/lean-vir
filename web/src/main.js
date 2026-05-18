import "./style.css";

const statusEl = document.querySelector("#status");
const inputEl = document.querySelector("#fib-input");
const runButton = document.querySelector("#run-button");
const inputDisplay = document.querySelector("#input-display");
const resultDisplay = document.querySelector("#result-display");
const ptrWidth = document.querySelector("#ptr-width");
const declCount = document.querySelector("#decl-count");
const layoutGuard = document.querySelector("#layout-guard");
const maxInput = 10;

async function instantiate(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`failed to load ${path}`);
  }
  const bytes = await response.arrayBuffer();
  const module = new WebAssembly.Module(bytes);
  const imports = {};

  for (const spec of WebAssembly.Module.imports(module)) {
    imports[spec.module] ??= {};
    if (spec.kind === "function") {
      imports[spec.module][spec.name] = (...args) => {
        if (spec.module === "wasi_snapshot_preview1" && spec.name === "proc_exit") {
          throw new Error(`WASI proc_exit(${args[0]})`);
        }
        return 0;
      };
    }
  }

  const instance = await WebAssembly.instantiate(module, imports);
  instance.exports.__wasm_call_ctors?.();
  return instance.exports;
}

function clampInput(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxInput, Math.trunc(value)));
}

function render(exports) {
  const n = clampInput(Number(inputEl.value));
  inputEl.value = String(n);
  inputDisplay.textContent = String(n);
  resultDisplay.textContent = String(exports.vir_upstream_fib(n));
}

try {
  const exports = await instantiate("/vir-upstream.wasm");
  const pointerBytes = exports.vir_upstream_target_pointer_bytes();

  ptrWidth.textContent = `${pointerBytes} bytes`;
  declCount.textContent = String(exports.vir_upstream_shim_fixture_count());
  layoutGuard.textContent = pointerBytes === 4 ? "pass" : "fail";
  statusEl.textContent = "Ready";
  statusEl.dataset.ready = "true";

  runButton.addEventListener("click", () => render(exports));
  inputEl.addEventListener("change", () => render(exports));
  render(exports);
} catch (error) {
  statusEl.textContent = "Failed";
  statusEl.dataset.ready = "false";
  resultDisplay.textContent = "error";
  console.error(error);
}
