/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { ManagedRuntime } from "./managed-core.js";
import { withObjectValues } from "./object-values.js";

// Full supported runtime composition; lifecycle and ownership live in the core.
export class VirRuntime extends withObjectValues(ManagedRuntime) {}
