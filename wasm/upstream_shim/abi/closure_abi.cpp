/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stdint.h>

#include <string>
#include <vector>

#include "runtime/io.h"
#include "runtime/io_error.h"
#include "runtime/object.h"
#include "interpreter/interpreter_bridge.h"

namespace lean {
namespace {

static std::string g_closure_call_error;

static void cleanup_object_args(uint32_t argc, object ** args) {
    if (args == nullptr) {
        return;
    }
    for (uint32_t i = 0; i < argc; i++) {
        lean_dec(args[i]);
    }
}

// The caller borrows a function from its live managed ownership cell. This ABI,
// like the other object operations, trusts that object/type provenance; it does
// not accept arbitrary integers as validated native handles.
extern "C" object * vir_closure_apply_objects(
    object * fn, uint32_t arity, uint8_t is_io, object ** argv, uint32_t argc) {
    g_closure_call_error.clear();
    if (argv == nullptr && argc != 0) {
        g_closure_call_error = "closure object argv pointer is null";
        return nullptr;
    }
    if (fn == nullptr) {
        cleanup_object_args(argc, argv);
        g_closure_call_error = "closure object is null";
        return nullptr;
    }
    if (argc != arity) {
        cleanup_object_args(argc, argv);
        g_closure_call_error =
            "closure argument count mismatch: expected " +
            std::to_string(arity) +
            ", got " + std::to_string(argc);
        return nullptr;
    }

    // Metadata is passed by value. The invocation owns a separate function
    // reference before entering Lean, so reentry can retire the JS wrapper.
    std::vector<object *> args;
    args.reserve(argc + (is_io ? 1 : 0));
    for (uint32_t i = 0; i < argc; i++) {
        args.push_back(argv[i]);
    }
    if (is_io) {
        args.push_back(lean_io_mk_world());
    }
    lean_inc(fn);
    object * result = vir::apply_package_closure(fn, static_cast<unsigned>(args.size()), args.data());
    if (result == nullptr) {
        g_closure_call_error = vir::package_interpreter_entry_error();
        return nullptr;
    }
    if (is_io) {
        if (!lean_io_result_is_ok(result)) {
            std::string detail = vir::io_result_error_message(result);
            lean_dec(result);
            g_closure_call_error = "IO callback failed";
            if (!detail.empty()) {
                g_closure_call_error += ": ";
                g_closure_call_error += detail;
            }
            return nullptr;
        }
        result = lean_io_result_take_value(result);
    }
    return result;
}

extern "C" char const * vir_closure_call_error(void) {
    return g_closure_call_error.c_str();
}

extern "C" uint32_t vir_closure_call_error_size(void) {
    return static_cast<uint32_t>(g_closure_call_error.size());
}

} // namespace
} // namespace lean
