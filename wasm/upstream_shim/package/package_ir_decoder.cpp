/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "package_decl_provider_types.h"
#include "package_binary_reader.h"
#include "package_ir_builders.h"
#include "package_ir_tags.h"
#include "package_section_directory.h"

#include <stddef.h>
#include <stdint.h>

#include <string>
#include <vector>

#include "library/ir_types.h"

namespace lean::vir {
namespace {

using ir::type;
using namespace package_ir;
namespace tags = package_ir_tags;

static bool supported_package_version(uint32_t version) {
    return version == 10;
}

class reader : public package_binary_reader {
public:
    using package_binary_reader::package_binary_reader;

    uint32_t bounded_count(char const * label, size_t min_item_bytes = 1) {
        uint32_t count = u32();
        if (!count_fits(count, label, min_item_bytes)) {
            return 0;
        }
        return count;
    }

    bool count_fits(uint32_t count, char const * label, size_t min_item_bytes = 1) {
        if (!ok) {
            return false;
        }
        if (min_item_bytes == 0 || count > remaining() / min_item_bytes) {
            fail(
                std::string(label) + " count " + std::to_string(count) +
                " exceeds remaining section bytes " + std::to_string(remaining()));
            return false;
        }
        return true;
    }

    object * ir_nat_literal() {
        std::string decimal = string();
        return lean_cstr_to_nat(decimal.c_str());
    }

    object * name() {
        uint8_t tag = u8();
        if (!ok) {
            return lean_box(0);
        }
        switch (static_cast<tags::name_tag>(tag)) {
        case tags::name_tag::Anonymous:
            return lean_box(0);
        case tags::name_tag::String: {
            object * prefix = name();
            std::string part = string();
            return mk_name_str(prefix, part);
        }
        case tags::name_tag::Numeral: {
            object * prefix = name();
            uint32_t part = u32();
            return mk_name_num(prefix, part);
        }
        }
        fail("unsupported name tag " + std::to_string(tag));
        return lean_box(0);
    }

    type ir_type() {
        uint8_t tag = u8();
        if (!ok) {
            return type::Void;
        }
        switch (static_cast<tags::ir_type_tag>(tag)) {
        case tags::ir_type_tag::Float: return type::Float;
        case tags::ir_type_tag::UInt8: return type::UInt8;
        case tags::ir_type_tag::UInt16: return type::UInt16;
        case tags::ir_type_tag::UInt32: return type::UInt32;
        case tags::ir_type_tag::UInt64: return type::UInt64;
        case tags::ir_type_tag::USize: return type::USize;
        case tags::ir_type_tag::Erased: return type::Irrelevant;
        case tags::ir_type_tag::Object: return type::Object;
        case tags::ir_type_tag::TObject: return type::TObject;
        case tags::ir_type_tag::Float32: return type::Float32;
        case tags::ir_type_tag::Tagged: return type::Tagged;
        case tags::ir_type_tag::Void: return type::Void;
        default:
            fail("unsupported IR type tag " + std::to_string(tag));
            return type::Void;
        }
    }

    object * ir_arg() {
        uint8_t tag = u8();
        if (!ok) {
            return mk_arg_erased();
        }
        switch (static_cast<tags::arg_tag>(tag)) {
        case tags::arg_tag::Var: {
            uint32_t var = u32();
            return mk_arg_var(var);
        }
        case tags::arg_tag::Erased:
            return mk_arg_erased();
        }
        fail("unsupported arg tag " + std::to_string(tag));
        return mk_arg_erased();
    }

    std::vector<object *> ir_args() {
        return object_array([&] { return ir_arg(); });
    }

    object * ir_lit_expr() {
        uint8_t tag = u8();
        if (!ok) {
            return mk_lit_num(static_cast<size_t>(0));
        }
        switch (static_cast<tags::literal_tag>(tag)) {
        case tags::literal_tag::Num:
            return mk_lit_num(ir_nat_literal());
        case tags::literal_tag::String:
            return mk_lit_str(string());
        }
        fail("unsupported literal tag " + std::to_string(tag));
        return mk_lit_num(static_cast<size_t>(0));
    }

    object * ir_ctor_info() {
        object * n = name();
        uint32_t cidx = u32();
        uint32_t size = u32();
        uint32_t usize = u32();
        uint32_t ssize = u32();
        return mk_ctor_info(n, cidx, size, usize, ssize);
    }

    object * ir_expr() {
        uint8_t tag = u8();
        if (!ok) {
            return mk_lit_num(static_cast<size_t>(0));
        }
        switch (static_cast<tags::expr_tag>(tag)) {
        case tags::expr_tag::Ctor: {
            object * info = ir_ctor_info();
            object * ctor_args = mk_array(ir_args());
            return mk_ctor_expr(info, ctor_args);
        }
        case tags::expr_tag::Reset: {
            uint32_t n = u32();
            uint32_t var = u32();
            return mk_reset(n, var);
        }
        case tags::expr_tag::Reuse: {
            uint32_t var = u32();
            object * info = ir_ctor_info();
            bool update_header = boolean();
            object * ctor_args = mk_array(ir_args());
            return mk_reuse(var, info, update_header, ctor_args);
        }
        case tags::expr_tag::Proj: {
            uint32_t idx = u32();
            uint32_t var = u32();
            return mk_proj(idx, var);
        }
        case tags::expr_tag::UProj: {
            uint32_t idx = u32();
            uint32_t var = u32();
            return mk_uproj(idx, var);
        }
        case tags::expr_tag::SProj: {
            uint32_t idx = u32();
            uint32_t offset = u32();
            uint32_t var = u32();
            return mk_sproj(idx, offset, var);
        }
        case tags::expr_tag::Fap: {
            object * fn = name();
            object * fn_args = mk_array(ir_args());
            return mk_fap(fn, fn_args);
        }
        case tags::expr_tag::Pap: {
            object * fn = name();
            object * fn_args = mk_array(ir_args());
            return mk_pap(fn, fn_args);
        }
        case tags::expr_tag::Ap: {
            uint32_t var = u32();
            object * fn_args = mk_array(ir_args());
            return mk_ap(var, fn_args);
        }
        case tags::expr_tag::Box: {
            type t = ir_type();
            uint32_t var = u32();
            return mk_box(t, var);
        }
        case tags::expr_tag::Unbox: {
            uint32_t var = u32();
            return mk_unbox(var);
        }
        case tags::expr_tag::Lit:
            return ir_lit_expr();
        case tags::expr_tag::IsShared: {
            uint32_t var = u32();
            return mk_is_shared(var);
        }
        default:
            fail("unsupported expression tag " + std::to_string(tag));
            return mk_lit_num(static_cast<size_t>(0));
        }
    }

    object * ir_param() {
        uint32_t var = u32();
        bool borrow = boolean();
        type t = ir_type();
        return mk_param(var, t, borrow);
    }

    std::vector<object *> ir_params() {
        return object_array([&] { return ir_param(); });
    }

    object * ir_alt() {
        uint8_t tag = u8();
        if (!ok) {
            return mk_default_alt(mk_unreachable());
        }
        switch (static_cast<tags::alt_tag>(tag)) {
        case tags::alt_tag::Ctor: {
            object * info = ir_ctor_info();
            object * alt_body = ir_body();
            return mk_ctor_alt(info, alt_body);
        }
        case tags::alt_tag::Default: {
            object * alt_body = ir_body();
            return mk_default_alt(alt_body);
        }
        }
        fail("unsupported alternative tag " + std::to_string(tag));
        return mk_default_alt(mk_unreachable());
    }

    std::vector<object *> ir_alts() {
        return object_array([&] { return ir_alt(); });
    }

    object * ir_body() {
        uint8_t tag = u8();
        if (!ok) {
            return mk_unreachable();
        }
        switch (static_cast<tags::body_tag>(tag)) {
        case tags::body_tag::VDecl: {
            uint32_t var = u32();
            type t = ir_type();
            object * value = ir_expr();
            object * cont = ir_body();
            return mk_vdecl(var, t, value, cont);
        }
        case tags::body_tag::JDecl: {
            uint32_t jp = u32();
            object * ps = mk_array(ir_params());
            object * value = ir_body();
            object * cont = ir_body();
            return mk_jdecl(jp, ps, value, cont);
        }
        case tags::body_tag::Set: {
            uint32_t var = u32();
            uint32_t idx = u32();
            object * value = ir_arg();
            object * cont = ir_body();
            return mk_set(var, idx, value, cont);
        }
        case tags::body_tag::SetTag: {
            uint32_t var = u32();
            uint32_t cidx = u32();
            object * cont = ir_body();
            return mk_set_tag(var, cidx, cont);
        }
        case tags::body_tag::USet: {
            uint32_t target = u32();
            uint32_t idx = u32();
            uint32_t source = u32();
            object * cont = ir_body();
            return mk_uset(target, idx, source, cont);
        }
        case tags::body_tag::SSet: {
            uint32_t target = u32();
            uint32_t idx = u32();
            uint32_t offset = u32();
            uint32_t source = u32();
            type t = ir_type();
            object * cont = ir_body();
            return mk_sset(target, idx, offset, source, t, cont);
        }
        case tags::body_tag::Inc: {
            uint32_t var = u32();
            uint32_t amount = u32();
            bool maybe_scalar = boolean();
            bool persistent = boolean();
            object * cont = ir_body();
            return mk_inc(var, amount, maybe_scalar, persistent, cont);
        }
        case tags::body_tag::Dec: {
            uint32_t var = u32();
            uint32_t amount = u32();
            bool maybe_scalar = boolean();
            bool persistent = boolean();
            object * cont = ir_body();
            return mk_dec(var, amount, maybe_scalar, persistent, cont);
        }
        case tags::body_tag::Del: {
            uint32_t var = u32();
            object * cont = ir_body();
            return mk_del(var, cont);
        }
        case tags::body_tag::Case: {
            object * tid = name();
            uint32_t var = u32();
            type t = ir_type();
            object * case_alts = mk_array(ir_alts());
            return mk_case(tid, var, t, case_alts);
        }
        case tags::body_tag::Ret: {
            object * value = ir_arg();
            return mk_ret(value);
        }
        case tags::body_tag::Jmp: {
            uint32_t jp = u32();
            object * jmp_args = mk_array(ir_args());
            return mk_jmp(jp, jmp_args);
        }
        case tags::body_tag::Unreachable:
            return mk_unreachable();
        default:
            fail("unsupported function body tag " + std::to_string(tag));
            return mk_unreachable();
        }
    }

    object * ir_decl(object * fn) {
        uint8_t tag = u8();
        object * ps = mk_array(ir_params());
        type result_type = ir_type();
        switch (static_cast<tags::decl_tag>(tag)) {
        case tags::decl_tag::Fun: {
            object * fn_body = ir_body();
            return mk_fun_decl(fn, ps, result_type, fn_body);
        }
        case tags::decl_tag::Extern:
            return mk_extern_decl(fn, ps, result_type);
        }
        fail("unsupported declaration tag " + std::to_string(tag));
        return mk_extern_decl(fn, ps, result_type);
    }

    host_import_entry host_import() {
        object * n = name();
        std::string target = string();
        std::string symbol = string();
        uint32_t arity = u32();
        uint32_t erased_prefix_args = u32();
        bool is_io = boolean();
        return { n, target, symbol, arity, erased_prefix_args, is_io };
    }

    export_call_summary_entry export_summary() {
        object * n = name();
        bool is_io = boolean();
        uint32_t arg_count = u32();
        bool needs_boxed_wasm32_boundary = boolean();
        return { n, is_io, arg_count, needs_boxed_wasm32_boundary };
    }

private:
    template <typename F>
    std::vector<object *> object_array(F read_one) {
        uint32_t count = bounded_count("IR object array");
        std::vector<object *> out;
        out.reserve(count);
        for (uint32_t i = 0; i < count && ok; i++) {
            out.push_back(read_one());
        }
        return out;
    }
};

static std::vector<decl_entry> read_ir_decl_entries(reader & r, uint32_t count) {
    std::vector<decl_entry> entries;
    if (!r.count_fits(count, "declaration")) {
        return entries;
    }
    entries.reserve(count);
    for (uint32_t i = 0; i < count && r.ok; i++) {
        object * n = r.name();
        object * boxed_base = r.boolean() ? r.name() : nullptr;
        lean_inc(n);
        object * d = r.ir_decl(n);
        entries.push_back({ n, boxed_base, d });
    }
    return entries;
}

static std::vector<init_global_entry> read_init_entries(reader & r) {
    uint32_t count = r.bounded_count("initializer entry", 2);
    std::vector<init_global_entry> entries;
    entries.reserve(count);
    for (uint32_t i = 0; i < count && r.ok; i++) {
        object * n = r.name();
        object * init_name = r.name();
        entries.push_back({ n, init_name });
    }
    return entries;
}

static std::vector<host_import_entry> read_host_imports(reader & r) {
    uint32_t count = r.bounded_count("host import entry");
    std::vector<host_import_entry> entries;
    entries.reserve(count);
    for (uint32_t i = 0; i < count && r.ok; i++) {
        entries.push_back(r.host_import());
    }
    return entries;
}

static std::vector<export_call_summary_entry> read_export_summaries(reader & r) {
    uint32_t count = r.bounded_count("export summary entry");
    std::vector<export_call_summary_entry> entries;
    entries.reserve(count);
    for (uint32_t i = 0; i < count && r.ok; i++) {
        entries.push_back(r.export_summary());
    }
    return entries;
}

static bool finish_section(reader const & r, char const * label, std::string & error) {
    if (!r.ok) {
        error = std::string("invalid IR package section `") + label + "`: " + r.error();
        return false;
    }
    if (!r.at_end()) {
        error = std::string("trailing bytes in IR package section `") + label + "` at byte " + std::to_string(r.pos());
        return false;
    }
    return true;
}

static std::vector<uint32_t> build_call_summary_indices(
    std::vector<decl_entry> const & entries,
    std::vector<export_call_summary_entry> const & export_summaries) {
    std::vector<uint32_t> indices(entries.size(), UINT32_MAX);
    for (size_t i = 0; i < entries.size(); i++) {
        object * call_name = entries[i].boxed_base ? entries[i].boxed_base : entries[i].name;
        for (size_t j = 0; j < export_summaries.size(); j++) {
            if (lean_name_eq(call_name, export_summaries[j].name)) {
                indices[i] = static_cast<uint32_t>(j);
                break;
            }
        }
    }
    return indices;
}

} // namespace

decoded_ir_package::~decoded_ir_package() {
    clear();
}

void decoded_ir_package::clear() {
    for (decl_entry const & entry : entries) {
        lean_dec(entry.name);
        if (entry.boxed_base != nullptr) {
            lean_dec(entry.boxed_base);
        }
        lean_dec(entry.decl);
    }
    for (init_global_entry const & entry : init_entries) {
        lean_dec(entry.name);
        lean_dec(entry.init_name);
    }
    for (host_import_entry const & entry : host_imports) {
        lean_dec(entry.name);
    }
    for (export_call_summary_entry const & entry : export_summaries) {
        lean_dec(entry.name);
    }
    entries.clear();
    init_entries.clear();
    host_imports.clear();
    export_summaries.clear();
    call_summary_indices.clear();
    interface_manifest.clear();
    format_version = 0;
}

bool decode_ir_package(uint8_t const * data, size_t size, decoded_ir_package & out, std::string & error) {
    error.clear();
    out.clear();
    if (data == nullptr && size != 0) {
        error = "IR package pointer is null";
        return false;
    }

    reader r(data, size);
    std::string magic = r.string();
    uint32_t version = r.u32();
    uint32_t count = r.u32();
    if (!r.ok) {
        error = r.error();
        return false;
    }
    if (magic != "lean-vir-ir-package") {
        error = "invalid IR package magic `" + magic + "`";
        return false;
    }
    if (!supported_package_version(version)) {
        error = "unsupported IR package version " + std::to_string(version);
        return false;
    }

    package_section_directory directory;
    if (!read_package_section_directory(r, size, directory, error)) {
        return false;
    }

    reader decls_reader(data + directory.declarations.offset, directory.declarations.byte_length);
    out.entries = read_ir_decl_entries(decls_reader, count);
    if (!finish_section(decls_reader, package_section_label(package_section_declarations), error)) {
        return false;
    }

    reader init_reader(data + directory.init_globals.offset, directory.init_globals.byte_length);
    out.init_entries = read_init_entries(init_reader);
    if (!finish_section(init_reader, package_section_label(package_section_init_globals), error)) {
        return false;
    }

    reader host_import_reader(data + directory.host_imports.offset, directory.host_imports.byte_length);
    out.host_imports = read_host_imports(host_import_reader);
    if (!finish_section(host_import_reader, package_section_label(package_section_host_imports), error)) {
        return false;
    }

    reader export_summary_reader(data + directory.export_summaries.offset, directory.export_summaries.byte_length);
    out.export_summaries = read_export_summaries(export_summary_reader);
    if (!finish_section(export_summary_reader, package_section_label(package_section_export_summaries), error)) {
        return false;
    }

    reader manifest_reader(data + directory.interface_manifest.offset, directory.interface_manifest.byte_length);
    out.interface_manifest = manifest_reader.string();
    if (out.interface_manifest.empty()) {
        error = "IR package is missing an embedded interface manifest";
        return false;
    }
    if (!finish_section(manifest_reader, package_section_label(package_section_interface_manifest), error)) {
        return false;
    }

    out.call_summary_indices = build_call_summary_indices(out.entries, out.export_summaries);
    out.format_version = version;
    return true;
}

} // namespace lean::vir
