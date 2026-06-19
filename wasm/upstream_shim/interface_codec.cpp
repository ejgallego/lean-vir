/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "interface_codec.h"

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <algorithm>
#include <initializer_list>
#include <limits>
#include <string>
#include <vector>

#include "kernel/expr.h"
#include "runtime/object.h"
#include "util/name.h"

namespace lean {

static std::string nat_to_decimal(object * value) {
    if (lean_is_scalar(value)) {
        return std::to_string(lean_unbox(value));
    }
    return mpz_value(value).to_string();
}

static object * mk_ctor_owned(unsigned tag, std::initializer_list<object *> fields, unsigned scalar_size = 0) {
    object * obj = lean_alloc_ctor(tag, fields.size(), scalar_size);
    unsigned idx = 0;
    for (object * field : fields) {
        lean_ctor_set(obj, idx, field);
        idx++;
    }
    return obj;
}

static object * mk_byte_array(uint8_t const * values, uint32_t len) {
    object * array = lean_alloc_sarray(1, len, len);
    if (len != 0) {
        memcpy(lean_sarray_cptr(array), values, len);
    }
    return array;
}

extern "C" object * lean_level_mk_succ(obj_arg);
extern "C" object * lean_level_mk_mvar(obj_arg);
extern "C" object * lean_level_mk_param(obj_arg);
extern "C" object * lean_level_mk_max(obj_arg, obj_arg);
extern "C" object * lean_level_mk_imax(obj_arg, obj_arg);

extern "C" object * lean_expr_mk_bvar(obj_arg);
extern "C" object * lean_expr_mk_fvar(obj_arg);
extern "C" object * lean_expr_mk_mvar(obj_arg);
extern "C" object * lean_expr_mk_sort(obj_arg);
extern "C" object * lean_expr_mk_const(obj_arg, obj_arg);
extern "C" object * lean_expr_mk_app(obj_arg, obj_arg);
extern "C" object * lean_expr_mk_lambda(obj_arg, obj_arg, obj_arg, uint8_t);
extern "C" object * lean_expr_mk_forall(obj_arg, obj_arg, obj_arg, uint8_t);
extern "C" object * lean_expr_mk_let(obj_arg, obj_arg, obj_arg, obj_arg, uint8_t);
extern "C" object * lean_expr_mk_lit(obj_arg);
extern "C" object * lean_expr_mk_proj(obj_arg, obj_arg, obj_arg);
extern "C" __externref_t vir_resource_take(void);
extern "C" void vir_resource_push(__externref_t value);
extern "C" uint32_t vir_resource_root(__externref_t value);
extern "C" __externref_t vir_resource_get(uint32_t root_id);
extern "C" void vir_resource_release(uint32_t root_id);
extern "C" uint32_t vir_closure_root_with_signature(
    object * value,
    char const * signature_bytes,
    uint32_t signature_len,
    uint8_t is_io);
extern "C" void vir_closure_push(uint32_t root_id);

static object * mk_name_from_dotted_string(std::string const & text) {
    name n = name_from_dotted(text.data(), text.size());
    lean_inc(n.raw());
    return n.raw();
}

static std::string name_to_string(object * value) {
    return name(value, true).to_string();
}

static bool parse_u64(std::string const & text, uint64_t & out) {
    if (text.empty()) return false;
    uint64_t value = 0;
    for (char c : text) {
        if (c < '0' || c > '9') return false;
        uint64_t digit = static_cast<uint64_t>(c - '0');
        if (value > (std::numeric_limits<uint64_t>::max() - digit) / 10) {
            return false;
        }
        value = value * 10 + digit;
    }
    out = value;
    return true;
}

static object * mk_list_from_reversed(std::vector<object *> const & values) {
    object * out = lean_box(0);
    for (object * value : values) {
        object * cons = lean_alloc_ctor(1, 2, 0);
        lean_inc(value);
        lean_ctor_set(cons, 0, value);
        lean_ctor_set(cons, 1, out);
        out = cons;
    }
    return out;
}

static object * decode_level(vir_reader & r);
static object * decode_expr(vir_reader & r);
static void encode_level(vir_writer & w, object * value);
static void encode_expr_payload(vir_writer & w, object * value);
static void encode_function_signature(vir_writer & w, vir_type const & type);

struct vir_resource_data {
    uint32_t root_id = 0;
};

static lean_external_class * g_vir_resource_external_class = nullptr;

static void vir_resource_finalize(void * data) {
    vir_resource_data * resource = static_cast<vir_resource_data *>(data);
    if (resource != nullptr) {
        if (resource->root_id != 0) {
            vir_resource_release(resource->root_id);
        }
        delete resource;
    }
}

static lean_external_class * vir_resource_external_class() {
    if (g_vir_resource_external_class == nullptr) {
        g_vir_resource_external_class = lean_register_external_class(vir_resource_finalize, nullptr);
    }
    return g_vir_resource_external_class;
}

static object * mk_resource_object(__externref_t value, vir_reader & r) {
    uint32_t root_id = vir_resource_root(value);
    if (root_id == 0) {
        r.fail("missing externref resource value");
        return lean_box(0);
    }
    return lean_alloc_external(vir_resource_external_class(), new vir_resource_data{root_id});
}

static uint32_t resource_root_id_for_object(object * value, vir_writer & w) {
    if (!lean_is_external(value) || lean_get_external_class(value) != vir_resource_external_class()) {
        w.fail("Lean resource value is not a VIR externref resource");
        return 0;
    }
    vir_resource_data * resource = static_cast<vir_resource_data *>(lean_get_external_data(value));
    if (resource == nullptr || resource->root_id == 0) {
        w.fail("Lean resource value has been released");
        return 0;
    }
    return resource->root_id;
}

static bool is_known_wire_type(vir_wire_type tag) {
    switch (tag) {
    case vir_wire_type::Unit:
    case vir_wire_type::Nat:
    case vir_wire_type::Int:
    case vir_wire_type::Bool:
    case vir_wire_type::String:
    case vir_wire_type::UInt8:
    case vir_wire_type::UInt16:
    case vir_wire_type::UInt32:
    case vir_wire_type::UInt64:
    case vir_wire_type::USize:
    case vir_wire_type::ByteArray:
    case vir_wire_type::Float:
    case vir_wire_type::Float32:
    case vir_wire_type::Array:
    case vir_wire_type::List:
    case vir_wire_type::Option:
    case vir_wire_type::Prod:
    case vir_wire_type::Structure:
    case vir_wire_type::TaggedUnion:
    case vir_wire_type::CustomInductive:
    case vir_wire_type::RecursiveSelf:
    case vir_wire_type::SimpleEnum:
    case vir_wire_type::Resource:
    case vir_wire_type::Function:
    case vir_wire_type::Expr:
        return true;
    default:
        return false;
    }
}

static bool is_known_field_layout(vir_field_layout_kind kind) {
    switch (kind) {
    case vir_field_layout_kind::Object:
    case vir_field_layout_kind::USize:
    case vir_field_layout_kind::Scalar:
        return true;
    default:
        return false;
    }
}

static vir_field_layout decode_field_layout(vir_reader & r) {
    vir_field_layout layout {
        static_cast<vir_field_layout_kind>(r.u8()),
        r.u32(),
        r.u32(),
        r.u32(),
    };
    if (!is_known_field_layout(layout.kind)) {
        r.fail("unsupported structure field layout tag " + std::to_string(static_cast<uint8_t>(layout.kind)));
    }
    return layout;
}

static void encode_field_layout(vir_writer & w, vir_field_layout const & layout) {
    w.u8(static_cast<uint8_t>(layout.kind));
    w.u32(layout.index);
    w.u32(layout.size);
    w.u32(layout.offset);
}

vir_type decode_type(vir_reader & r);
void encode_type(vir_writer & w, vir_type const & type);

static vir_variant decode_variant_runtime_counts(vir_reader & r) {
    vir_variant variant;
    variant.object_fields = r.u32();
    variant.usize_fields = r.u32();
    variant.scalar_bytes = r.u32();
    return variant;
}

static void encode_variant_runtime_counts(vir_writer & w, vir_variant const & variant) {
    w.u32(variant.object_fields);
    w.u32(variant.usize_fields);
    w.u32(variant.scalar_bytes);
}

static void decode_field_descriptors(
    vir_reader & r,
    uint32_t field_count,
    std::vector<vir_type> & fields,
    std::vector<vir_field_layout> & layouts) {
    fields.reserve(field_count);
    layouts.reserve(field_count);
    for (uint32_t i = 0; i < field_count; i++) {
        layouts.push_back(decode_field_layout(r));
        fields.push_back(decode_type(r));
    }
}

static void encode_field_descriptors(
    vir_writer & w,
    std::vector<vir_type> const & fields,
    std::vector<vir_field_layout> const & layouts) {
    for (size_t i = 0; i < fields.size(); i++) {
        encode_field_layout(w, layouts[i]);
        encode_type(w, fields[i]);
    }
}

vir_type decode_type(vir_reader & r) {
    vir_type type { static_cast<vir_wire_type>(r.u8()), {} };
    if (!is_known_wire_type(type.tag)) {
        r.fail("unsupported wire type tag " + std::to_string(static_cast<uint8_t>(type.tag)));
        return { vir_wire_type::Nat, {} };
    }
    switch (type.tag) {
    case vir_wire_type::Array:
    case vir_wire_type::List:
    case vir_wire_type::Option:
        type.args.push_back(decode_type(r));
        break;
    case vir_wire_type::Prod:
        type.args.push_back(decode_type(r));
        type.args.push_back(decode_type(r));
        break;
    case vir_wire_type::Structure: {
        type.object_fields = r.u32();
        type.usize_fields = r.u32();
        type.scalar_bytes = r.u32();
        type.trivial_field = r.u32();
        uint32_t field_count = r.u32();
        decode_field_descriptors(r, field_count, type.args, type.field_layouts);
        if (type.trivial_field != UINT32_MAX && type.trivial_field >= field_count) {
            r.fail("structure trivial field index is out of range");
        }
        break;
    }
    case vir_wire_type::TaggedUnion: {
        uint32_t variant_count = r.u32();
        type.variants.reserve(variant_count);
        for (uint32_t i = 0; i < variant_count; i++) {
            vir_variant variant = decode_variant_runtime_counts(r);
            decode_field_descriptors(r, 1, variant.fields, variant.field_layouts);
            type.variants.push_back(std::move(variant));
        }
        if (variant_count == 0) {
            r.fail("tagged union has no constructors");
        }
        break;
    }
    case vir_wire_type::CustomInductive: {
        uint32_t variant_count = r.u32();
        type.variants.reserve(variant_count);
        for (uint32_t i = 0; i < variant_count; i++) {
            vir_variant variant = decode_variant_runtime_counts(r);
            uint32_t field_count = r.u32();
            decode_field_descriptors(r, field_count, variant.fields, variant.field_layouts);
            type.variants.push_back(std::move(variant));
        }
        if (variant_count == 0) {
            r.fail("custom inductive has no constructors");
        }
        break;
    }
    case vir_wire_type::Function: {
        type.is_io = r.u8() != 0;
        uint32_t arg_count = r.u32();
        type.args.reserve(arg_count + 1);
        for (uint32_t i = 0; i < arg_count; i++) {
            type.args.push_back(decode_type(r));
        }
        type.args.push_back(decode_type(r));
        break;
    }
    default:
        break;
    }
    return type;
}

void encode_type(vir_writer & w, vir_type const & type) {
    w.u8(static_cast<uint8_t>(type.tag));
    switch (type.tag) {
    case vir_wire_type::Array:
    case vir_wire_type::List:
    case vir_wire_type::Option:
        encode_type(w, type.args[0]);
        break;
    case vir_wire_type::Prod:
        encode_type(w, type.args[0]);
        encode_type(w, type.args[1]);
        break;
    case vir_wire_type::Structure:
        w.u32(type.object_fields);
        w.u32(type.usize_fields);
        w.u32(type.scalar_bytes);
        w.u32(type.trivial_field);
        w.u32(static_cast<uint32_t>(type.args.size()));
        encode_field_descriptors(w, type.args, type.field_layouts);
        break;
    case vir_wire_type::TaggedUnion:
        w.u32(static_cast<uint32_t>(type.variants.size()));
        for (vir_variant const & variant : type.variants) {
            encode_variant_runtime_counts(w, variant);
            encode_field_descriptors(w, variant.fields, variant.field_layouts);
        }
        break;
    case vir_wire_type::CustomInductive:
        w.u32(static_cast<uint32_t>(type.variants.size()));
        for (vir_variant const & variant : type.variants) {
            encode_variant_runtime_counts(w, variant);
            w.u32(static_cast<uint32_t>(variant.fields.size()));
            encode_field_descriptors(w, variant.fields, variant.field_layouts);
        }
        break;
    case vir_wire_type::Function:
        w.u8(type.is_io ? 1 : 0);
        w.u32(type.args.empty() ? 0 : static_cast<uint32_t>(type.args.size() - 1));
        for (size_t i = 0; i + 1 < type.args.size(); i++) {
            encode_type(w, type.args[i]);
        }
        if (!type.args.empty()) {
            encode_type(w, type.args.back());
        }
        break;
    default:
        break;
    }
}

static object * decode_level_list(vir_reader & r) {
    uint32_t len = r.u32();
    std::vector<object *> values;
    values.reserve(len);
    for (uint32_t i = 0; i < len; i++) {
        values.push_back(decode_level(r));
    }
    std::reverse(values.begin(), values.end());
    object * out = mk_list_from_reversed(values);
    for (object * value : values) lean_dec(value);
    return out;
}

static void encode_level_list(vir_writer & w, object * value) {
    std::vector<object *> values;
    object * cursor = value;
    while (!lean_is_scalar(cursor)) {
        values.push_back(lean_ctor_get(cursor, 0));
        cursor = lean_ctor_get(cursor, 1);
    }
    w.u32(static_cast<uint32_t>(values.size()));
    for (object * level : values) {
        encode_level(w, level);
    }
}

static object * decode_level(vir_reader & r) {
    uint8_t tag = r.u8();
    switch (tag) {
    case 0:
        return lean_box(0);
    case 1:
        return lean_level_mk_succ(decode_level(r));
    case 2: {
        object * lhs = decode_level(r);
        object * rhs = decode_level(r);
        return lean_level_mk_max(lhs, rhs);
    }
    case 3: {
        object * lhs = decode_level(r);
        object * rhs = decode_level(r);
        return lean_level_mk_imax(lhs, rhs);
    }
    case 4: {
        std::string text = r.string();
        return lean_level_mk_param(mk_name_from_dotted_string(text));
    }
    case 5: {
        std::string text = r.string();
        return lean_level_mk_mvar(mk_name_from_dotted_string(text));
    }
    default:
        r.fail("unsupported Lean.Level wire tag " + std::to_string(tag));
        return lean_box(0);
    }
}

static void encode_level(vir_writer & w, object * value) {
    if (lean_is_scalar(value)) {
        w.u8(0);
        return;
    }
    level lvl(value, true);
    switch (lvl.kind()) {
    case level_kind::Succ:
        w.u8(1);
        encode_level(w, succ_of(lvl).raw());
        break;
    case level_kind::Max:
        w.u8(2);
        encode_level(w, max_lhs(lvl).raw());
        encode_level(w, max_rhs(lvl).raw());
        break;
    case level_kind::IMax:
        w.u8(3);
        encode_level(w, imax_lhs(lvl).raw());
        encode_level(w, imax_rhs(lvl).raw());
        break;
    case level_kind::Param:
        w.u8(4);
        w.string(param_id(lvl).to_string());
        break;
    case level_kind::MVar:
        w.u8(5);
        w.string(mvar_id(lvl).to_string());
        break;
    case level_kind::Zero:
        w.u8(0);
        break;
    }
}

static uint8_t expr_scalar_u8(object * value, unsigned object_fields) {
    if (lean_ctor_num_objs(value) > object_fields) {
        return static_cast<uint8_t>(lean_unbox(lean_ctor_get(value, object_fields)));
    }
    return lean_ctor_get_uint8(value, lean_ctor_num_objs(value) * sizeof(void *) + sizeof(uint64_t));
}

static object * decode_literal(vir_reader & r) {
    uint8_t tag = r.u8();
    switch (tag) {
    case 0: {
        std::string text = r.string();
        return mk_ctor_owned(0, { lean_cstr_to_nat(text.c_str()) });
    }
    case 1: {
        std::string text = r.string();
        return mk_ctor_owned(1, { lean_mk_string_from_bytes(text.data(), text.size()) });
    }
    default:
        r.fail("unsupported Lean.Literal wire tag " + std::to_string(tag));
        return mk_ctor_owned(0, { lean_box(0) });
    }
}

static void encode_literal(vir_writer & w, object * value) {
    uint8_t tag = lean_obj_tag(value);
    w.u8(tag);
    if (tag == 0) {
        w.string(nat_to_decimal(lean_ctor_get(value, 0)));
    } else if (tag == 1) {
        object * text = lean_ctor_get(value, 0);
        size_t size = lean_string_size(text);
        uint32_t len = static_cast<uint32_t>(size == 0 ? 0 : size - 1);
        w.bytes(reinterpret_cast<uint8_t const *>(lean_string_cstr(text)), len);
    }
}

static object * decode_expr(vir_reader & r) {
    uint8_t tag = r.u8();
    switch (tag) {
    case 0: {
        std::string text = r.string();
        return lean_expr_mk_bvar(lean_cstr_to_nat(text.c_str()));
    }
    case 1: {
        std::string text = r.string();
        return lean_expr_mk_fvar(mk_name_from_dotted_string(text));
    }
    case 2: {
        std::string text = r.string();
        return lean_expr_mk_mvar(mk_name_from_dotted_string(text));
    }
    case 3:
        return lean_expr_mk_sort(decode_level(r));
    case 4: {
        object * name = mk_name_from_dotted_string(r.string());
        object * levels = decode_level_list(r);
        return lean_expr_mk_const(name, levels);
    }
    case 5: {
        object * fn = decode_expr(r);
        object * arg = decode_expr(r);
        return lean_expr_mk_app(fn, arg);
    }
    case 6: {
        object * name = mk_name_from_dotted_string(r.string());
        object * type = decode_expr(r);
        object * body = decode_expr(r);
        return lean_expr_mk_lambda(name, type, body, r.u8());
    }
    case 7: {
        object * name = mk_name_from_dotted_string(r.string());
        object * type = decode_expr(r);
        object * body = decode_expr(r);
        return lean_expr_mk_forall(name, type, body, r.u8());
    }
    case 8: {
        object * name = mk_name_from_dotted_string(r.string());
        object * type = decode_expr(r);
        object * value = decode_expr(r);
        object * body = decode_expr(r);
        return lean_expr_mk_let(name, type, value, body, r.u8());
    }
    case 9:
        return lean_expr_mk_lit(decode_literal(r));
    case 10:
        return decode_expr(r);
    case 11: {
        object * type_name = mk_name_from_dotted_string(r.string());
        std::string idx_text = r.string();
        object * idx = lean_cstr_to_nat(idx_text.c_str());
        object * structure = decode_expr(r);
        return lean_expr_mk_proj(type_name, idx, structure);
    }
    default:
        r.fail("unsupported Lean.Expr wire tag " + std::to_string(tag));
        return lean_expr_mk_bvar(lean_box(0));
    }
}

static uint32_t scalar_field_base(uint32_t object_fields, uint32_t usize_fields) {
    return (object_fields + usize_fields) * sizeof(void *);
}

static uint32_t structure_scalar_base(vir_type const & type) {
    return scalar_field_base(type.object_fields, type.usize_fields);
}

static uint32_t variant_scalar_base(vir_variant const & variant) {
    return scalar_field_base(variant.object_fields, variant.usize_fields);
}

static void set_scalar_field(
    vir_reader & r,
    object * obj,
    uint32_t scalar_base,
    vir_type const & field_type,
    vir_field_layout const & layout,
    object * field_value,
    char const * owner) {
    uint32_t offset = scalar_base + layout.offset;
    switch (field_type.tag) {
    case vir_wire_type::Bool:
    case vir_wire_type::UInt8:
    case vir_wire_type::SimpleEnum:
        if (layout.size == 1) {
            lean_ctor_set_uint8(obj, offset, static_cast<uint8_t>(lean_unbox(field_value)));
            break;
        }
        if (layout.size == 2) {
            lean_ctor_set_uint16(obj, offset, static_cast<uint16_t>(lean_unbox(field_value)));
            break;
        }
        if (layout.size == 4) {
            lean_ctor_set_uint32(obj, offset, static_cast<uint32_t>(lean_unbox(field_value)));
            break;
        }
        r.fail("unsupported " + std::string(owner) + " enum scalar size " + std::to_string(layout.size));
        break;
    case vir_wire_type::UInt16:
        lean_ctor_set_uint16(obj, offset, static_cast<uint16_t>(lean_unbox(field_value)));
        break;
    case vir_wire_type::UInt32:
        lean_ctor_set_uint32(obj, offset, lean_unbox_uint32(field_value));
        break;
    case vir_wire_type::UInt64:
        lean_ctor_set_uint64(obj, offset, lean_unbox_uint64(field_value));
        break;
    case vir_wire_type::Float:
        lean_ctor_set_float(obj, offset, lean_unbox_float(field_value));
        break;
    case vir_wire_type::Float32:
        lean_ctor_set_float32(obj, offset, lean_unbox_float32(field_value));
        break;
    default:
        r.fail(std::string(owner) + " scalar field has non-scalar wire type");
        break;
    }
}

static void set_ctor_field(
    vir_reader & r,
    object * obj,
    uint32_t scalar_base,
    vir_type const & field_type,
    vir_field_layout const & layout,
    object * field_value,
    char const * owner) {
    switch (layout.kind) {
    case vir_field_layout_kind::Object:
        lean_ctor_set(obj, layout.index, field_value);
        break;
    case vir_field_layout_kind::USize:
        if (field_type.tag != vir_wire_type::USize) {
            r.fail(std::string(owner) + " usize field has non-USize wire type");
        } else {
            lean_ctor_set_usize(obj, layout.index, lean_unbox_usize(field_value));
        }
        lean_dec(field_value);
        break;
    case vir_field_layout_kind::Scalar:
        set_scalar_field(r, obj, scalar_base, field_type, layout, field_value, owner);
        lean_dec(field_value);
        break;
    }
}

object * decode_value(vir_reader & r, vir_type const & type, vir_type const * self_type) {
    switch (type.tag) {
    case vir_wire_type::RecursiveSelf:
        if (self_type == nullptr) {
            r.fail("recursive self reference has no enclosing type");
            return lean_box(0);
        }
        return decode_value(r, *self_type, self_type);
    case vir_wire_type::Unit:
        return lean_box(0);
    case vir_wire_type::Nat: {
        std::string text = r.string();
        return lean_cstr_to_nat(text.c_str());
    }
    case vir_wire_type::Int: {
        std::string text = r.string();
        return lean_cstr_to_int(text.c_str());
    }
    case vir_wire_type::Bool:
        return lean_box(r.u8() ? 1 : 0);
    case vir_wire_type::String: {
        std::string text = r.string();
        return lean_mk_string_from_bytes(text.data(), text.size());
    }
    case vir_wire_type::UInt8:
        return lean_box(r.u8());
    case vir_wire_type::UInt16:
        return lean_box(static_cast<uint16_t>(r.u32()));
    case vir_wire_type::UInt32:
        return lean_box_uint32(r.u32());
    case vir_wire_type::Resource:
        return mk_resource_object(vir_resource_take(), r);
    case vir_wire_type::Function:
        r.fail("JavaScript-provided function values are not supported yet");
        return lean_box(0);
    case vir_wire_type::UInt64: {
        uint64_t value = 0;
        if (!parse_u64(r.string(), value)) {
            r.fail("invalid UInt64 decimal argument");
            return lean_box_uint64(0);
        }
        return lean_box_uint64(value);
    }
    case vir_wire_type::USize: {
        uint64_t value = 0;
        if (!parse_u64(r.string(), value) || value > std::numeric_limits<size_t>::max()) {
            r.fail("invalid USize decimal argument");
            return lean_box_usize(0);
        }
        return lean_box_usize(static_cast<size_t>(value));
    }
    case vir_wire_type::ByteArray: {
        std::vector<uint8_t> values = r.bytes();
        return mk_byte_array(values.data(), static_cast<uint32_t>(values.size()));
    }
    case vir_wire_type::Float:
        return lean_box_float(r.f64());
    case vir_wire_type::Float32:
        return lean_box_float32(r.f32());
    case vir_wire_type::Array: {
        uint32_t len = r.u32();
        object * array = lean_alloc_array(len, len);
        for (uint32_t i = 0; i < len; i++) {
            lean_array_set_core(array, i, decode_value(r, type.args[0], self_type));
        }
        return array;
    }
    case vir_wire_type::List: {
        uint32_t len = r.u32();
        std::vector<object *> values;
        values.reserve(len);
        for (uint32_t i = 0; i < len; i++) {
            values.push_back(decode_value(r, type.args[0], self_type));
        }
        std::reverse(values.begin(), values.end());
        object * out = mk_list_from_reversed(values);
        for (object * value : values) lean_dec(value);
        return out;
    }
    case vir_wire_type::Option: {
        if (r.u8() == 0) return lean_box(0);
        return mk_ctor_owned(1, { decode_value(r, type.args[0], self_type) });
    }
    case vir_wire_type::Prod: {
        object * fst = decode_value(r, type.args[0], self_type);
        object * snd = decode_value(r, type.args[1], self_type);
        return mk_ctor_owned(0, { fst, snd });
    }
    case vir_wire_type::Structure: {
        if (type.trivial_field != UINT32_MAX) {
            return decode_value(r, type.args[type.trivial_field], &type);
        }
        object * obj = lean_alloc_ctor(
            0,
            type.object_fields,
            type.usize_fields * sizeof(size_t) + type.scalar_bytes);
        for (size_t i = 0; i < type.args.size(); i++) {
            vir_type const & field_type = type.args[i];
            vir_field_layout const & layout = type.field_layouts[i];
            object * field_value = decode_value(r, field_type, &type);
            set_ctor_field(r, obj, structure_scalar_base(type), field_type, layout, field_value, "structure");
        }
        return obj;
    }
    case vir_wire_type::TaggedUnion: {
        uint32_t tag = r.u32();
        if (tag >= type.variants.size()) {
            r.fail("tagged union constructor index is out of range");
            return lean_box(0);
        }
        vir_variant const & variant = type.variants[tag];
        vir_type const & field_type = variant.fields[0];
        vir_field_layout const & layout = variant.field_layouts[0];
        object * field_value = decode_value(r, field_type, self_type);
        object * obj = lean_alloc_ctor(
            tag,
            variant.object_fields,
            variant.usize_fields * sizeof(size_t) + variant.scalar_bytes);
        set_ctor_field(r, obj, variant_scalar_base(variant), field_type, layout, field_value, "tagged union");
        return obj;
    }
    case vir_wire_type::CustomInductive: {
        uint32_t tag = r.u32();
        if (tag >= type.variants.size()) {
            r.fail("custom inductive constructor index is out of range");
            return lean_box(0);
        }
        vir_variant const & variant = type.variants[tag];
        if (variant.fields.empty()) {
            return lean_box(tag);
        }
        object * obj = lean_alloc_ctor(
            tag,
            variant.object_fields,
            variant.usize_fields * sizeof(size_t) + variant.scalar_bytes);
        for (size_t i = 0; i < variant.fields.size(); i++) {
            vir_type const & field_type = variant.fields[i];
            vir_field_layout const & layout = variant.field_layouts[i];
            object * field_value = decode_value(r, field_type, &type);
            set_ctor_field(r, obj, variant_scalar_base(variant), field_type, layout, field_value, "custom inductive");
        }
        return obj;
    }
    case vir_wire_type::SimpleEnum:
        return lean_box(r.u32());
    case vir_wire_type::Expr:
        return decode_expr(r);
    default:
        r.fail("unsupported wire argument tag " + std::to_string(static_cast<uint8_t>(type.tag)));
        return lean_box(0);
    }
}

static bool is_unboxed_call_boundary_type(vir_type const & type) {
    switch (type.tag) {
    case vir_wire_type::UInt8:
    case vir_wire_type::UInt16:
    case vir_wire_type::UInt32:
    case vir_wire_type::USize:
        return true;
    default:
        return false;
    }
}

static bool is_unboxed_call_boundary_type(vir_type const & type, vir_type const ** field_type) {
    if (is_unboxed_call_boundary_type(type)) {
        *field_type = &type;
        return true;
    }
    if (type.tag == vir_wire_type::Structure && type.trivial_field != UINT32_MAX) {
        vir_type const & trivial_type = type.args[type.trivial_field];
        if (is_unboxed_call_boundary_type(trivial_type)) {
            *field_type = &trivial_type;
            return true;
        }
    }
    return false;
}

bool needs_boxed_wasm32_call_boundary_type(vir_type const & type) {
    if (
        type.tag == vir_wire_type::Float ||
        type.tag == vir_wire_type::Float32 ||
        type.tag == vir_wire_type::UInt64) {
        return true;
    }
    if (type.tag == vir_wire_type::Structure && type.trivial_field != UINT32_MAX) {
        return needs_boxed_wasm32_call_boundary_type(type.args[type.trivial_field]);
    }
    return false;
}

static object * decode_unboxed_call_argument(vir_reader & r, vir_type const & type) {
    uintptr_t value = 0;
    switch (type.tag) {
    case vir_wire_type::UInt8:
        value = r.u8();
        break;
    case vir_wire_type::UInt16:
    case vir_wire_type::UInt32:
        value = r.u32();
        break;
    case vir_wire_type::USize: {
        uint64_t parsed = 0;
        if (!parse_u64(r.string(), parsed) || parsed > std::numeric_limits<uintptr_t>::max()) {
            r.fail("invalid USize trivial structure argument");
            return nullptr;
        }
        value = static_cast<uintptr_t>(parsed);
        break;
    }
    default:
        lean_unreachable();
    }
    return reinterpret_cast<object *>(value);
}

static void encode_unboxed_call_result(vir_writer & w, vir_type const & type, object * value) {
    uintptr_t raw = reinterpret_cast<uintptr_t>(value);
    switch (type.tag) {
    case vir_wire_type::UInt8:
        w.u8(static_cast<uint8_t>(raw));
        break;
    case vir_wire_type::UInt16:
        w.u32(static_cast<uint16_t>(raw));
        break;
    case vir_wire_type::UInt32:
        w.u32(static_cast<uint32_t>(raw));
        break;
    case vir_wire_type::USize:
        w.string(std::to_string(raw));
        break;
    default:
        lean_unreachable();
    }
}

vir_arg decode_argument_payload(vir_reader & r, vir_type const & type, bool has_boxed_decl) {
    if (!has_boxed_decl && needs_boxed_wasm32_call_boundary_type(type)) {
        r.fail("top-level Float, Float32, UInt64, and trivial wrappers over them require a boxed declaration at the wasm32 interpreter boundary");
        return { lean_box(0), true };
    }
    vir_type const * unboxed_type = nullptr;
    if (!has_boxed_decl && is_unboxed_call_boundary_type(type, &unboxed_type)) {
        return { decode_unboxed_call_argument(r, *unboxed_type), false };
    }
    return { decode_value(r, type), true };
}

static std::string int_to_decimal(object * value) {
    if (lean_is_scalar(value)) {
        return std::to_string(lean_scalar_to_int(value));
    }
    return mpz_value(value).to_string();
}

static void encode_nat_payload(vir_writer & w, object * value) {
    w.string(nat_to_decimal(value));
}

static void encode_string_payload(vir_writer & w, object * value) {
    size_t size = lean_string_size(value);
    uint32_t len = static_cast<uint32_t>(size == 0 ? 0 : size - 1);
    w.bytes(reinterpret_cast<uint8_t const *>(lean_string_cstr(value)), len);
}

static void encode_expr_payload(vir_writer & w, object * value) {
    expr e(value, true);
    switch (e.kind()) {
    case expr_kind::BVar:
        w.u8(0);
        w.string(nat_to_decimal(lean_ctor_get(value, 0)));
        break;
    case expr_kind::FVar:
        w.u8(1);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        break;
    case expr_kind::MVar:
        w.u8(2);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        break;
    case expr_kind::Sort:
        w.u8(3);
        encode_level(w, lean_ctor_get(value, 0));
        break;
    case expr_kind::Const:
        w.u8(4);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        encode_level_list(w, lean_ctor_get(value, 1));
        break;
    case expr_kind::App:
        w.u8(5);
        encode_expr_payload(w, lean_ctor_get(value, 0));
        encode_expr_payload(w, lean_ctor_get(value, 1));
        break;
    case expr_kind::Lambda:
        w.u8(6);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        encode_expr_payload(w, lean_ctor_get(value, 1));
        encode_expr_payload(w, lean_ctor_get(value, 2));
        w.u8(expr_scalar_u8(value, 3));
        break;
    case expr_kind::Pi:
        w.u8(7);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        encode_expr_payload(w, lean_ctor_get(value, 1));
        encode_expr_payload(w, lean_ctor_get(value, 2));
        w.u8(expr_scalar_u8(value, 3));
        break;
    case expr_kind::Let:
        w.u8(8);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        encode_expr_payload(w, lean_ctor_get(value, 1));
        encode_expr_payload(w, lean_ctor_get(value, 2));
        encode_expr_payload(w, lean_ctor_get(value, 3));
        w.u8(expr_scalar_u8(value, 4));
        break;
    case expr_kind::Lit:
        w.u8(9);
        encode_literal(w, lean_ctor_get(value, 0));
        break;
    case expr_kind::MData:
        w.u8(10);
        encode_expr_payload(w, lean_ctor_get(value, 1));
        break;
    case expr_kind::Proj:
        w.u8(11);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        w.string(nat_to_decimal(lean_ctor_get(value, 1)));
        encode_expr_payload(w, lean_ctor_get(value, 2));
        break;
    }
}

static object * scalar_field_as_object(
    uint32_t scalar_base,
    vir_type const & field_type,
    vir_field_layout const & layout,
    object * value) {
    uint32_t offset = scalar_base + layout.offset;
    switch (field_type.tag) {
    case vir_wire_type::Bool:
    case vir_wire_type::UInt8:
        return lean_box(lean_ctor_get_uint8(value, offset));
    case vir_wire_type::UInt16:
        return lean_box(lean_ctor_get_uint16(value, offset));
    case vir_wire_type::UInt32:
        return lean_box_uint32(lean_ctor_get_uint32(value, offset));
    case vir_wire_type::UInt64:
        return lean_box_uint64(lean_ctor_get_uint64(value, offset));
    case vir_wire_type::Float:
        return lean_box_float(lean_ctor_get_float(value, offset));
    case vir_wire_type::Float32:
        return lean_box_float32(lean_ctor_get_float32(value, offset));
    case vir_wire_type::SimpleEnum:
        if (layout.size == 1) return lean_box(lean_ctor_get_uint8(value, offset));
        if (layout.size == 2) return lean_box(lean_ctor_get_uint16(value, offset));
        if (layout.size == 4) return lean_box(lean_ctor_get_uint32(value, offset));
        if (layout.size == 8) return lean_box_uint64(lean_ctor_get_uint64(value, offset));
        return lean_box(0);
    default:
        return lean_box(0);
    }
}

static object * ctor_field_as_object(
    uint32_t scalar_base,
    vir_type const & field_type,
    vir_field_layout const & layout,
    object * value,
    bool & borrowed) {
    switch (layout.kind) {
    case vir_field_layout_kind::Object:
        borrowed = true;
        return lean_ctor_get(value, layout.index);
    case vir_field_layout_kind::USize:
        borrowed = false;
        return lean_box_usize(lean_ctor_get_usize(value, layout.index));
    case vir_field_layout_kind::Scalar:
        borrowed = false;
        return scalar_field_as_object(scalar_base, field_type, layout, value);
    }
    borrowed = false;
    return lean_box(0);
}

void encode_value_payload(vir_writer & w, vir_type const & type, object * value, vir_type const * self_type) {
    switch (type.tag) {
    case vir_wire_type::RecursiveSelf:
        if (self_type != nullptr) {
            encode_value_payload(w, *self_type, value, self_type);
        }
        break;
    case vir_wire_type::Unit:
        (void)w;
        (void)value;
        break;
    case vir_wire_type::Nat:
        encode_nat_payload(w, value);
        break;
    case vir_wire_type::Int:
        w.string(int_to_decimal(value));
        break;
    case vir_wire_type::Bool:
        w.u8(lean_unbox(value) ? 1 : 0);
        break;
    case vir_wire_type::String:
        encode_string_payload(w, value);
        break;
    case vir_wire_type::UInt8:
        w.u8(static_cast<uint8_t>(lean_unbox(value)));
        break;
    case vir_wire_type::UInt16:
        w.u32(static_cast<uint32_t>(lean_unbox(value)));
        break;
    case vir_wire_type::UInt32:
        w.u32(lean_unbox_uint32(value));
        break;
    case vir_wire_type::Resource: {
        uint32_t root_id = resource_root_id_for_object(value, w);
        if (w.ok) {
            vir_resource_push(vir_resource_get(root_id));
        }
        break;
    }
    case vir_wire_type::Function: {
        vir_writer signature_writer;
        encode_function_signature(signature_writer, type);
        if (!signature_writer.ok) {
            w.fail(signature_writer.error());
            break;
        }
        std::string signature_bytes = signature_writer.take();
        uint32_t root_id = vir_closure_root_with_signature(
            value,
            signature_bytes.data(),
            static_cast<uint32_t>(signature_bytes.size()),
            type.is_io ? 1 : 0);
        if (root_id == 0) {
            w.fail("missing Lean closure value");
        } else {
            vir_closure_push(root_id);
        }
        break;
    }
    case vir_wire_type::UInt64:
        w.string(std::to_string(lean_unbox_uint64(value)));
        break;
    case vir_wire_type::USize:
        w.string(std::to_string(lean_unbox_usize(value)));
        break;
    case vir_wire_type::ByteArray:
        w.bytes(lean_sarray_cptr(value), static_cast<uint32_t>(lean_sarray_size(value)));
        break;
    case vir_wire_type::Float:
        w.f64(lean_unbox_float(value));
        break;
    case vir_wire_type::Float32:
        w.f32(lean_unbox_float32(value));
        break;
    case vir_wire_type::Array: {
        uint32_t len = static_cast<uint32_t>(lean_array_size(value));
        w.u32(len);
        for (uint32_t i = 0; i < len; i++) {
            encode_value_payload(w, type.args[0], lean_array_get_core(value, i), self_type);
        }
        break;
    }
    case vir_wire_type::List: {
        std::vector<object *> values;
        object * cursor = value;
        while (!lean_is_scalar(cursor)) {
            values.push_back(lean_ctor_get(cursor, 0));
            cursor = lean_ctor_get(cursor, 1);
        }
        w.u32(static_cast<uint32_t>(values.size()));
        for (object * elem : values) {
            encode_value_payload(w, type.args[0], elem, self_type);
        }
        break;
    }
    case vir_wire_type::Option:
        if (lean_is_scalar(value)) {
            w.u8(0);
        } else {
            w.u8(1);
            encode_value_payload(w, type.args[0], lean_ctor_get(value, 0), self_type);
        }
        break;
    case vir_wire_type::Prod:
        encode_value_payload(w, type.args[0], lean_ctor_get(value, 0), self_type);
        encode_value_payload(w, type.args[1], lean_ctor_get(value, 1), self_type);
        break;
    case vir_wire_type::Structure:
        if (type.trivial_field != UINT32_MAX) {
            encode_value_payload(w, type.args[type.trivial_field], value, &type);
            break;
        }
        for (size_t i = 0; i < type.args.size(); i++) {
            bool borrowed = false;
            object * field = ctor_field_as_object(
                structure_scalar_base(type),
                type.args[i],
                type.field_layouts[i],
                value,
                borrowed);
            encode_value_payload(w, type.args[i], field, &type);
            if (!borrowed) lean_dec(field);
        }
        break;
    case vir_wire_type::TaggedUnion: {
        uint32_t tag = lean_obj_tag(value);
        if (tag >= type.variants.size()) {
            w.u32(tag);
            break;
        }
        vir_variant const & variant = type.variants[tag];
        w.u32(tag);
        bool borrowed = false;
        object * field = ctor_field_as_object(
            variant_scalar_base(variant),
            variant.fields[0],
            variant.field_layouts[0],
            value,
            borrowed);
        encode_value_payload(w, variant.fields[0], field, self_type);
        if (!borrowed) lean_dec(field);
        break;
    }
    case vir_wire_type::CustomInductive: {
        uint32_t tag = static_cast<uint32_t>(lean_is_scalar(value) ? lean_unbox(value) : lean_obj_tag(value));
        if (tag >= type.variants.size()) {
            w.u32(tag);
            break;
        }
        vir_variant const & variant = type.variants[tag];
        w.u32(tag);
        if (variant.fields.empty()) {
            break;
        }
        for (size_t i = 0; i < variant.fields.size(); i++) {
            bool borrowed = false;
            object * field = ctor_field_as_object(
                variant_scalar_base(variant),
                variant.fields[i],
                variant.field_layouts[i],
                value,
                borrowed);
            encode_value_payload(w, variant.fields[i], field, &type);
            if (!borrowed) lean_dec(field);
        }
        break;
    }
    case vir_wire_type::SimpleEnum:
        w.u32(static_cast<uint32_t>(lean_is_scalar(value) ? lean_unbox(value) : lean_obj_tag(value)));
        break;
    case vir_wire_type::Expr:
        encode_expr_payload(w, value);
        break;
    default:
        break;
    }
}

static void encode_function_signature(vir_writer & w, vir_type const & type) {
    if (type.tag != vir_wire_type::Function || type.args.empty()) {
        w.fail("function wire type is missing a result type");
        return;
    }
    w.u32(static_cast<uint32_t>(type.args.size() - 1));
    for (size_t i = 0; i + 1 < type.args.size(); i++) {
        encode_type(w, type.args[i]);
    }
    encode_type(w, type.args.back());
}

void encode_result_payload(vir_writer & w, vir_type const & type, object * value, bool has_boxed_decl) {
    vir_type const * unboxed_type = nullptr;
    if (!has_boxed_decl && is_unboxed_call_boundary_type(type, &unboxed_type)) {
        encode_unboxed_call_result(w, *unboxed_type, value);
    } else {
        encode_value_payload(w, type, value);
    }
}

bool call_result_is_owned(vir_type const & type, bool has_boxed_decl) {
    vir_type const * unboxed_type = nullptr;
    return has_boxed_decl || !is_unboxed_call_boundary_type(type, &unboxed_type);
}

name name_from_dotted(char const * text, size_t len) {
    name current;
    size_t start = 0;
    while (start <= len) {
        size_t end = start;
        while (end < len && text[end] != '.') {
            end++;
        }
        if (end > start) {
            std::string part(text + start, end - start);
            current = name(current, part.c_str());
        }
        if (end == len) {
            break;
        }
        start = end + 1;
    }
    return current;
}

} // namespace lean
