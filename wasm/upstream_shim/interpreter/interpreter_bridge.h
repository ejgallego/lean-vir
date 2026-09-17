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
// Borrow fn_obj; consume the argc argument references, including rejected entry.
// Successful results are owned; rejected entry returns nullptr (see error below).
object * run_interpreter_function(object * fn_obj, size_t argc, object ** args);
object * run_package_interpreter_function(object * fn_obj, size_t argc, object ** args);
// Consume fn's application reference and arguments, not the caller's closure root.
object * apply_package_closure(object * fn, unsigned argc, object ** args);
// Borrow both names; return an owned IO result, including rejected-entry errors.
object * run_package_interpreter_initializer(object * decl_obj, object * init_obj);
// Borrow static error text for rejected entry; nullptr after accepted preparation.
char const * package_interpreter_entry_error();
void reset_package_interpreter();

}
