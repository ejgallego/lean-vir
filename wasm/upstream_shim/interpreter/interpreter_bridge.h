/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stddef.h>

#include "runtime/object.h"

namespace lean::vir {

void ensure_ir_interpreter_initialized();
object * run_interpreter_function(object * fn_obj, size_t argc, object ** args);

}

