/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

#include "io_error.h"

#include "runtime/io.h"
#include "util/io.h"

namespace lean::vir {

std::string io_result_error_message(object * result) {
    if (result == nullptr || lean_io_result_is_ok(result)) {
        return {};
    }
    object * error = lean_io_result_get_error(result);
    // lean_io_error_to_string consumes an owned error argument.  Keep the
    // result's borrowed child alive for the caller's eventual lean_dec.
    lean_inc(error);
    object * text = lean_io_error_to_string(error);
    size_t const size = lean_string_size(text);
    std::string message(lean_string_cstr(text), size == 0 ? 0 : size - 1);
    lean_dec(text);
    return message;
}

}
