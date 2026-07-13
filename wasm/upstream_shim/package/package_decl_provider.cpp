/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"
#include "interpreter/interpreter_bridge.h"
#include "package_decl_provider_types.h"

#include <stddef.h>
#include <stdint.h>

#include <string>
#include <utility>
#include <vector>

#include "util/name.h"

extern "C" lean::object * lean_run_init(
    lean::object * env,
    lean::object * opts,
    lean::object * decl,
    lean::object * init_decl,
    lean::object * world);

namespace lean::vir {
namespace {

static std::vector<decl_entry> g_entries;
static std::vector<init_global_entry> g_init_entries;
static std::vector<host_import_entry> g_host_imports;
static std::vector<export_call_summary_entry> g_export_summaries;
static std::vector<uint32_t> g_call_summary_indices;
static std::string g_interface_manifest;
static std::string g_last_error;
static bool g_package_loaded = false;
static uint32_t g_package_generation = 1;
static uint32_t g_package_format_version = 0;

static void clear_loaded_package_state() {
    for (decl_entry const & entry : g_entries) {
        lean_dec(entry.name);
        if (entry.boxed_base) {
            lean_dec(entry.boxed_base);
        }
        lean_dec(entry.decl);
    }
    for (init_global_entry const & entry : g_init_entries) {
        lean_dec(entry.name);
        lean_dec(entry.init_name);
    }
    for (host_import_entry const & entry : g_host_imports) {
        lean_dec(entry.name);
    }
    for (export_call_summary_entry const & entry : g_export_summaries) {
        lean_dec(entry.name);
    }
    g_entries.clear();
    g_init_entries.clear();
    g_host_imports.clear();
    g_export_summaries.clear();
    g_call_summary_indices.clear();
    g_interface_manifest.clear();
    g_package_loaded = false;
    g_package_format_version = 0;
    g_package_generation++;
    if (g_package_generation == 0) {
        g_package_generation = 1;
    }
}

static bool load_package_state(uint8_t const * data, size_t size) {
    g_last_error.clear();
    clear_loaded_package_state();

    decoded_ir_package decoded;
    if (!decode_ir_package(data, size, decoded, g_last_error)) {
        return false;
    }

    g_entries = std::move(decoded.entries);
    g_init_entries = std::move(decoded.init_entries);
    g_host_imports = std::move(decoded.host_imports);
    g_export_summaries = std::move(decoded.export_summaries);
    g_call_summary_indices = std::move(decoded.call_summary_indices);
    g_interface_manifest = std::move(decoded.interface_manifest);
    g_package_loaded = true;
    g_package_format_version = decoded.format_version;
    return true;
}

class scoped_io_initializing {
    uint8_t m_old_value;

public:
    scoped_io_initializing():
        m_old_value(vir_get_io_initializing()) {
        vir_set_io_initializing(1);
    }

    ~scoped_io_initializing() {
        vir_set_io_initializing(m_old_value);
    }
};

static bool run_init_global(init_global_entry const & entry) {
    object * result = lean_run_init(lean_box(0), lean_box(0), entry.name, entry.init_name, lean_box(0));
    if (lean_io_result_is_ok(result)) {
        lean_dec(result);
        return true;
    }

    name global_name(entry.name, true);
    name init_name(entry.init_name, true);
    g_last_error =
        "initializer failed for `" + global_name.to_string() +
        "` via `" + init_name.to_string() + "`";
    lean_dec(result);
    return false;
}

static bool run_package_initializers_state() {
    if (g_init_entries.empty()) {
        return true;
    }

    ensure_ir_interpreter_initialized();
    scoped_io_initializing scope;
    for (init_global_entry const & entry : g_init_entries) {
        if (!run_init_global(entry)) {
            return false;
        }
    }
    return true;
}

static uint32_t package_call_slot_matching_export(uint32_t export_index, bool boxed_entry) {
    for (size_t i = 0; i < g_entries.size(); i++) {
        if ((g_entries[i].boxed_base != nullptr) != boxed_entry) {
            continue;
        }
        if (i < g_call_summary_indices.size() && g_call_summary_indices[i] == export_index) {
            return static_cast<uint32_t>(i + 1);
        }
    }
    return 0;
}

static decl_entry const * package_entry_for_call_slot(uint32_t slot) {
    if (slot == 0 || slot > g_entries.size()) {
        return nullptr;
    }
    return &g_entries[slot - 1];
}

static object * package_entry_call_name(decl_entry const & entry) {
    return entry.boxed_base ? entry.boxed_base : entry.name;
}

static export_call_summary_entry const * package_call_summary_entry(uint32_t slot) {
    if (slot == 0 || slot > g_call_summary_indices.size()) {
        return nullptr;
    }
    uint32_t summary_index = g_call_summary_indices[slot - 1];
    if (summary_index == UINT32_MAX || summary_index >= g_export_summaries.size()) {
        return nullptr;
    }
    return &g_export_summaries[summary_index];
}

} // namespace

void clear_loaded_package() {
    clear_loaded_package_state();
}

bool load_package(uint8_t const * data, size_t size) {
    return load_package_state(data, size);
}

bool run_package_initializers() {
    return run_package_initializers_state();
}

object * find_package_decl(object * n) {
    for (decl_entry const & entry : g_entries) {
        if (lean_name_eq(n, entry.name)) {
            return entry.decl;
        }
    }
    return nullptr;
}

object * find_package_boxed_decl(object * n) {
    for (decl_entry const & entry : g_entries) {
        if (entry.boxed_base && lean_name_eq(n, entry.boxed_base)) {
            return entry.decl;
        }
    }
    return nullptr;
}

object * find_package_init_name(object * n) {
    for (init_global_entry const & entry : g_init_entries) {
        if (lean_name_eq(n, entry.name)) {
            return entry.init_name;
        }
    }
    return nullptr;
}

uint32_t package_call_slot_for_export(uint32_t export_index) {
    if (export_index >= g_export_summaries.size()) {
        return 0;
    }
    uint32_t boxed_slot = package_call_slot_matching_export(export_index, true);
    return boxed_slot != 0 ? boxed_slot : package_call_slot_matching_export(export_index, false);
}

object * package_call_slot_name(uint32_t slot) {
    decl_entry const * entry = package_entry_for_call_slot(slot);
    if (entry == nullptr) {
        return nullptr;
    }
    return package_entry_call_name(*entry);
}

bool package_call_slot_has_boxed_decl(uint32_t slot) {
    decl_entry const * entry = package_entry_for_call_slot(slot);
    return entry != nullptr && entry->boxed_base != nullptr;
}

bool package_call_summary(uint32_t slot, package_call_runtime_summary & out) {
    export_call_summary_entry const * summary = package_call_summary_entry(slot);
    if (summary == nullptr) {
        return false;
    }
    out.arg_count = summary->arg_count;
    out.is_io = summary->is_io;
    out.needs_boxed_wasm32_boundary = summary->needs_boxed_wasm32_boundary;
    return true;
}

char const * find_host_import_symbol(object * n) {
    for (host_import_entry const & entry : g_host_imports) {
        if (lean_name_eq(n, entry.name)) {
            return entry.symbol.c_str();
        }
    }
    return nullptr;
}

int32_t host_import_slot_for_symbol(char const * symbol) {
    if (symbol == nullptr) {
        return -1;
    }
    for (size_t i = 0; i < g_host_imports.size(); i++) {
        std::string boxed = g_host_imports[i].symbol + "___boxed";
        if (g_host_imports[i].symbol == symbol || boxed == symbol) {
            return static_cast<int32_t>(i);
        }
    }
    return -1;
}

uint32_t host_import_arity(uint32_t slot) {
    if (slot >= g_host_imports.size()) {
        return 0;
    }
    return g_host_imports[slot].arity;
}

uint32_t host_import_erased_prefix_args(uint32_t slot) {
    if (slot >= g_host_imports.size()) {
        return 0;
    }
    return g_host_imports[slot].erased_prefix_args;
}

bool host_import_is_io(uint32_t slot) {
    if (slot >= g_host_imports.size()) {
        return false;
    }
    return g_host_imports[slot].is_io;
}

uint32_t package_decl_count() {
    return g_entries.size();
}

bool package_loaded() {
    return g_package_loaded;
}

uint32_t package_generation() {
    return g_package_generation;
}

uint32_t package_format_version() {
    return g_package_format_version;
}

char const * last_package_error() {
    return g_last_error.c_str();
}

uint32_t last_package_error_size() {
    return static_cast<uint32_t>(g_last_error.size());
}

char const * package_interface_manifest() {
    return g_interface_manifest.c_str();
}

uint32_t package_interface_manifest_size() {
    return static_cast<uint32_t>(g_interface_manifest.size());
}

} // namespace lean::vir
