#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

report="build/generated/ir-provider-report.md"

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
echo "Package: build/generated/vir-demo.irpkg"
echo "Report:  $report"
