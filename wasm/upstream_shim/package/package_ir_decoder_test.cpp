/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "package_decl_provider_types.h"
#include "package_ir_tags.h"
#include "package_section_directory.h"

#include <stdio.h>
#include <utility>

namespace {

namespace tags = lean::vir::package_ir_tags;

// Encode a small format-11 fixture independently of the native IR builders.
struct encoder {
    std::vector<uint8_t> data;

    void u8(uint8_t value) { data.push_back(value); }
    template <typename T> void tag(T value) { u8(static_cast<uint8_t>(value)); }
    void u32(uint32_t value) {
        for (unsigned shift = 0; shift < 32; shift += 8) u8(value >> shift);
    }
    void string(std::string const & value) {
        u32(value.size());
        data.insert(data.end(), value.begin(), value.end());
    }
    void name(char const * value) {
        tag(tags::name_tag::String);
        tag(tags::name_tag::Anonymous);
        string(value);
    }
    void param(uint32_t id) {
        u32(id);
        u8(0); // not borrowed
        tag(tags::ir_type_tag::Object);
    }
    void function(char const * label, bool has_param = true) {
        name(label);
        u8(0); // no boxed base
        tag(tags::decl_tag::Fun);
        u32(has_param ? 1 : 0);
        if (has_param) param(1);
        tag(tags::ir_type_tag::Object);
    }
    void variable(uint32_t id) { tag(tags::arg_tag::Var); u32(id); }
    void ret(uint32_t id) { tag(tags::body_tag::Ret); variable(id); }
    void jump(uint32_t id, bool has_arg) {
        tag(tags::body_tag::Jmp);
        u32(id);
        u32(has_arg ? 1 : 0);
        if (has_arg) variable(1);
    }
};

std::vector<uint8_t> frame_fixture() {
    using namespace lean::vir;
    encoder decls;
    decls.function("nested");
    // j3 () := case x1 of default => j7 (x19) := return x1; jump j7 x1
    //          jump j3
    // x19 is unused: the maximum must come from the nested parameter itself.
    decls.tag(tags::body_tag::JDecl); decls.u32(3); decls.u32(0);
    decls.tag(tags::body_tag::Case); decls.name("Object"); decls.u32(1);
    decls.tag(tags::ir_type_tag::Object); decls.u32(1);
    decls.tag(tags::alt_tag::Default);
    decls.tag(tags::body_tag::JDecl); decls.u32(7); decls.u32(1); decls.param(19);
    decls.ret(1);
    decls.jump(7, true);
    decls.jump(3, false);

    // A smaller nonzero frame must not inherit either maximum from nested.
    decls.function("smaller");
    decls.tag(tags::body_tag::JDecl); decls.u32(2); decls.u32(1); decls.param(3);
    decls.ret(3);
    decls.jump(2, true);

    decls.function("noJoins");
    decls.ret(1);
    decls.function("empty", false);
    decls.tag(tags::body_tag::Ret); decls.tag(tags::arg_tag::Erased);

    encoder empty_table;
    empty_table.u32(0);
    // The decoder only checks manifest presence/checksum, not its JSON schema.
    std::string manifest = "{}";
    uint64_t checksum = UINT64_C(14695981039346656037);
    for (unsigned char byte : manifest) {
        checksum = (checksum ^ byte) * UINT64_C(1099511628211);
    }
    encoder manifest_section;
    manifest_section.u32(static_cast<uint32_t>(checksum));
    manifest_section.u32(static_cast<uint32_t>(checksum >> 32));
    manifest_section.string(manifest);
    std::vector<std::pair<uint32_t, encoder>> sections = {
        {package_section_declarations, decls},
        {package_section_init_globals, empty_table},
        {package_section_host_imports, empty_table},
        {package_section_export_summaries, empty_table},
        {package_section_interface_manifest, manifest_section},
    };
    encoder package;
    package.string("lean-vir-ir-package");
    package.u32(11);
    package.u32(4);
    package.u32(sections.size());
    uint32_t offset = package.data.size() + sections.size() * 12;
    for (auto const & [kind, section] : sections) {
        package.u32(kind);
        package.u32(offset);
        package.u32(section.data.size());
        offset += section.data.size();
    }
    for (auto const & [kind, section] : sections) {
        package.data.insert(package.data.end(), section.data.begin(), section.data.end());
    }
    return package.data;
}

} // namespace

int main() {
    auto bytes = frame_fixture();
    lean::vir::decoded_ir_package package;
    std::string error;
    if (!lean::vir::decode_ir_package(bytes.data(), bytes.size(), package, error)) {
        fprintf(stderr, "frame fixture failed to decode: %s\n", error.c_str());
        return 1;
    }
    if (package.entries.size() != 4) {
        fprintf(stderr, "expected four decoded declarations, got %zu\n", package.entries.size());
        return 1;
    }
    size_t const expected[][2] = {{7, 19}, {2, 3}, {0, 1}, {0, 0}};
    for (size_t i = 0; i < package.entries.size(); ++i) {
        lean::object * info = lean_ctor_get(package.entries[i].decl, 4);
        size_t max_jp = lean_unbox(lean_ctor_get(info, 1));
        size_t max_var = lean_unbox(lean_ctor_get(info, 2));
        if (max_jp != expected[i][0] || max_var != expected[i][1]) {
            fprintf(stderr, "declaration %zu: expected frame (%zu, %zu), got (%zu, %zu)\n",
                i, expected[i][0], expected[i][1], max_jp, max_var);
            return 1;
        }
    }
    puts("package IR decoder nested parameters and per-declaration frame bounds ok");
    return 0;
}
