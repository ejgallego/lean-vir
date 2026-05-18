#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

provider="build/generated/static_decl_provider.generated.cpp"
report="build/generated/ir-provider-report.md"

lean --run tools/GenerateProvider.lean "$provider" "$report"
