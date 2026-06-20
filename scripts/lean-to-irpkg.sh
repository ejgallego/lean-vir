#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  cat >&2 <<'EOF'
usage: scripts/lean-to-irpkg.sh <source.lean> [package.irpkg] [root ...]

Generate one manifest-bearing .irpkg from one Lean source file.
When roots are omitted, public source definitions are auto-discovered and
become JavaScript-callable exports if their types are supported.

examples:
  npm run generate:irpkg -- examples/Fib.lean build/generated/fib.irpkg
  npm run generate:irpkg -- examples/MergeSort.lean build/generated/sort.irpkg SortDemo.demo
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ "$#" -lt 1 ]; then
  usage
  exit 2
fi

source=$1
shift

if [ ! -f "$source" ]; then
  echo "error: source file not found: $source" >&2
  exit 2
fi

stem=$(basename "$source")
stem=${stem%.lean}

package=${1:-"build/generated/${stem}.irpkg"}
if [ "$#" -gt 0 ]; then
  shift
fi

report=${package%.irpkg}.report.md

if [ "$#" -eq 0 ]; then
  target_args=(--target-all "$source")
  mode="auto-discover public definitions"
else
  target_args=(--target "$source" "$@")
  mode="explicit roots: $*"
fi

echo "generating Lean IR package"
echo "source:  $source"
echo "package: $package"
echo "report:  $report"
echo "mode:    $mode"

if [ "${VIR_SKIP_IRPKG_BUILD:-0}" != "1" ]; then
  scripts/build-lean-lib.sh
  lake build vir_irpkg
fi

lean_prefix="$(lean --print-prefix)"
generator_lean_path="build/lean-lib:.lake/build/lib/lean:$lean_prefix/lib/lean"

set +e
LEAN_PATH="$generator_lean_path${LEAN_PATH:+:$LEAN_PATH}" .lake/build/bin/vir_irpkg "$package" "$report" "${target_args[@]}"
status=$?
set -e
if [ "$status" -ne 0 ]; then
  echo "error: package generation failed" >&2
  echo "source:  $source" >&2
  echo "package: $package" >&2
  echo "report:  $report" >&2
  echo "the report contains the exact missing declarations or package diagnostics" >&2
  exit "$status"
fi

echo "local package ready"
echo "package:   $package"
echo "report:    $report"
echo "interface: embedded in package"
case "$package" in
  web/public/*)
    echo "runner:    npm run dev -- --port 5173"
    echo "url:       /dev.html?package=${package#web/public/}"
    ;;
  *)
    echo "runner:    npm run dev -- --port 5173, then upload this .irpkg in /dev.html"
    ;;
esac
