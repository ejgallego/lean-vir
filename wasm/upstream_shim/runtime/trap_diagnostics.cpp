/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <typeinfo>

#include "runtime/exception.h"

// The module is built without Wasm exception handling. A C++ throw cannot
// unwind, so it ends the instance: record the exception text here, then trap.
// The JS runtime reads this buffer when it retires the failed instance.

extern "C" char * __cxa_demangle(char const *, char *, size_t *, int *);

namespace {

// Fixed storage: reporting a memory_exception must not allocate.
constexpr size_t trap_message_capacity = 4096;
char g_trap_message[trap_message_capacity];
uint32_t g_trap_message_size = 0;

void append_trap_message(char const * text) {
    if (text == nullptr) return;
    size_t available = trap_message_capacity - g_trap_message_size;
    size_t length = strnlen(text, available);
    memcpy(g_trap_message + g_trap_message_size, text, length);
    g_trap_message_size += static_cast<uint32_t>(length);
}

// Without unwinding there is no catch clause to match a thrown type against its
// bases, so recognize the Lean exception classes linked into this module. Any
// other type is reported by name.
char const * lean_exception_message(void * thrown, std::type_info const & type) {
    if (type == typeid(lean::exception)) return static_cast<lean::exception *>(thrown)->what();
    if (type == typeid(lean::throwable)) return static_cast<lean::throwable *>(thrown)->what();
    if (type == typeid(lean::stack_space_exception))
        return static_cast<lean::stack_space_exception *>(thrown)->what();
    if (type == typeid(lean::memory_exception)) return static_cast<lean::memory_exception *>(thrown)->what();
    if (type == typeid(lean::heartbeat_exception))
        return static_cast<lean::heartbeat_exception *>(thrown)->what();
    if (type == typeid(lean::interrupted)) return static_cast<lean::interrupted *>(thrown)->what();
    return nullptr;
}

void record_thrown_exception(void * thrown, std::type_info const * type) {
    g_trap_message_size = 0;
    if (type == nullptr) {
        append_trap_message("C++ exception of unknown type");
        return;
    }
    if (char const * message = lean_exception_message(thrown, *type)) {
        append_trap_message(message);
        return;
    }
    append_trap_message("C++ exception of type ");
    int status = 0;
    char * demangled = __cxa_demangle(type->name(), nullptr, nullptr, &status);
    append_trap_message(status == 0 && demangled != nullptr ? demangled : type->name());
    free(demangled);
}

}  // namespace

extern "C" void * __cxa_allocate_exception(size_t size) {
    return malloc(size == 0 ? 1 : size);
}

extern "C" [[noreturn]] void __cxa_throw(void * thrown, void * type, void (*)(void *)) {
    record_thrown_exception(thrown, static_cast<std::type_info const *>(type));
    __builtin_trap();
}

extern "C" char const * vir_last_trap_message(void) {
    return g_trap_message;
}

extern "C" uint32_t vir_last_trap_message_size(void) {
    return g_trap_message_size;
}
