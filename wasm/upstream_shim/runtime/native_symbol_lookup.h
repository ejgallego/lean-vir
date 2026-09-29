/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

namespace lean::vir {

// Membership in the generated native registry; never performs dynamic lookup.
bool is_registered_native_symbol(char const * symbol);

}
