/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"
#include "host_import_limits.h"

#include <stdint.h>
#include <array>
#include <utility>

#include "runtime/io.h"
#include "runtime/object.h"

extern "C" {
lean::object * vir_js_call_objects(uint32_t slot, lean::object ** argv, uint32_t argc);
}

namespace lean {
namespace {

static void cleanup_object_args(uint32_t argc, object ** args) {
    if (args == nullptr) {
        return;
    }
    for (uint32_t i = 0; i < argc; i++) {
        lean_dec(args[i]);
    }
}

static object * default_host_import_result(bool is_io) {
    // A pure call has no error carrier: a placeholder would allow invalid Lean
    // continuation. The JS boundary retires this instance after the trap; the
    // pinned Wasm interpreter does not unwind its C++ frames.
    if (!is_io) __builtin_trap();
    return lean_io_result_mk_error(lean_mk_io_user_error(lean_mk_string("JavaScript host import failed")));
}

static object * call_js_import(uint32_t slot, uint32_t argc, object ** args) {
    bool is_io = vir::host_import_is_io(slot);
    uint32_t arity = vir::host_import_arity(slot);
    uint32_t erased_prefix_args = vir::host_import_erased_prefix_args(slot);
    uint32_t effect_args = is_io ? 1 : 0;
    if (arity < erased_prefix_args || arity - erased_prefix_args < effect_args || argc != arity) {
        cleanup_object_args(argc, args);
        return default_host_import_result(is_io);
    }
    uint32_t js_argc = arity - erased_prefix_args - effect_args;
    object * value = vir_js_call_objects(
        slot,
        args == nullptr ? nullptr : args + erased_prefix_args,
        js_argc);
    cleanup_object_args(argc, args);
    // The original JavaScript exception is reported at the owning call boundary.
    // Propagate an IO failure here so Lean bind does not execute its continuation.
    if (value == nullptr) {
        return default_host_import_result(is_io);
    }
    if (is_io) {
        return lean_io_result_mk_ok(value);
    }
    return value;
}

// Each instantiation has the actual fixed Wasm function signature for its
// arity. Only the returned function address is erased for upstream lookup.
template <size_t> using object_arg = object *;

template <size_t Slot, size_t... Args>
static object * host_import_entry(object_arg<Args>... args) {
    std::array<object *, sizeof...(Args)> argv{{args...}};
    return call_js_import(Slot, sizeof...(Args), argv.data());
}

template <size_t... Args, size_t... Slots>
static void * trampoline_for_arity(
    uint32_t slot, std::index_sequence<Args...>, std::index_sequence<Slots...>) {
    using function = object * (*)(object_arg<Args>...);
    static constexpr std::array<function, sizeof...(Slots)> table{{
        &host_import_entry<Slots, Args...>...
    }};
    return reinterpret_cast<void *>(table[slot]);
}

template <size_t Arity>
static void * trampoline_for_arity(uint32_t slot) {
    return trampoline_for_arity(slot, std::make_index_sequence<Arity>{},
        std::make_index_sequence<vir::max_host_import_slots>{});
}

template <size_t... Arities>
static constexpr auto arity_dispatch(std::index_sequence<Arities...>) {
    return std::array<void * (*)(uint32_t), sizeof...(Arities)>{{
        &trampoline_for_arity<Arities>...
    }};
}

static void * host_import_trampoline_for(uint32_t slot, uint32_t arity) {
    if (slot >= vir::max_host_import_slots || arity > vir::max_host_import_arity) {
        return nullptr;
    }
    static constexpr auto table = arity_dispatch(
        std::make_index_sequence<vir::max_host_import_arity + 1>{});
    return table[arity](slot);
}

} // namespace

namespace vir {

void * host_import_trampoline(char const * symbol) {
    int32_t slot = host_import_slot_for_symbol(symbol);
    if (slot < 0) {
        return nullptr;
    }
    return host_import_trampoline_for(
        static_cast<uint32_t>(slot),
        host_import_arity(static_cast<uint32_t>(slot)));
}

} // namespace vir
} // namespace lean
