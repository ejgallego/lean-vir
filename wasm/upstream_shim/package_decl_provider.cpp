/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

#include "library/ir_types.h"
#include "util/name.h"

namespace lean {
extern "C" obj_res lean_name_mk_string(obj_arg prefix, obj_arg suffix);
extern "C" obj_res lean_name_mk_numeral(obj_arg prefix, obj_arg suffix);
}

extern "C" lean::object * lean_run_init(
    lean::object * env,
    lean::object * opts,
    lean::object * decl,
    lean::object * init_decl,
    lean::object * world);

namespace lean::vir {
namespace {

using ir::type;

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
    bool is_io;
    std::string signature;
};

static std::vector<decl_entry> g_entries;
static std::vector<init_global_entry> g_init_entries;
static std::vector<host_import_entry> g_host_imports;
static std::string g_interface_manifest;
static std::string g_last_error;
static bool g_package_loaded = false;

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

class reader {
    uint8_t const * m_data;
    size_t m_size;
    size_t m_pos = 0;

public:
    bool ok = true;

    reader(uint8_t const * data, size_t size):
        m_data(data),
        m_size(size) {
    }

    std::string const & error() const {
        return m_error;
    }

    bool at_end() const {
        return m_pos == m_size;
    }

    size_t pos() const {
        return m_pos;
    }

    std::string bytes_from(size_t start, size_t end) const {
        if (start > end || end > m_size) {
            return std::string();
        }
        return std::string(reinterpret_cast<char const *>(m_data + start), end - start);
    }

    void set_version(uint32_t version) {
        m_version = version;
    }

    void fail(std::string const & message) {
        if (ok) {
            ok = false;
            m_error = "byte " + std::to_string(m_pos) + ": " + message;
        }
    }

    uint8_t u8() {
        if (!ok) {
            return 0;
        }
        if (m_pos >= m_size) {
            fail("unexpected end of IR package");
            return 0;
        }
        return m_data[m_pos++];
    }

    bool boolean() {
        uint8_t value = u8();
        if (value == 0) {
            return false;
        }
        if (value == 1) {
            return true;
        }
        fail("invalid boolean tag " + std::to_string(value));
        return false;
    }

    uint32_t u32() {
        uint32_t b0 = u8();
        uint32_t b1 = u8();
        uint32_t b2 = u8();
        uint32_t b3 = u8();
        return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    }

    object * nat() {
        std::string decimal = string();
        return lean_cstr_to_nat(decimal.c_str());
    }

    std::string string() {
        uint32_t len = u32();
        if (!ok) {
            return std::string();
        }
        if (len > m_size - m_pos) {
            fail("string length " + std::to_string(len) + " exceeds remaining package bytes");
            return std::string();
        }
        std::string out(reinterpret_cast<char const *>(m_data + m_pos), len);
        m_pos += len;
        return out;
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
            if (m_version >= 2) {
                return mk_lit_num(nat());
            }
            return mk_lit_num(u32());
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

    void interface_type() {
        uint8_t tag = u8();
        switch (tag) {
        case 16:
        case 17:
        case 18:
            interface_type();
            break;
        case 19:
            interface_type();
            interface_type();
            break;
        case 20: {
            u32(); // object field count
            u32(); // usize field count
            u32(); // scalar byte size
            u32(); // trivial field index, or UINT32_MAX
            uint32_t field_count = u32();
            for (uint32_t i = 0; i < field_count; i++) {
                u8();  // field layout tag
                u32(); // object/usize index
                u32(); // scalar size
                u32(); // scalar offset
                interface_type();
            }
            break;
        }
        case 21: {
            uint32_t variant_count = u32();
            for (uint32_t i = 0; i < variant_count; i++) {
                u32(); // object field count
                u32(); // usize field count
                u32(); // scalar byte size
                u8();  // field layout tag
                u32(); // object/usize index
                u32(); // scalar size
                u32(); // scalar offset
                interface_type();
            }
            break;
        }
        case 25: {
            uint32_t variant_count = u32();
            for (uint32_t i = 0; i < variant_count; i++) {
                u32(); // object field count
                u32(); // usize field count
                u32(); // scalar byte size
                uint32_t field_count = u32();
                for (uint32_t j = 0; j < field_count; j++) {
                    u8();  // field layout tag
                    u32(); // object/usize index
                    u32(); // scalar size
                    u32(); // scalar offset
                    interface_type();
                }
            }
            break;
        }
        case 24: {
            boolean(); // effect
            uint32_t arg_count = u32();
            for (uint32_t i = 0; i < arg_count; i++) {
                interface_type();
            }
            interface_type();
            break;
        }
        case 0:
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
        case 6:
        case 7:
        case 8:
        case 9:
        case 10:
        case 11:
        case 14:
        case 15:
        case 22:
        case 23:
        case 26:
            break;
        default:
            fail("unsupported interface type tag " + std::to_string(tag));
            break;
        }
    }

    host_import_entry host_import() {
        object * n = name();
        std::string target = string();
        std::string symbol = string();
        uint32_t arity = u32();
        bool is_io = boolean();
        size_t signature_start = pos();
        uint32_t argc = u32();
        for (uint32_t i = 0; i < argc; i++) {
            interface_type();
        }
        interface_type();
        size_t signature_end = pos();
        return { n, target, symbol, arity, is_io, bytes_from(signature_start, signature_end) };
    }

private:
    std::string m_error;
    uint32_t m_version = 1;

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

static void clear_loaded_package() {
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
    g_entries.clear();
    g_init_entries.clear();
    g_host_imports.clear();
    g_interface_manifest.clear();
    g_package_loaded = false;
}

static bool load_package(uint8_t const * data, size_t size) {
    g_last_error.clear();
    clear_loaded_package();
    if (data == nullptr && size != 0) {
        g_last_error = "IR package pointer is null";
        return false;
    }

    reader r(data, size);
    std::string magic = r.string();
    uint32_t version = r.u32();
    uint32_t count = r.u32();
    if (!r.ok) {
        g_last_error = r.error();
        return false;
    }
    if (magic != "lean-vir-ir-package") {
        g_last_error = "invalid IR package magic `" + magic + "`";
        return false;
    }
    if (version != 1 && version != 2 && version != 3 && version != 4 && version != 5) {
        g_last_error = "unsupported IR package version " + std::to_string(version);
        return false;
    }
    r.set_version(version);

    std::vector<decl_entry> entries;
    entries.reserve(count);
    for (uint32_t i = 0; i < count; i++) {
        object * n = r.name();
        object * boxed_base = r.boolean() ? r.name() : nullptr;
        object * d = r.decl(n);
        entries.push_back({ n, boxed_base, d });
    }

    std::vector<init_global_entry> init_entries;
    if (version >= 3) {
        uint32_t init_count = r.u32();
        init_entries.reserve(init_count);
        for (uint32_t i = 0; i < init_count; i++) {
            object * n = r.name();
            object * init_name = r.name();
            init_entries.push_back({ n, init_name });
        }
    }
    std::vector<host_import_entry> host_imports;
    if (version >= 5) {
        uint32_t host_import_count = r.u32();
        host_imports.reserve(host_import_count);
        for (uint32_t i = 0; i < host_import_count; i++) {
            host_imports.push_back(r.host_import());
        }
    }
    if (!r.ok) {
        g_last_error = r.error();
        return false;
    }
    std::string interface_manifest;
    if (version >= 4) {
        interface_manifest = r.string();
        if (interface_manifest.empty()) {
            g_last_error = "IR package is missing an embedded interface manifest";
            return false;
        }
    }
    if (!r.at_end()) {
        g_last_error = "trailing bytes after IR package at byte " + std::to_string(r.pos());
        return false;
    }
    g_entries = std::move(entries);
    g_init_entries = std::move(init_entries);
    g_host_imports = std::move(host_imports);
    g_interface_manifest = std::move(interface_manifest);
    g_package_loaded = true;
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

static bool run_package_initializers() {
    if (g_init_entries.empty()) {
        return true;
    }

    vir_ensure_ir_interpreter_initialized();
    scoped_io_initializing scope;
    for (init_global_entry const & entry : g_init_entries) {
        if (!run_init_global(entry)) {
            return false;
        }
    }
    return true;
}

} // namespace

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

char const * host_import_signature(uint32_t slot) {
    if (slot >= g_host_imports.size()) {
        return nullptr;
    }
    return g_host_imports[slot].signature.data();
}

uint32_t host_import_signature_size(uint32_t slot) {
    if (slot >= g_host_imports.size()) {
        return 0;
    }
    return static_cast<uint32_t>(g_host_imports[slot].signature.size());
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

extern "C" void * vir_alloc_bytes(uint32_t size) {
    return malloc(size == 0 ? 1 : size);
}

extern "C" void vir_free_bytes(void * ptr) {
    free(ptr);
}

extern "C" uint32_t vir_load_ir_package(uint8_t const * data, uint32_t size) {
    if (!lean::vir::load_package(data, size)) {
        return 0;
    }
    if (!lean::vir::run_package_initializers()) {
        lean::vir::clear_loaded_package();
        return 0;
    }
    return lean::vir::package_decl_count();
}

extern "C" char const * vir_last_package_error(void) {
    return lean::vir::last_package_error();
}

extern "C" uint32_t vir_last_package_error_size(void) {
    return lean::vir::last_package_error_size();
}

extern "C" char const * vir_package_interface_manifest(void) {
    return lean::vir::package_interface_manifest();
}

extern "C" uint32_t vir_package_interface_manifest_size(void) {
    return lean::vir::package_interface_manifest_size();
}

extern "C" uint32_t vir_package_decl_count(void) {
    return lean::vir::package_decl_count();
}
