/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "package_section_directory.h"

#include <string>

namespace lean::vir {
namespace {

static bool find_required_section(
    std::vector<package_section_span> const & sections,
    uint32_t kind,
    package_section_span & out,
    std::string & error) {
    bool found = false;
    for (package_section_span const & section : sections) {
        if (section.kind != kind) {
            continue;
        }
        if (found) {
            error = std::string("duplicate IR package section `") + package_section_label(kind) + "`";
            return false;
        }
        out = section;
        found = true;
    }
    if (!found) {
        error = std::string("missing IR package section `") + package_section_label(kind) + "`";
        return false;
    }
    return true;
}

} // namespace

char const * package_section_label(uint32_t kind) {
    switch (kind) {
    case package_section_declarations: return "declarations";
    case package_section_init_globals: return "init globals";
    case package_section_host_imports: return "host imports";
    case package_section_export_summaries: return "export summaries";
    case package_section_interface_manifest: return "interface manifest";
    default: return "unknown";
    }
}

bool read_package_section_directory(
    package_binary_reader & r,
    size_t package_size,
    package_section_directory & out,
    std::string & error) {
    out = package_section_directory{};
    uint32_t count = r.u32();
    if (!r.ok) {
        error = r.error();
        return false;
    }
    out.sections.reserve(count);
    for (uint32_t i = 0; i < count; i++) {
        uint32_t kind = r.u32();
        uint32_t offset = r.u32();
        uint32_t byte_length = r.u32();
        if (!r.ok) {
            error = r.error();
            return false;
        }
        if (offset > package_size || byte_length > package_size - offset) {
            error = "section " + std::to_string(kind) + " exceeds package byte length";
            return false;
        }
        out.sections.push_back({ kind, offset, byte_length });
    }

    return
        find_required_section(out.sections, package_section_declarations, out.declarations, error) &&
        find_required_section(out.sections, package_section_init_globals, out.init_globals, error) &&
        find_required_section(out.sections, package_section_host_imports, out.host_imports, error) &&
        find_required_section(out.sections, package_section_export_summaries, out.export_summaries, error) &&
        find_required_section(out.sections, package_section_interface_manifest, out.interface_manifest, error);
}

} // namespace lean::vir
