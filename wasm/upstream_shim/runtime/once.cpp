/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <lean/lean.h>

#if defined(__wasm_atomics__)
#error "The local once providers require a single-threaded Wasm runtime"
#endif

namespace {
template <class T> void persist(T) {}
void persist(lean_object * value) { lean_mark_persistent(value); }

// Pinned Lean lazy constants use atomic wait even for an uncontended native
// lock. The single-threaded WASI boundary has no clock or blocking threads.
// Preserve initialization and object persistence without the native wait.
template <class T> T once(T * loc, lean_once_cell_t * tok, T (*init)()) {
    if (tok->state.load() != 1) {
        // Recursive initialization of this cell cannot make progress. Trap
        // instead of hanging; a trapped instance must be retired by its host.
        if (tok->lock.exchange(1) != 0) __builtin_trap();
        *loc = init();
        persist(*loc);
        tok->state.store(1);
        tok->lock.store(0);
    }
    return *loc;
}
}

#define VIR_ONCE_PROVIDER(name, type) \
    extern "C" type lean_##name##_once_cold( \
        type * loc, lean_once_cell_t * tok, type (*init)()) { \
        return once(loc, tok, init); \
    }

VIR_ONCE_PROVIDER(obj, lean_object *)
VIR_ONCE_PROVIDER(uint8, uint8_t)
VIR_ONCE_PROVIDER(uint16, uint16_t)
VIR_ONCE_PROVIDER(uint32, uint32_t)
VIR_ONCE_PROVIDER(uint64, uint64_t)
VIR_ONCE_PROVIDER(usize, size_t)
VIR_ONCE_PROVIDER(float32, float)
VIR_ONCE_PROVIDER(float, double)

#undef VIR_ONCE_PROVIDER
