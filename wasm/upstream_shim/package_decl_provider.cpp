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

namespace lean::vir {
namespace {

using ir::type;

struct decl_entry {
    object * name;
    object * boxed_base;
    object * decl;
};

static std::vector<decl_entry> g_entries;

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

static object * mk_lit_num(size_t value) {
    object * lit_val = mk_ctor(0, { mk_nat(value) });
    object * expr = mk_ctor(11, { lit_val });
    lean_dec(lit_val);
    return expr;
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

    uint8_t u8() {
        if (!ok || m_pos >= m_size) {
            ok = false;
            return 0;
        }
        return m_data[m_pos++];
    }

    bool boolean() {
        return u8() != 0;
    }

    uint32_t u32() {
        uint32_t b0 = u8();
        uint32_t b1 = u8();
        uint32_t b2 = u8();
        uint32_t b3 = u8();
        return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    }

    std::string string() {
        uint32_t len = u32();
        if (!ok || m_pos + len > m_size) {
            ok = false;
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
        ok = false;
        return lean_box(0);
    }

    type ir_type() {
        switch (u8()) {
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
            ok = false;
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
        ok = false;
        return mk_arg_erased();
    }

    std::vector<object *> args() {
        return object_array([&] { return arg(); });
    }

    object * lit() {
        uint8_t tag = u8();
        if (tag == 0) {
            return mk_lit_num(u32());
        }
        if (tag == 1) {
            return mk_lit_str(string());
        }
        ok = false;
        return mk_lit_num(0);
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
            ok = false;
            return mk_lit_num(0);
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
        ok = false;
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
            ok = false;
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
        ok = false;
        return mk_extern_decl(fn, ps, result_type);
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

static bool load_package(uint8_t const * data, size_t size) {
    reader r(data, size);
    std::string magic = r.string();
    uint32_t version = r.u32();
    uint32_t count = r.u32();
    if (!r.ok || magic != "lean-vir-ir-package" || version != 1) {
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
    if (!r.ok) {
        return false;
    }
    g_entries = std::move(entries);
    return true;
}

} // namespace

object * mk_static_nat(size_t value) {
    return lean_usize_to_nat(value);
}

size_t static_nat_to_usize(object * value) {
    return lean_usize_of_nat(value);
}

object * find_static_decl(object * n) {
    for (decl_entry const & entry : g_entries) {
        if (lean_name_eq(n, entry.name)) {
            return entry.decl;
        }
    }
    return nullptr;
}

object * find_static_boxed_decl(object * n) {
    for (decl_entry const & entry : g_entries) {
        if (entry.boxed_base && lean_name_eq(n, entry.boxed_base)) {
            return entry.decl;
        }
    }
    return nullptr;
}

uint32_t static_decl_count() {
    return g_entries.size();
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
    return lean::vir::static_decl_count();
}
