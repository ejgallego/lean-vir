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
object * run_package_interpreter_function(object * fn_obj, size_t argc, object ** args);
object * apply_package_closure(object * fn, unsigned argc, object ** args);
object * run_package_interpreter_initializer(object * decl_obj, object * init_obj);
char const * package_interpreter_entry_error();
void reset_package_interpreter();

}
