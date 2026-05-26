#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."

report="build/generated/fixtures-basic.report.md"

set +e
npm run --silent generate:package
status=$?
set -e

if [ "$status" != "0" ]; then
  echo "IR package generation failed."
  if [ -f "$report" ]; then
    echo
    echo "Relevant report sections from $report:"
    sed -n '/^## Missing IR Declarations/,/^## Missing Native Extern Registrations/p' "$report"
    sed -n '/^## Missing Native Extern Registrations/,$p' "$report"
  else
    echo "No report was written at $report."
  fi
  exit "$status"
fi

echo
echo "IR package generation succeeded."
echo "Packages:"
for package in build/generated/fixtures-basic.irpkg build/generated/demo-host.irpkg build/generated/pretty-printer.irpkg build/generated/fixtures-lean.irpkg build/generated/fixtures-boundary.irpkg; do
  echo "  $package"
done
echo "Primary report: $report"
