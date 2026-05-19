#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."

package="build/generated/vir-demo.irpkg"
report="build/generated/ir-provider-report.md"

lean --run tools/GeneratePackage.lean "$package" "$report"
