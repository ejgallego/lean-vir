/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

#pragma once

#include <string>

#include "runtime/object.h"

namespace lean::vir {

// Format the owned IO.Result error payload while result remains alive.
// Returns an empty string for an OK result or a missing result.
std::string io_result_error_message(object * result);

}
