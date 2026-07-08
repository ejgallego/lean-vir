/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "package_decl_provider_types.h"
#include "package_binary_reader.h"

#include <stddef.h>
#include <stdint.h>

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

#include "library/ir_types.h"

namespace lean {
extern "C" obj_res lean_name_mk_string(obj_arg prefix, obj_arg suffix);
extern "C" obj_res lean_name_mk_numeral(obj_arg prefix, obj_arg suffix);
}

namespace lean::vir {
namespace {

using ir::type;

static bool supported_package_version(uint32_t version) {
    return version == 9;
}

static object * mk_ctor(unsigned tag, std::initializer_list<object *> fields, unsigned scalar_size = 0) {
    object * obj = lean_alloc_ctor(tag, fields.size(), scalar_size);
    unsigned idx = 0;
    for (object * field : fields) {
        lean_inc(field);
        lean_ctor_set(obj, idx, field);
        idx++;
    }
    return obj;
}

static object * mk_nat(size_t n) {
    return lean_usize_to_nat(n);
}

static object * mk_name_str(object * prefix, std::string const & part) {
    object * suffix = lean_mk_string(part.c_str());
    object * result = lean_name_mk_string(prefix, suffix);
    lean_dec(prefix);
    lean_dec(suffix);
    return result;
}

static object * mk_name_num(object * prefix, size_t value) {
    object * suffix = mk_nat(value);
    object * result = lean_name_mk_numeral(prefix, suffix);
    lean_dec(prefix);
    lean_dec(suffix);
    return result;
}

static object * mk_array(std::vector<object *> const & fields) {
    object * array = lean_alloc_array(fields.size(), fields.size());
    size_t idx = 0;
    for (object * field : fields) {
        lean_inc(field);
        lean_array_set_core(array, idx, field);
        idx++;
    }
    return array;
}

static object * mk_arg_var(size_t var) {
    return mk_ctor(0, { mk_nat(var) });
}

static object * mk_arg_erased() {
    return lean_box(1);
}

static object * mk_lit_num(object * value) {
    object * lit_val = mk_ctor(0, { value });
    lean_dec(value);
    object * expr = mk_ctor(11, { lit_val });
    lean_dec(lit_val);
    return expr;
}

static object * mk_lit_num(size_t value) {
    return mk_lit_num(mk_nat(value));
}

static object * mk_lit_str(std::string const & value) {
    object * str = lean_mk_string(value.c_str());
    object * lit_val = mk_ctor(1, { str });
    lean_dec(str);
    object * expr = mk_ctor(11, { lit_val });
    lean_dec(lit_val);
    return expr;
}

static object * mk_ctor_info(object * n, size_t tag, size_t size = 0, size_t usize = 0, size_t ssize = 0) {
    return mk_ctor(0, { n, mk_nat(tag), mk_nat(size), mk_nat(usize), mk_nat(ssize) });
}

static object * mk_ctor_expr(object * ctor_info, object * args) {
    return mk_ctor(0, { ctor_info, args });
}

static object * mk_reset(size_t n, size_t var) {
    return mk_ctor(1, { mk_nat(n), mk_nat(var) });
}

static object * mk_reuse(size_t var, object * ctor_info, bool update_header, object * args) {
    object * obj = mk_ctor(2, { mk_nat(var), ctor_info, args }, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 3 * sizeof(void *), update_header ? 1 : 0);
    return obj;
}

static object * mk_proj(size_t idx, size_t var) {
    return mk_ctor(3, { mk_nat(idx), mk_nat(var) });
}

static object * mk_uproj(size_t idx, size_t var) {
    return mk_ctor(4, { mk_nat(idx), mk_nat(var) });
}

static object * mk_sproj(size_t idx, size_t offset, size_t var) {
    return mk_ctor(5, { mk_nat(idx), mk_nat(offset), mk_nat(var) });
}

static object * mk_fap(object * fn, object * args) {
    return mk_ctor(6, { fn, args });
}

static object * mk_pap(object * fn, object * args) {
    return mk_ctor(7, { fn, args });
}

static object * mk_ap(size_t var, object * args) {
    return mk_ctor(8, { mk_nat(var), args });
}

static object * mk_box(type t, size_t var) {
    return mk_ctor(9, { lean_box(static_cast<unsigned>(t)), mk_nat(var) });
}

static object * mk_unbox(size_t var) {
    return mk_ctor(10, { mk_nat(var) });
}

static object * mk_is_shared(size_t var) {
    return mk_ctor(12, { mk_nat(var) });
}

static object * mk_param(size_t var, type t, bool borrow) {
    object * obj = mk_ctor(0, { mk_nat(var), lean_box(static_cast<unsigned>(t)) }, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 2 * sizeof(void *), borrow ? 1 : 0);
    return obj;
}

static object * mk_ctor_alt(object * ctor_info, object * body) {
    return mk_ctor(0, { ctor_info, body });
}

static object * mk_default_alt(object * body) {
    return mk_ctor(1, { body });
}

static object * mk_vdecl(size_t var, type var_type, object * expr, object * cont) {
    return mk_ctor(0, { mk_nat(var), lean_box(static_cast<unsigned>(var_type)), expr, cont });
}

static object * mk_jdecl(size_t jp, object * params, object * body, object * cont) {
    return mk_ctor(1, { mk_nat(jp), params, body, cont });
}

static object * mk_set(size_t target, size_t idx, object * arg, object * cont) {
    return mk_ctor(2, { mk_nat(target), mk_nat(idx), arg, cont });
}

static object * mk_set_tag(size_t target, size_t tag, object * cont) {
    return mk_ctor(3, { mk_nat(target), mk_nat(tag), cont });
}

static object * mk_uset(size_t target, size_t idx, size_t source, object * cont) {
    return mk_ctor(4, { mk_nat(target), mk_nat(idx), mk_nat(source), cont });
}

static object * mk_sset(size_t target, size_t idx, size_t offset, size_t source, type t, object * cont) {
    return mk_ctor(5, { mk_nat(target), mk_nat(idx), mk_nat(offset), mk_nat(source), lean_box(static_cast<unsigned>(t)), cont });
}

static object * mk_inc(size_t var, size_t amount, bool maybe_scalar, object * cont) {
    object * obj = mk_ctor(6, { mk_nat(var), mk_nat(amount), cont }, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 3 * sizeof(void *), maybe_scalar ? 1 : 0);
    return obj;
}

static object * mk_dec(size_t var, size_t amount, bool maybe_scalar, object * cont) {
    object * obj = mk_ctor(7, { mk_nat(var), mk_nat(amount), cont }, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 3 * sizeof(void *), maybe_scalar ? 1 : 0);
    return obj;
}

static object * mk_del(size_t var, object * cont) {
    return mk_ctor(8, { mk_nat(var), cont });
}

static object * mk_case(object * type_name, size_t var, type var_type, object * alts) {
    return mk_ctor(9, { type_name, mk_nat(var), lean_box(static_cast<unsigned>(var_type)), alts });
}

static object * mk_ret(object * arg) {
    return mk_ctor(10, { arg });
}

static object * mk_jmp(size_t jp, object * args) {
    return mk_ctor(11, { mk_nat(jp), args });
}

static object * mk_unreachable() {
    return lean_box(12);
}

static object * mk_fun_decl(object * fn, object * params, type result_type, object * body) {
    return mk_ctor(0, { fn, params, lean_box(static_cast<unsigned>(result_type)), body });
}

static object * mk_extern_decl(object * fn, object * params, type result_type) {
    return mk_ctor(1, { fn, params, lean_box(static_cast<unsigned>(result_type)), lean_box(0) });
}

class reader : public package_binary_reader {
public:
    using package_binary_reader::package_binary_reader;

    object * nat() {
        std::string decimal = string();
        return lean_cstr_to_nat(decimal.c_str());
    }

    object * name() {
        uint8_t tag = u8();
        if (tag == 0) {
            return lean_box(0);
        }
        if (tag == 1) {
            object * prefix = name();
            std::string part = string();
            return mk_name_str(prefix, part);
        }
        if (tag == 2) {
            object * prefix = name();
            return mk_name_num(prefix, u32());
        }
        fail("unsupported name tag " + std::to_string(tag));
        return lean_box(0);
    }

    type ir_type() {
        uint8_t tag = u8();
        switch (tag) {
        case 0: return type::Float;
        case 1: return type::UInt8;
        case 2: return type::UInt16;
        case 3: return type::UInt32;
        case 4: return type::UInt64;
        case 5: return type::USize;
        case 6: return type::Irrelevant;
        case 7: return type::Object;
        case 8: return type::TObject;
        case 9: return type::Float32;
        case 12: return type::Tagged;
        case 13: return type::Void;
        default:
            fail("unsupported IR type tag " + std::to_string(tag));
            return type::Void;
        }
    }

    object * arg() {
        uint8_t tag = u8();
        if (tag == 0) {
            return mk_arg_var(u32());
        }
        if (tag == 1) {
            return mk_arg_erased();
        }
        fail("unsupported arg tag " + std::to_string(tag));
        return mk_arg_erased();
    }

    std::vector<object *> args() {
        return object_array([&] { return arg(); });
    }

    object * lit() {
        uint8_t tag = u8();
        if (tag == 0) {
            return mk_lit_num(nat());
        }
        if (tag == 1) {
            return mk_lit_str(string());
        }
        fail("unsupported literal tag " + std::to_string(tag));
        return mk_lit_num(static_cast<size_t>(0));
    }

    object * ctor_info() {
        object * n = name();
        uint32_t cidx = u32();
        uint32_t size = u32();
        uint32_t usize = u32();
        uint32_t ssize = u32();
        return mk_ctor_info(n, cidx, size, usize, ssize);
    }

    object * expr() {
        uint8_t tag = u8();
        switch (tag) {
        case 0:
            return mk_ctor_expr(ctor_info(), mk_array(args()));
        case 1: {
            uint32_t n = u32();
            uint32_t var = u32();
            return mk_reset(n, var);
        }
        case 2: {
            uint32_t var = u32();
            object * info = ctor_info();
            bool update_header = boolean();
            return mk_reuse(var, info, update_header, mk_array(args()));
        }
        case 3: {
            uint32_t idx = u32();
            return mk_proj(idx, u32());
        }
        case 4: {
            uint32_t idx = u32();
            return mk_uproj(idx, u32());
        }
        case 5: {
            uint32_t idx = u32();
            uint32_t offset = u32();
            return mk_sproj(idx, offset, u32());
        }
        case 6:
            return mk_fap(name(), mk_array(args()));
        case 7:
            return mk_pap(name(), mk_array(args()));
        case 8: {
            uint32_t var = u32();
            return mk_ap(var, mk_array(args()));
        }
        case 9: {
            type t = ir_type();
            return mk_box(t, u32());
        }
        case 10:
            return mk_unbox(u32());
        case 11:
            return lit();
        case 12:
            return mk_is_shared(u32());
        default:
            fail("unsupported expression tag " + std::to_string(tag));
            return mk_lit_num(static_cast<size_t>(0));
        }
    }

    object * param() {
        uint32_t var = u32();
        bool borrow = boolean();
        type t = ir_type();
        return mk_param(var, t, borrow);
    }

    std::vector<object *> params() {
        return object_array([&] { return param(); });
    }

    object * alt() {
        uint8_t tag = u8();
        if (tag == 0) {
            return mk_ctor_alt(ctor_info(), body());
        }
        if (tag == 1) {
            return mk_default_alt(body());
        }
        fail("unsupported alternative tag " + std::to_string(tag));
        return mk_default_alt(mk_unreachable());
    }

    std::vector<object *> alts() {
        return object_array([&] { return alt(); });
    }

    object * body() {
        uint8_t tag = u8();
        switch (tag) {
        case 0: {
            uint32_t var = u32();
            type t = ir_type();
            object * value = expr();
            return mk_vdecl(var, t, value, body());
        }
        case 1: {
            uint32_t jp = u32();
            object * ps = mk_array(params());
            object * value = body();
            return mk_jdecl(jp, ps, value, body());
        }
        case 2: {
            uint32_t var = u32();
            uint32_t idx = u32();
            object * value = arg();
            return mk_set(var, idx, value, body());
        }
        case 3: {
            uint32_t var = u32();
            uint32_t cidx = u32();
            return mk_set_tag(var, cidx, body());
        }
        case 4: {
            uint32_t target = u32();
            uint32_t idx = u32();
            uint32_t source = u32();
            return mk_uset(target, idx, source, body());
        }
        case 5: {
            uint32_t target = u32();
            uint32_t idx = u32();
            uint32_t offset = u32();
            uint32_t source = u32();
            type t = ir_type();
            return mk_sset(target, idx, offset, source, t, body());
        }
        case 6: {
            uint32_t var = u32();
            uint32_t amount = u32();
            bool maybe_scalar = boolean();
            (void)boolean();
            return mk_inc(var, amount, maybe_scalar, body());
        }
        case 7: {
            uint32_t var = u32();
            uint32_t amount = u32();
            bool maybe_scalar = boolean();
            (void)boolean();
            return mk_dec(var, amount, maybe_scalar, body());
        }
        case 8:
            return mk_del(u32(), body());
        case 9: {
            object * tid = name();
            uint32_t var = u32();
            type t = ir_type();
            return mk_case(tid, var, t, mk_array(alts()));
        }
        case 10:
            return mk_ret(arg());
        case 11: {
            uint32_t jp = u32();
            return mk_jmp(jp, mk_array(args()));
        }
        case 12:
            return mk_unreachable();
        default:
            fail("unsupported function body tag " + std::to_string(tag));
            return mk_unreachable();
        }
    }

    object * decl(object * fn) {
        uint8_t tag = u8();
        object * ps = mk_array(params());
        type result_type = ir_type();
        if (tag == 0) {
            return mk_fun_decl(fn, ps, result_type, body());
        }
        if (tag == 1) {
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
        uint32_t count = u32();
        std::vector<object *> out;
        out.reserve(count);
        for (uint32_t i = 0; i < count; i++) {
            out.push_back(read_one());
        }
        return out;
    }
};

} // namespace

bool decode_ir_package(uint8_t const * data, size_t size, decoded_ir_package & out, std::string & error) {
    error.clear();
    out = decoded_ir_package{};
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

    std::vector<decl_entry> entries;
    entries.reserve(count);
    for (uint32_t i = 0; i < count; i++) {
        object * n = r.name();
        object * boxed_base = r.boolean() ? r.name() : nullptr;
        object * d = r.decl(n);
        entries.push_back({ n, boxed_base, d });
    }

    std::vector<init_global_entry> init_entries;
    uint32_t init_count = r.u32();
    init_entries.reserve(init_count);
    for (uint32_t i = 0; i < init_count; i++) {
        object * n = r.name();
        object * init_name = r.name();
        init_entries.push_back({ n, init_name });
    }

    std::vector<host_import_entry> host_imports;
    uint32_t host_import_count = r.u32();
    host_imports.reserve(host_import_count);
    for (uint32_t i = 0; i < host_import_count; i++) {
        host_imports.push_back(r.host_import());
    }

    std::vector<export_call_summary_entry> export_summaries;
    uint32_t export_summary_count = r.u32();
    export_summaries.reserve(export_summary_count);
    for (uint32_t i = 0; i < export_summary_count; i++) {
        export_summaries.push_back(r.export_summary());
    }
    if (!r.ok) {
        error = r.error();
        return false;
    }

    std::string interface_manifest = r.string();
    if (interface_manifest.empty()) {
        error = "IR package is missing an embedded interface manifest";
        return false;
    }
    if (!r.at_end()) {
        error = "trailing bytes after IR package at byte " + std::to_string(r.pos());
        return false;
    }

    std::vector<uint32_t> call_summary_indices(entries.size(), UINT32_MAX);
    for (size_t i = 0; i < entries.size(); i++) {
        object * call_name = entries[i].boxed_base ? entries[i].boxed_base : entries[i].name;
        for (size_t j = 0; j < export_summaries.size(); j++) {
            if (lean_name_eq(call_name, export_summaries[j].name)) {
                call_summary_indices[i] = static_cast<uint32_t>(j);
                break;
            }
        }
    }

    out.entries = std::move(entries);
    out.init_entries = std::move(init_entries);
    out.host_imports = std::move(host_imports);
    out.export_summaries = std::move(export_summaries);
    out.call_summary_indices = std::move(call_summary_indices);
    out.interface_manifest = std::move(interface_manifest);
    out.format_version = version;
    return true;
}

} // namespace lean::vir
