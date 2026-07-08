/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stdint.h>

#include <string>

namespace lean {

struct package_call_signature {
    bool ok = false;
    std::string error;
    uint32_t arg_count = 0;
    bool is_io = false;
    bool needs_boxed_wasm32_boundary = false;
};

package_call_signature const * cached_package_call_signature(uint32_t slot);

}
