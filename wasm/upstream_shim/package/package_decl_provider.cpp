/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"
#include "host_import_limits.h"
#include "interpreter/interpreter_bridge.h"
#include "package_binary_reader.h"
#include "package_decl_provider_types.h"
#include "runtime/name_identity.h"
#include "runtime/io_error.h"

#include <stddef.h>
#include <stdint.h>

#include <memory>
#include <string>
#include <utility>
#include <unordered_set>
#include <vector>

#include "util/name.h"
#include "util/name_hash_map.h"

namespace lean::vir {
namespace {

enum class package_phase { idle, appending, prepared, initializing, ready, failed };

struct package_state {
    // Reuse the decoder's owned records and cleanup for the aggregate package.
    decoded_ir_package records;
    std::unique_ptr<name_hash_map<uint32_t>> decl_index;
    std::unique_ptr<name_hash_map<uint32_t>> boxed_decl_index;
    // One declaration index per public export; slots are 1-based indices here.
    std::vector<uint32_t> call_decl_indices;
    package_phase phase = package_phase::idle;
    size_t member_count = 0;
    std::string last_error;

    void clear() {
        // Retire cached declarations and evaluated nullary values before their
        // owning package records. Preserve the diagnostic across rollback.
        reset_package_interpreter();
        clear_package_interpreter_globals();
        decl_index.reset();
        boxed_decl_index.reset();
        call_decl_indices.clear();
        records.clear();
        member_count = 0;
        phase = package_phase::idle;
    }
};

static package_state g_package;

static std::string lean_name_string(object * value) {
    name n(value, true);
    return n.to_string();
}

static bool build_decl_indices() {
    g_package.decl_index = std::make_unique<name_hash_map<uint32_t>>();
    g_package.boxed_decl_index = std::make_unique<name_hash_map<uint32_t>>();
    g_package.decl_index->reserve(g_package.records.entries.size());
    g_package.boxed_decl_index->reserve(g_package.records.entries.size());

    for (size_t i = 0; i < g_package.records.entries.size(); i++) {
        decl_entry const & entry = g_package.records.entries[i];
        uint32_t index = static_cast<uint32_t>(i);
        if (!g_package.decl_index->emplace(name(entry.name, true), index).second) {
            g_package.last_error = "duplicate IR declaration `" + lean_name_string(entry.name) +
                "` while building package index";
            return false;
        }
        if (entry.boxed_base != nullptr &&
            !g_package.boxed_decl_index->emplace(name(entry.boxed_base, true), index).second) {
            g_package.last_error = "duplicate boxed IR declaration base `" +
                lean_name_string(entry.boxed_base) + "` while building package index";
            return false;
        }
    }
    return true;
}

static decl_entry const * find_indexed_decl(
    name_hash_map<uint32_t> const * index,
    object * n) {
    if (index == nullptr) return nullptr;
    auto found = index->find(name(n, true));
    if (found == index->end() || found->second >= g_package.records.entries.size()) {
        return nullptr;
    }
    return &g_package.records.entries[found->second];
}

static bool build_call_table() {
    std::vector<uint32_t> indices;
    indices.reserve(g_package.records.export_summaries.size());
    for (export_call_summary_entry const & summary : g_package.records.export_summaries) {
        decl_entry const * entry = find_indexed_decl(g_package.boxed_decl_index.get(), summary.name);
        if (entry == nullptr) {
            entry = find_indexed_decl(g_package.decl_index.get(), summary.name);
            if (entry == nullptr || entry->boxed_base != nullptr) {
                g_package.last_error = "interface export `" + lean_name_string(summary.name) +
                    "` has no IR declaration";
                return false;
            }
            if (summary.needs_boxed_wasm32_boundary) {
                g_package.last_error = "interface export `" + lean_name_string(summary.name) +
                    "` requires a boxed IR declaration";
                return false;
            }
        }
        indices.push_back(static_cast<uint32_t>(entry - g_package.records.entries.data()));
    }
    g_package.call_decl_indices = std::move(indices);
    return true;
}

static bool validate_host_import_limits() {
    if (g_package.records.host_imports.size() > max_host_import_slots) {
        g_package.last_error = "IR package set has " +
            std::to_string(g_package.records.host_imports.size()) +
            " JavaScript host imports; limit is " + std::to_string(max_host_import_slots);
        return false;
    }
    for (host_import_entry const & entry : g_package.records.host_imports) {
        if (entry.arity > max_host_import_arity) {
            g_package.last_error = "JavaScript host import `" + lean_name_string(entry.name) +
                "` has IR arity " + std::to_string(entry.arity) +
                "; limit is " + std::to_string(max_host_import_arity);
            return false;
        }
        uint32_t world_args = entry.is_io ? 1 : 0;
        if (entry.erased_prefix_args > entry.arity ||
            entry.arity - entry.erased_prefix_args < world_args) {
            g_package.last_error = "JavaScript host import `" + lean_name_string(entry.name) +
                "` has invalid erased-prefix/world argument counts";
            return false;
        }
        if (entry.arity == 0) {
            g_package.last_error = "nullary JavaScript host import `" + lean_name_string(entry.name) +
                "` is unsupported: native constants require storage; use an explicit Unit argument or RuntimeM result";
            return false;
        }
    }
    return true;
}

template <typename T>
static bool validate_named_entries(
    std::vector<T> const & existing,
    std::vector<T> const & decoded,
    char const * label) {
    name_hash_map<bool> names;
    names.reserve(existing.size() + decoded.size());
    for (T const & entry : existing) {
        names.emplace(name(entry.name, true), false);
    }
    for (T const & entry : decoded) {
        auto inserted = names.emplace(name(entry.name, true), true);
        if (!inserted.second) {
            g_package.last_error = std::string("duplicate ") + label + " `" +
                lean_name_string(entry.name) + "`" +
                (inserted.first->second ? " in one package-set member" :
                                          " across package-set members");
            return false;
        }
    }
    return true;
}

static bool validate_decoded_package(decoded_ir_package const & decoded) {
    if (g_package.member_count != 0 && decoded.format_version != g_package.records.format_version) {
        g_package.last_error =
            "IR package set mixes format versions " + std::to_string(g_package.records.format_version) +
            " and " + std::to_string(decoded.format_version);
        return false;
    }

    if (!validate_named_entries(g_package.records.entries, decoded.entries, "IR declaration") ||
        !validate_named_entries(g_package.records.init_entries, decoded.init_entries, "initializer global") ||
        !validate_named_entries(g_package.records.host_imports, decoded.host_imports, "JavaScript host import") ||
        !validate_named_entries(
            g_package.records.export_summaries, decoded.export_summaries, "interface export summary")) {
        return false;
    }

    std::unordered_set<std::string> symbols;
    for (host_import_entry const & entry : g_package.records.host_imports) {
        symbols.insert(entry.symbol);
    }
    for (host_import_entry const & entry : decoded.host_imports) {
        if (!symbols.insert(entry.symbol).second) {
            g_package.last_error = "duplicate JavaScript host import symbol `" + entry.symbol + "`";
            return false;
        }
    }
    return true;
}

template <typename T>
static void append_owned_entries(std::vector<T> & target, std::vector<T> & source) {
    target.reserve(target.size() + source.size());
    for (T & entry : source) {
        target.push_back(std::move(entry));
    }
    source.clear();
}

static bool append_decoded_package(decoded_ir_package & decoded) {
    if (!validate_decoded_package(decoded)) {
        return false;
    }

    append_owned_entries(g_package.records.entries, decoded.entries);
    append_owned_entries(g_package.records.init_entries, decoded.init_entries);
    append_owned_entries(g_package.records.host_imports, decoded.host_imports);
    append_owned_entries(g_package.records.export_summaries, decoded.export_summaries);
    g_package.records.interface_manifest = std::move(decoded.interface_manifest);
    ++g_package.member_count;
    g_package.records.format_version = decoded.format_version;
    return true;
}

static bool append_package_state(uint8_t const * data, size_t size) {
    g_package.last_error.clear();
    decoded_ir_package decoded;
    if (!decode_ir_package(data, size, decoded, g_package.last_error)) {
        return false;
    }
    return append_decoded_package(decoded);
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
    object * result = run_package_interpreter_initializer(entry.name, entry.init_name);
    if (lean_io_result_is_ok(result)) {
        lean_dec(result);
        return true;
    }

    name global_name(entry.name, true);
    name init_name(entry.init_name, true);
    std::string detail = io_result_error_message(result);
    g_package.last_error =
        "initializer failed for `" + global_name.to_string() +
        "` via `" + init_name.to_string() + "`";
    if (!detail.empty()) {
        g_package.last_error += ": ";
        g_package.last_error += detail;
    }
    lean_dec(result);
    return false;
}

static bool run_package_initializers_state() {
    if (g_package.records.init_entries.empty()) {
        return true;
    }

    ensure_ir_interpreter_initialized();
    scoped_io_initializing scope;
    for (init_global_entry const & entry : g_package.records.init_entries) {
        if (!run_init_global(entry)) {
            return false;
        }
    }
    return true;
}

static decl_entry const * package_entry_for_call_slot(uint32_t slot) {
    if (slot == 0 || slot > g_package.call_decl_indices.size()) {
        return nullptr;
    }
    return &g_package.records.entries[g_package.call_decl_indices[slot - 1]];
}

static object * package_entry_call_name(decl_entry const & entry) {
    return entry.boxed_base ? entry.boxed_base : entry.name;
}

static export_call_summary_entry const * package_call_summary_entry(uint32_t slot) {
    if (slot == 0 || slot > g_package.call_decl_indices.size()) {
        return nullptr;
    }
    return &g_package.records.export_summaries[slot - 1];
}

} // namespace

void clear_loaded_package() {
    if (g_package.phase == package_phase::initializing) {
        g_package.last_error = "IR package set is initializing";
        return;
    }
    g_package.clear();
}

bool begin_package_set() {
    if (g_package.phase == package_phase::initializing) {
        g_package.last_error = "IR package set is initializing";
        return false;
    }
    g_package.last_error.clear();
    g_package.clear();
    g_package.phase = package_phase::appending;
    return true;
}

bool append_package(uint8_t const * data, size_t size) {
    if (g_package.phase != package_phase::appending) {
        g_package.last_error = "IR package set is not open";
        return false;
    }
    return append_package_state(data, size);
}

bool prepare_package_set() {
    g_package.last_error.clear();
    if (g_package.phase != package_phase::appending) {
        g_package.last_error = "IR package set is not open";
        return false;
    }
    if (g_package.member_count == 0) {
        g_package.last_error = "IR package set contains no packages";
        return false;
    }
    g_package.phase = package_phase::failed;
    if (!validate_host_import_limits() || !build_decl_indices() || !build_call_table()) {
        return false;
    }
    g_package.phase = package_phase::prepared;
    return true;
}

bool finish_package_set() {
    g_package.last_error.clear();
    if (g_package.phase != package_phase::prepared) {
        g_package.last_error = "IR package set is not prepared";
        return false;
    }
    g_package.phase = package_phase::initializing;
    if (!run_package_initializers_state()) {
        g_package.clear();
        return false;
    }
    g_package.phase = package_phase::ready;
    g_package.last_error.clear();
    return true;
}

bool validate_package_contract(uint8_t const * data, size_t size) {
    g_package.last_error.clear();
    if (g_package.phase != package_phase::prepared && g_package.phase != package_phase::ready) {
        g_package.last_error = "IR package set is not prepared";
        return false;
    }
    if (data == nullptr && size != 0) {
        g_package.last_error = "IR package contract pointer is null";
        return false;
    }
    package_binary_reader r(data, size);
    auto matches = [&](bool equal, std::string const & field) {
        if (!r.ok) {
            g_package.last_error = "invalid IR package contract: " + r.error();
            return false;
        }
        if (!equal) {
            g_package.last_error = "IR package manifest/binary contract mismatch: " + field;
            return false;
        }
        return true;
    };

    uint32_t export_count = r.u32();
    if (!matches(export_count == g_package.records.export_summaries.size(), "export count")) {
        return false;
    }
    for (uint32_t i = 0; i < export_count; ++i) {
        export_call_summary_entry const & actual = g_package.records.export_summaries[i];
        std::string field = "export " + std::to_string(i) + " ";
        std::string entry = r.string();
        uint32_t arg_count = r.u32();
        bool is_io = r.boolean();
        bool boxed = r.boolean();
        if (!matches(entry == name_key(lean::name(actual.name, true)), field + "entry") ||
            !matches(arg_count == actual.arg_count, field + "argument count") ||
            !matches(is_io == actual.is_io, field + "effect") ||
            !matches(boxed == actual.needs_boxed_wasm32_boundary, field + "boxed boundary")) {
            return false;
        }
    }

    uint32_t host_count = r.u32();
    if (!matches(host_count == g_package.records.host_imports.size(), "host import count")) {
        return false;
    }
    for (uint32_t i = 0; i < host_count; ++i) {
        host_import_entry const & actual = g_package.records.host_imports[i];
        std::string field = "host import " + std::to_string(i) + " ";
        std::string name = r.string();
        std::string target = r.string();
        std::string symbol = r.string();
        uint32_t arity = r.u32();
        uint32_t erased_prefix_args = r.u32();
        bool is_io = r.boolean();
        if (!matches(name == name_key(lean::name(actual.name, true)), field + "name") ||
            !matches(target == actual.target, field + "target") ||
            !matches(symbol == actual.symbol, field + "symbol") ||
            !matches(arity == actual.arity, field + "arity") ||
            !matches(erased_prefix_args == actual.erased_prefix_args, field + "erased prefix arguments") ||
            !matches(is_io == actual.is_io, field + "effect")) {
            return false;
        }
    }
    if (!r.at_end()) {
        g_package.last_error = "invalid IR package contract: trailing bytes";
        return false;
    }
    return true;
}

object * find_package_decl(object * n) {
    decl_entry const * entry = find_indexed_decl(g_package.decl_index.get(), n);
    return entry == nullptr ? nullptr : entry->decl;
}

object * find_package_boxed_decl(object * n) {
    decl_entry const * entry = find_indexed_decl(g_package.boxed_decl_index.get(), n);
    return entry == nullptr ? nullptr : entry->decl;
}

object * find_package_init_name(object * n) {
    for (init_global_entry const & entry : g_package.records.init_entries) {
        if (lean_name_eq(n, entry.name)) {
            return entry.init_name;
        }
    }
    return nullptr;
}

uint32_t package_call_slot_for_export(uint32_t export_index) {
    if (export_index >= g_package.call_decl_indices.size()) {
        return 0;
    }
    return export_index + 1;
}

object * package_call_slot_name(uint32_t slot) {
    decl_entry const * entry = package_entry_for_call_slot(slot);
    if (entry == nullptr) {
        return nullptr;
    }
    return package_entry_call_name(*entry);
}

bool package_call_summary(uint32_t slot, package_call_runtime_summary & out) {
    export_call_summary_entry const * summary = package_call_summary_entry(slot);
    if (summary == nullptr) {
        return false;
    }
    out.arg_count = summary->arg_count;
    out.is_io = summary->is_io;
    return true;
}

char const * find_host_import_symbol(object * n) {
    for (host_import_entry const & entry : g_package.records.host_imports) {
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
    for (size_t i = 0; i < g_package.records.host_imports.size(); i++) {
        std::string boxed = g_package.records.host_imports[i].symbol + "___boxed";
        if (g_package.records.host_imports[i].symbol == symbol || boxed == symbol) {
            return static_cast<int32_t>(i);
        }
    }
    return -1;
}

uint32_t host_import_arity(uint32_t slot) {
    if (slot >= g_package.records.host_imports.size()) {
        return 0;
    }
    return g_package.records.host_imports[slot].arity;
}

uint32_t host_import_erased_prefix_args(uint32_t slot) {
    if (slot >= g_package.records.host_imports.size()) {
        return 0;
    }
    return g_package.records.host_imports[slot].erased_prefix_args;
}

bool host_import_is_io(uint32_t slot) {
    if (slot >= g_package.records.host_imports.size()) {
        return false;
    }
    return g_package.records.host_imports[slot].is_io;
}

uint32_t package_decl_count() {
    return g_package.records.entries.size();
}

bool package_ready() {
    return g_package.phase == package_phase::ready;
}

char const * last_package_error() {
    return g_package.last_error.c_str();
}

uint32_t last_package_error_size() {
    return static_cast<uint32_t>(g_package.last_error.size());
}

char const * package_interface_manifest() {
    return g_package.records.interface_manifest.c_str();
}

uint32_t package_interface_manifest_size() {
    return static_cast<uint32_t>(g_package.records.interface_manifest.size());
}

uint32_t package_format_version() {
    return g_package.records.format_version;
}

} // namespace lean::vir
