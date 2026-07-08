/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"
#include "name_utils.h"
#include "signature_cache.h"

#include <stddef.h>
#include <stdint.h>

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

#include "library/elab_environment.h"
#include "library/ir_interpreter.h"
#include "runtime/io.h"
#include "runtime/object.h"

extern "C" {
extern lean_object * l_ByteArray_empty;
}

namespace lean {
namespace {

static object * mk_ctor(unsigned tag, std::initializer_list<object *> fields, unsigned scalar_size = 0) {
    object * obj = lean_alloc_ctor(tag, fields.size(), scalar_size);
    unsigned idx = 0;
    for (object * field : fields) {
        lean_inc(field);
        lean_ctor_set(obj, idx, field);
        idx++;
    }
    return obj;
}

static object * mk_some(object * value) {
    return mk_ctor(1, { value });
}

static void ensure_ir_interpreter_initialized() {
    static bool initialized = false;
    if (!initialized) {
        initialize_ir_interpreter();
        l_ByteArray_empty = lean_mk_empty_byte_array(lean_box(0));
        lean_mark_persistent(l_ByteArray_empty);
        initialized = true;
    }
}

static void cleanup_object_args(uint32_t argc, object ** args) {
    if (args == nullptr) {
        return;
    }
    for (uint32_t i = 0; i < argc; i++) {
        lean_dec(args[i]);
    }
}

static std::string g_call_error;
struct closure_root {
    object * value = nullptr;
    uint32_t arity = 0;
    bool is_io = false;
};

static std::vector<closure_root> g_closure_roots;
static std::vector<uint32_t> g_free_closure_root_ids;
static std::string g_closure_call_error;

static closure_root * closure_root_for_id(uint32_t root_id) {
    if (root_id == 0 || root_id > g_closure_roots.size()) {
        return nullptr;
    }
    closure_root & root = g_closure_roots[root_id - 1];
    return root.value == nullptr ? nullptr : &root;
}

extern "C" uint32_t vir_closure_root(
    object * value,
    uint32_t arity,
    uint8_t is_io) {
    if (value == nullptr) {
        return 0;
    }
    lean_inc(value);
    if (!g_free_closure_root_ids.empty()) {
        uint32_t root_id = g_free_closure_root_ids.back();
        g_free_closure_root_ids.pop_back();
        g_closure_roots[root_id - 1] = { value, arity, is_io != 0 };
        return root_id;
    }
    g_closure_roots.push_back({ value, arity, is_io != 0 });
    return static_cast<uint32_t>(g_closure_roots.size());
}

extern "C" uint32_t vir_closure_release(uint32_t root_id) {
    closure_root * root = closure_root_for_id(root_id);
    if (root == nullptr) {
        return 0;
    }
    object * value = root->value;
    g_closure_roots[root_id - 1] = {};
    g_free_closure_root_ids.push_back(root_id);
    lean_dec(value);
    return 1;
}

extern "C" object * vir_closure_call_objects(uint32_t root_id, object ** argv, uint32_t argc) {
    g_closure_call_error.clear();
    if (argv == nullptr && argc != 0) {
        g_closure_call_error = "closure object argv pointer is null";
        return nullptr;
    }
    closure_root * root = closure_root_for_id(root_id);
    if (root == nullptr) {
        cleanup_object_args(argc, argv);
        g_closure_call_error = "closure root id is not live";
        return nullptr;
    }
    object * fn = root->value;
    if (argc != root->arity) {
        cleanup_object_args(argc, argv);
        g_closure_call_error =
            "closure argument count mismatch: expected " +
            std::to_string(root->arity) +
            ", got " + std::to_string(argc);
        return nullptr;
    }

    std::vector<object *> args;
    args.reserve(argc + (root->is_io ? 1 : 0));
    for (uint32_t i = 0; i < argc; i++) {
        args.push_back(argv[i]);
    }
    if (root->is_io) {
        args.push_back(lean_io_mk_world());
    }
    lean_inc(fn);
    object * result = apply_n(fn, static_cast<unsigned>(args.size()), args.data());
    if (root->is_io) {
        if (!lean_io_result_is_ok(result)) {
            lean_dec(result);
            g_closure_call_error = "IO callback failed";
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

extern "C" void vir_ensure_ir_interpreter_initialized(void) {
    lean::ensure_ir_interpreter_initialized();
}

extern "C" lean::object * lean_ir_find_env_decl(lean::object *, lean::object * n) {
    if (lean::object * decl = lean::vir::find_package_decl(n)) {
        return lean::mk_some(decl);
    }
    return lean_box(0);
}

extern "C" lean::object * lean_ir_find_env_decl_boxed(lean::object *, lean::object * n) {
    if (lean::object * decl = lean::vir::find_package_boxed_decl(n)) {
        return lean::mk_some(decl);
    }
    return lean_box(0);
}

extern "C" uint32_t vir_upstream_target_pointer_bytes(void) {
    return sizeof(void *);
}

static lean::object * run_package_function(
    lean::name const & fn,
    size_t argc,
    lean::object ** args) {
    lean::ensure_ir_interpreter_initialized();
    lean::elab_environment env(lean_box(0));
    lean::options opts(lean_box(0));
    return lean::ir::run_boxed(env, opts, fn, argc, args);
}

static lean::object * run_package_function(
    lean::object * fn_obj,
    size_t argc,
    lean::object ** args) {
    lean::name fn(fn_obj, true);
    return run_package_function(fn, argc, args);
}

extern "C" uint32_t vir_resolve_call(char const * name_text, uint32_t name_len) {
    lean::g_call_error.clear();
    if (name_text == nullptr) {
        lean::g_call_error = "call name pointer is null";
        return 0;
    }
    if (!lean::vir::package_loaded()) {
        lean::g_call_error = "no IR package has been loaded";
        return 0;
    }

    lean::name fn = lean::name_from_dotted(name_text, name_len);
    uint32_t slot = lean::vir::package_call_slot_for_name(fn.to_obj_arg());
    if (slot == 0) {
        lean::g_call_error = "call entry not found";
    }
    return slot;
}

static void cleanup_object_call_args(uint32_t argc, lean::object ** args) {
    if (args == nullptr) {
        return;
    }
    for (uint32_t i = 0; i < argc; i++) {
        lean_dec(args[i]);
    }
}

extern "C" lean::object * vir_call_resolved_objects(
    uint32_t call_slot,
    lean::object ** argv,
    uint32_t argc) {
    lean::g_call_error.clear();
    if (argv == nullptr && argc != 0) {
        lean::g_call_error = "object call argv pointer is null";
        return nullptr;
    }
    if (!lean::vir::package_loaded()) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error = "no IR package has been loaded";
        return nullptr;
    }

    lean::object * fn_obj = lean::vir::package_call_slot_name(call_slot);
    if (fn_obj == nullptr) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error = "call slot is not registered";
        return nullptr;
    }
    bool has_boxed_decl = lean::vir::package_call_slot_has_boxed_decl(call_slot);
    lean::package_call_signature const * signature = lean::cached_package_call_signature(call_slot);
    if (signature == nullptr) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error = "object call requires a package-owned call signature";
        return nullptr;
    }
    if (!signature->ok) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error = signature->error;
        return nullptr;
    }
    if (!has_boxed_decl && signature->needs_boxed_wasm32_boundary) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error = "object call requires a boxed package declaration for this signature";
        return nullptr;
    }
    if (argc != signature->arg_count) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error =
            "object call argument count mismatch: package signature expects " +
            std::to_string(signature->arg_count) +
            ", got " + std::to_string(argc);
        return nullptr;
    }

    std::vector<lean::object *> args;
    args.reserve(argc + (signature->is_io ? 1 : 0));
    for (uint32_t i = 0; i < argc; i++) {
        args.push_back(argv[i]);
    }
    if (signature->is_io) {
        args.push_back(lean_io_mk_world());
    }
    lean::object * result = run_package_function(fn_obj, args.size(), args.data());
    if (signature->is_io) {
        if (!lean_io_result_is_ok(result)) {
            lean_dec(result);
            lean::g_call_error = "IO action failed";
            return nullptr;
        }
        result = lean_io_result_take_value(result);
    }
    return result;
}

extern "C" char const * vir_call_error(void) {
    return lean::g_call_error.c_str();
}

extern "C" uint32_t vir_call_error_size(void) {
    return static_cast<uint32_t>(lean::g_call_error.size());
}
