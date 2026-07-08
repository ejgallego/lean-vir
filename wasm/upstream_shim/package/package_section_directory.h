/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include "package_binary_reader.h"

#include <stddef.h>
#include <stdint.h>

#include <string>
#include <vector>

namespace lean::vir {

enum package_section_kind : uint32_t {
    package_section_declarations = 1,
    package_section_init_globals = 2,
    package_section_host_imports = 3,
    package_section_export_summaries = 4,
    package_section_interface_manifest = 5,
};

struct package_section_span {
    uint32_t kind;
    size_t offset;
    size_t byte_length;
};

struct package_section_directory {
    std::vector<package_section_span> sections;
    package_section_span declarations{};
    package_section_span init_globals{};
    package_section_span host_imports{};
    package_section_span export_summaries{};
    package_section_span interface_manifest{};
};

char const * package_section_label(uint32_t kind);

bool read_package_section_directory(
    package_binary_reader & r,
    size_t package_size,
    package_section_directory & out,
    std::string & error);

} // namespace lean::vir
