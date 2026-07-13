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

struct package_call_runtime_summary {
    uint32_t arg_count;
    bool is_io;
    bool needs_boxed_wasm32_boundary;
};

object * find_package_decl(object * name);
object * find_package_boxed_decl(object * name);
object * find_package_init_name(object * name);
uint32_t package_call_slot_for_text(char const * text, size_t len);
uint32_t package_call_slot_for_export(uint32_t export_index);
object * package_call_slot_name(uint32_t slot);
bool package_call_slot_has_boxed_decl(uint32_t slot);
bool package_call_summary(uint32_t slot, package_call_runtime_summary & out);
char const * find_host_import_symbol(object * name);
int32_t host_import_slot_for_symbol(char const * symbol);
uint32_t host_import_arity(uint32_t slot);
uint32_t host_import_erased_prefix_args(uint32_t slot);
void * host_import_trampoline(char const * symbol);
bool host_import_is_io(uint32_t slot);
uint32_t package_decl_count();
bool package_loaded();
uint32_t package_generation();
uint32_t package_format_version();
void clear_loaded_package();
bool load_package(uint8_t const * data, size_t size);
bool run_package_initializers();
char const * last_package_error();
uint32_t last_package_error_size();
char const * package_interface_manifest();
uint32_t package_interface_manifest_size();

}

extern "C" void * vir_alloc_bytes(uint32_t size);
extern "C" void vir_free_bytes(void * ptr);
extern "C" uint32_t vir_load_ir_package(uint8_t const * data, uint32_t size);
extern "C" char const * vir_last_package_error(void);
extern "C" uint32_t vir_last_package_error_size(void);
extern "C" char const * vir_package_interface_manifest(void);
extern "C" uint32_t vir_package_interface_manifest_size(void);
extern "C" uint32_t vir_package_decl_count(void);
extern "C" void vir_set_io_initializing(uint8_t value);
extern "C" uint8_t vir_get_io_initializing(void);
