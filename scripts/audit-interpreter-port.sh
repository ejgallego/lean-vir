#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

src="${LEAN4_SRC:-third_party/lean4-src}"
out="build/interpreter-port"

if [ ! -f "$src/src/library/ir_interpreter.cpp" ]; then
  echo "error: Lean source not found at $src; run scripts/fetch-lean-source.sh first" >&2
  exit 1
fi

mkdir -p "$out"

{
  echo "# Lean IR Interpreter Port Audit"
  echo
  echo "Lean source: $src"
  echo "Commit: $(git -C "$src" rev-parse HEAD)"
  echo
  echo "## Source files"
  for path in \
    src/library/ir_interpreter.cpp \
    src/library/ir_interpreter.h \
    src/library/ir_types.h \
    src/runtime/object.cpp \
    src/runtime/object.h \
    src/runtime/apply.cpp \
    src/runtime/apply.h \
    src/runtime/alloc.cpp \
    src/runtime/alloc.h
  do
    if [ -f "$src/$path" ]; then
      printf -- "- %s\n" "$path"
    else
      printf -- "- missing: %s\n" "$path"
    fi
  done
  echo
  echo "## Porting hotspots"
  rg -n "dlsym|GetProcAddress|shared_mutex|LEAN_THREAD_PTR|libuv|pthread|dynlib|RTLD_DEFAULT|LEAN_EMSCRIPTEN|TODO|not implemented" \
    "$src/src/library/ir_interpreter.cpp" \
    "$src/src/runtime" \
    "$src/src/library/dynlib.cpp" \
    --glob '*.cpp' --glob '*.h' \
    || true
} > "$out/audit.md"

echo "wrote $out/audit.md"

