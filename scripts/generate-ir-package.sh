#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

package="build/generated/vir-demo.irpkg"
report="build/generated/ir-provider-report.md"

lean --run tools/GeneratePackage.lean "$package" "$report"
