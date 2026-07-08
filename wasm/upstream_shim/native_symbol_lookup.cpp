/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"

#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#include <string>

#include "runtime/object.h"
#include "util/name.h"

// Generated from Vir/GeneratePackage/NativeExterns.lean nativeExterns.
#include "native_symbols_registry.inc"

extern "C" lean_object * l_ByteArray_empty;

#define VIR_DECLARE_NATIVE_BOXED(lean_name, stem, fn) extern "C" lean_object * fn(...);
#define VIR_DECLARE_NATIVE_CONST(lean_name, stem, ptr)
VIR_NATIVE_SYMBOLS(VIR_DECLARE_NATIVE_BOXED, VIR_DECLARE_NATIVE_CONST)
#undef VIR_DECLARE_NATIVE_CONST
#undef VIR_DECLARE_NATIVE_BOXED

namespace {

struct NativeSymbol {
    char const * lean_name;
    char const * stem;
    char const * dlsym_name;
    void * address;
};

static NativeSymbol const g_native_symbols[] = {
#define VIR_NATIVE_BOXED_ENTRY(lean_name, stem, fn) \
    { lean_name, stem, stem "___boxed", reinterpret_cast<void *>(fn) },
#define VIR_NATIVE_CONST_ENTRY(lean_name, stem, ptr) \
    { lean_name, stem, stem, reinterpret_cast<void *>(ptr) },
    VIR_NATIVE_SYMBOLS(VIR_NATIVE_BOXED_ENTRY, VIR_NATIVE_CONST_ENTRY)
#undef VIR_NATIVE_CONST_ENTRY
#undef VIR_NATIVE_BOXED_ENTRY
};
#undef VIR_NATIVE_SYMBOLS

static char const * known_symbol_stem(lean::name const & n) {
    if (char const * symbol = lean::vir::find_host_import_symbol(n.raw())) {
        return symbol;
    }
    std::string dotted = n.to_string();
    for (NativeSymbol const & entry : g_native_symbols) {
        if (dotted == entry.lean_name) {
            return entry.stem;
        }
    }
    return nullptr;
}

} // namespace

extern "C" void * dlsym(void *, char const * sym) {
    for (NativeSymbol const & entry : g_native_symbols) {
        if (strcmp(sym, entry.dlsym_name) == 0) {
            return entry.address;
        }
    }
    if (void * host_import = lean::vir::host_import_trampoline(sym)) {
        return host_import;
    }
    return nullptr;
}

extern "C" lean::obj_res lean_get_symbol_stem(lean::obj_arg env, lean::obj_arg fn) {
    lean_dec(env);
    lean::name n(fn);
    if (char const * stem = known_symbol_stem(n)) {
        return lean_mk_string(stem);
    }
    std::string fallback = n.to_string();
    return lean_mk_string(fallback.c_str());
}

extern "C" lean::obj_res lean_mk_mangled_boxed_name(lean::obj_arg str) {
    lean::string_ref stem(str);
    std::string boxed = stem.to_std_string() + "___boxed";
    return lean_mk_string(boxed.c_str());
}

extern "C" void * __cxa_allocate_exception(size_t size) {
    return malloc(size == 0 ? 1 : size);
}

extern "C" [[noreturn]] void __cxa_throw(void *, void *, void (*)(void *)) {
    __builtin_trap();
    abort();
}
