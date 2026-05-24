#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  echo "usage: scripts/lean-to-irpkg.sh <source.lean> [package.irpkg] [root ...]" >&2
  echo "       when roots are omitted, public source definitions become exports" >&2
}

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
  lean --run tools/GeneratePackage.lean "$package" "$report" --target-all "$source"
else
  lean --run tools/GeneratePackage.lean "$package" "$report" --target "$source" "$@"
fi

echo "report: $report"
