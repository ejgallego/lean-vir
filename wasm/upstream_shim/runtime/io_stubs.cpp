/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "runtime/io.h"
#include "runtime/object.h"

extern "C" lean::obj_res lean_io_eprintln(lean::obj_arg s) {
    lean_dec(s);
    return lean_io_result_mk_ok(lean_box(0));
}

extern "C" void lean_io_result_show_error(lean::b_obj_arg) {}

