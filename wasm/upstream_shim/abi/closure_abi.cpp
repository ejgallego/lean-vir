/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stdint.h>

#include <string>
#include <vector>

#include "runtime/io.h"
#include "runtime/object.h"

namespace lean {
namespace {

struct closure_root {
    object * value = nullptr;
    uint32_t arity = 0;
    bool is_io = false;
};

static std::vector<closure_root> g_closure_roots;
static std::vector<uint32_t> g_free_closure_root_ids;
static std::string g_closure_call_error;

static void cleanup_object_args(uint32_t argc, object ** args) {
    if (args == nullptr) {
        return;
    }
    for (uint32_t i = 0; i < argc; i++) {
        lean_dec(args[i]);
    }
}

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
