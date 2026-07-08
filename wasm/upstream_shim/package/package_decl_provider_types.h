/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stddef.h>
#include <stdint.h>

#include <string>
#include <vector>

#include "runtime/object.h"

namespace lean::vir {

struct decl_entry {
    object * name;
    object * boxed_base;
    object * decl;
};

struct init_global_entry {
    object * name;
    object * init_name;
};

struct host_import_entry {
    object * name;
    std::string target;
    std::string symbol;
    uint32_t arity;
    uint32_t erased_prefix_args;
    bool is_io;
};

struct export_call_summary_entry {
    object * name;
    bool is_io;
    uint32_t arg_count;
    bool needs_boxed_wasm32_boundary;
};

struct decoded_ir_package {
    std::vector<decl_entry> entries;
    std::vector<init_global_entry> init_entries;
    std::vector<host_import_entry> host_imports;
    std::vector<export_call_summary_entry> export_summaries;
    std::vector<uint32_t> call_summary_indices;
    std::string interface_manifest;
    uint32_t format_version = 0;
};

bool decode_ir_package(uint8_t const * data, size_t size, decoded_ir_package & out, std::string & error);

}
