/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stddef.h>
#include <stdint.h>

#include "runtime/object.h"

namespace lean::vir {

object * find_package_decl(object * name);
object * find_package_boxed_decl(object * name);
object * find_package_init_name(object * name);
uint32_t package_call_slot_for_name(object * name);
object * package_call_slot_name(uint32_t slot);
bool package_call_slot_has_boxed_decl(uint32_t slot);
char const * package_call_signature(uint32_t slot);
uint32_t package_call_signature_size(uint32_t slot);
bool package_call_is_io(uint32_t slot);
char const * find_host_import_symbol(object * name);
int32_t host_import_slot_for_symbol(char const * symbol);
uint32_t host_import_arity(uint32_t slot);
uint32_t host_import_erased_prefix_args(uint32_t slot);
void * host_import_trampoline(char const * symbol);
char const * host_import_signature(uint32_t slot);
uint32_t host_import_signature_size(uint32_t slot);
bool host_import_is_io(uint32_t slot);
uint32_t package_decl_count();
bool package_loaded();
uint32_t package_generation();

}

extern "C" void * vir_alloc_bytes(uint32_t size);
extern "C" void vir_free_bytes(void * ptr);
extern "C" uint32_t vir_load_ir_package(uint8_t const * data, uint32_t size);
extern "C" char const * vir_last_package_error(void);
extern "C" uint32_t vir_last_package_error_size(void);
extern "C" char const * vir_package_interface_manifest(void);
extern "C" uint32_t vir_package_interface_manifest_size(void);
extern "C" uint32_t vir_package_decl_count(void);
extern "C" void vir_ensure_ir_interpreter_initialized(void);
extern "C" void vir_set_io_initializing(uint8_t value);
extern "C" uint8_t vir_get_io_initializing(void);
