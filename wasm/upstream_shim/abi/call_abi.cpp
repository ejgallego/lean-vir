/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "interpreter/interpreter_bridge.h"

#include "package/decl_provider.h"

#include <stdint.h>

#include <string>
#include <vector>

#include "runtime/io.h"
#include "runtime/object.h"

namespace lean::vir {

static std::string g_call_error;

static void cleanup_object_call_args(uint32_t argc, object ** args) {
    if (args == nullptr) {
        return;
    }
    for (uint32_t i = 0; i < argc; i++) {
        lean_dec(args[i]);
    }
}

} // namespace lean::vir

extern "C" uint32_t vir_resolve_call(char const * name_text, uint32_t name_len) {
    lean::vir::g_call_error.clear();
    if (name_text == nullptr) {
        lean::vir::g_call_error = "call name pointer is null";
        return 0;
    }
    if (!lean::vir::package_loaded()) {
        lean::vir::g_call_error = "no IR package has been loaded";
        return 0;
    }

    uint32_t slot = lean::vir::package_call_slot_for_text(name_text, name_len);
    if (slot == 0) {
        lean::vir::g_call_error = "call entry not found";
    }
    return slot;
}

extern "C" uint32_t vir_resolve_call_export(uint32_t export_index) {
    lean::vir::g_call_error.clear();
    if (!lean::vir::package_loaded()) {
        lean::vir::g_call_error = "no IR package has been loaded";
        return 0;
    }

    uint32_t slot = lean::vir::package_call_slot_for_export(export_index);
    if (slot == 0) {
        lean::vir::g_call_error = "package export is not registered";
    }
    return slot;
}

extern "C" lean::object * vir_call_resolved_objects(
    uint32_t call_slot,
    lean::object ** argv,
    uint32_t argc) {
    lean::vir::g_call_error.clear();
    if (argv == nullptr && argc != 0) {
        lean::vir::g_call_error = "object call argv pointer is null";
        return nullptr;
    }
    if (!lean::vir::package_loaded()) {
        lean::vir::cleanup_object_call_args(argc, argv);
        lean::vir::g_call_error = "no IR package has been loaded";
        return nullptr;
    }

    lean::object * fn_obj = lean::vir::package_call_slot_name(call_slot);
    if (fn_obj == nullptr) {
        lean::vir::cleanup_object_call_args(argc, argv);
        lean::vir::g_call_error = "call slot is not registered";
        return nullptr;
    }
    bool has_boxed_decl = lean::vir::package_call_slot_has_boxed_decl(call_slot);
    lean::vir::package_call_runtime_summary summary{};
    if (!lean::vir::package_call_summary(call_slot, summary)) {
        lean::vir::cleanup_object_call_args(argc, argv);
        lean::vir::g_call_error = "object call requires a package-owned call summary";
        return nullptr;
    }
    if (!has_boxed_decl && summary.needs_boxed_wasm32_boundary) {
        lean::vir::cleanup_object_call_args(argc, argv);
        lean::vir::g_call_error = "object call requires a boxed package declaration for this call summary";
        return nullptr;
    }
    if (argc != summary.arg_count) {
        lean::vir::cleanup_object_call_args(argc, argv);
        lean::vir::g_call_error =
            "object call argument count mismatch: package call summary expects " +
            std::to_string(summary.arg_count) +
            ", got " + std::to_string(argc);
        return nullptr;
    }

    std::vector<lean::object *> args;
    args.reserve(argc + (summary.is_io ? 1 : 0));
    for (uint32_t i = 0; i < argc; i++) {
        args.push_back(argv[i]);
    }
    if (summary.is_io) {
        args.push_back(lean_io_mk_world());
    }
    lean::object * result = lean::vir::run_interpreter_function(fn_obj, args.size(), args.data());
    if (summary.is_io) {
        if (!lean_io_result_is_ok(result)) {
            lean_dec(result);
            lean::vir::g_call_error = "IO action failed";
            return nullptr;
        }
        result = lean_io_result_take_value(result);
    }
    return result;
}

extern "C" char const * vir_call_error(void) {
    return lean::vir::g_call_error.c_str();
}

extern "C" uint32_t vir_call_error_size(void) {
    return static_cast<uint32_t>(lean::vir::g_call_error.size());
}
