import "./style.css";

const statusEl = document.querySelector("#status");
const inputEl = document.querySelector("#fib-input");
const runButton = document.querySelector("#run-button");
const inputDisplay = document.querySelector("#input-display");
const resultDisplay = document.querySelector("#result-display");
const ptrWidth = document.querySelector("#ptr-width");
const sizeWidth = document.querySelector("#size-width");
const layoutGuard = document.querySelector("#layout-guard");

const wasiImports = {
  wasi_snapshot_preview1: {
    proc_exit(code) {
      throw new Error(`WASI proc_exit(${code})`);
    },
  },
};

async function instantiate() {
  const response = await fetch("/vir.wasm");
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, wasiImports);
  return instance.exports;
}

function clampInput(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(30, Math.trunc(value)));
}

function render(exports) {
  const n = clampInput(Number(inputEl.value));
  inputEl.value = String(n);
  inputDisplay.textContent = String(n);
  resultDisplay.textContent = String(exports.vir_fib(n));
}

try {
  const exports = await instantiate();
  ptrWidth.textContent = `${exports.vir_target_pointer_bytes()} bytes`;
  sizeWidth.textContent = `${exports.vir_target_size_t_bytes()} bytes`;
  layoutGuard.textContent = exports.vir_target_layout_ok() === 1 ? "pass" : "fail";
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

