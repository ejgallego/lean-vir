/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"
#include "interface_codec.h"
#include "signature_cache.h"

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

#include "library/elab_environment.h"
#include "library/ir_interpreter.h"
#include "runtime/io.h"
#include "runtime/object.h"
#include "util/name.h"

extern "C" {
extern lean_object * l_ByteArray_empty;
char const * vir_js_call(uint32_t slot, uint8_t const * request, uint32_t request_len);
uint32_t vir_js_call_result_size(void);
}

namespace lean {
namespace {

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

static object * mk_some(object * value) {
    return mk_ctor(1, { value });
}

static void ensure_ir_interpreter_initialized() {
    static bool initialized = false;
    if (!initialized) {
        initialize_ir_interpreter();
        l_ByteArray_empty = lean_mk_empty_byte_array(lean_box(0));
        lean_mark_persistent(l_ByteArray_empty);
        initialized = true;
    }
}

static object * decode_host_result(vir_type const & expected, char const * bytes, uint32_t size) {
    vir_reader reader(reinterpret_cast<uint8_t const *>(bytes), size);
    object * value = decode_value(reader, expected);
    if (!reader.ok || !reader.at_end()) {
        lean_dec(value);
        return lean_box(0);
    }
    return value;
}

static object * call_js_import(uint32_t slot, uint32_t argc, object ** args) {
    host_signature const * signature = cached_host_signature(slot);
    uint32_t erased_prefix_args = vir::host_import_erased_prefix_args(slot);
    if (!signature->ok) {
        for (uint32_t i = 0; i < argc; i++) {
            lean_dec(args[i]);
        }
        return vir::host_import_is_io(slot) ? lean_io_result_mk_ok(lean_box(0)) : lean_box(0);
    }
    if (argc < erased_prefix_args || signature->args.size() > argc - erased_prefix_args) {
        for (uint32_t i = 0; i < argc; i++) {
            lean_dec(args[i]);
        }
        return vir::host_import_is_io(slot) ? lean_io_result_mk_ok(lean_box(0)) : lean_box(0);
    }
    vir_writer request;
    request.u32(static_cast<uint32_t>(signature->args.size()));
    for (size_t i = 0; i < signature->args.size(); i++) {
        encode_value_payload(request, signature->args[i], args[erased_prefix_args + i]);
    }
    if (!request.ok) {
        for (uint32_t i = 0; i < argc; i++) {
            lean_dec(args[i]);
        }
        return vir::host_import_is_io(slot) ? lean_io_result_mk_ok(lean_box(0)) : lean_box(0);
    }
    std::string request_bytes = request.take();
    char const * result_bytes = vir_js_call(
        slot,
        reinterpret_cast<uint8_t const *>(request_bytes.data()),
        static_cast<uint32_t>(request_bytes.size()));
    uint32_t result_size = vir_js_call_result_size();
    object * value = decode_host_result(signature->result, result_bytes, result_size);
    if (result_bytes != nullptr) {
        vir_free_bytes(const_cast<char *>(result_bytes));
    }
    for (uint32_t i = 0; i < argc; i++) {
        lean_dec(args[i]);
    }
    if (signature->is_io) {
        return lean_io_result_mk_ok(value);
    }
    return value;
}

#define VIR_JS_TRAMPOLINES_FOR_SLOT(SLOT) \
extern "C" object * vir_js_import_slot_##SLOT##_0(void) { \
    return call_js_import(SLOT, 0, nullptr); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_1(object * a0) { \
    object * args[] = { a0 }; \
    return call_js_import(SLOT, 1, args); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_2(object * a0, object * a1) { \
    object * args[] = { a0, a1 }; \
    return call_js_import(SLOT, 2, args); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_3(object * a0, object * a1, object * a2) { \
    object * args[] = { a0, a1, a2 }; \
    return call_js_import(SLOT, 3, args); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_4(object * a0, object * a1, object * a2, object * a3) { \
    object * args[] = { a0, a1, a2, a3 }; \
    return call_js_import(SLOT, 4, args); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_5(object * a0, object * a1, object * a2, object * a3, object * a4) { \
    object * args[] = { a0, a1, a2, a3, a4 }; \
    return call_js_import(SLOT, 5, args); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_6(object * a0, object * a1, object * a2, object * a3, object * a4, object * a5) { \
    object * args[] = { a0, a1, a2, a3, a4, a5 }; \
    return call_js_import(SLOT, 6, args); \
}

VIR_JS_TRAMPOLINES_FOR_SLOT(0)
VIR_JS_TRAMPOLINES_FOR_SLOT(1)
VIR_JS_TRAMPOLINES_FOR_SLOT(2)
VIR_JS_TRAMPOLINES_FOR_SLOT(3)
VIR_JS_TRAMPOLINES_FOR_SLOT(4)
VIR_JS_TRAMPOLINES_FOR_SLOT(5)
VIR_JS_TRAMPOLINES_FOR_SLOT(6)
VIR_JS_TRAMPOLINES_FOR_SLOT(7)
VIR_JS_TRAMPOLINES_FOR_SLOT(8)
VIR_JS_TRAMPOLINES_FOR_SLOT(9)
VIR_JS_TRAMPOLINES_FOR_SLOT(10)
VIR_JS_TRAMPOLINES_FOR_SLOT(11)
VIR_JS_TRAMPOLINES_FOR_SLOT(12)
VIR_JS_TRAMPOLINES_FOR_SLOT(13)
VIR_JS_TRAMPOLINES_FOR_SLOT(14)
VIR_JS_TRAMPOLINES_FOR_SLOT(15)
VIR_JS_TRAMPOLINES_FOR_SLOT(16)
VIR_JS_TRAMPOLINES_FOR_SLOT(17)
VIR_JS_TRAMPOLINES_FOR_SLOT(18)
VIR_JS_TRAMPOLINES_FOR_SLOT(19)
VIR_JS_TRAMPOLINES_FOR_SLOT(20)
VIR_JS_TRAMPOLINES_FOR_SLOT(21)
VIR_JS_TRAMPOLINES_FOR_SLOT(22)
VIR_JS_TRAMPOLINES_FOR_SLOT(23)
VIR_JS_TRAMPOLINES_FOR_SLOT(24)
VIR_JS_TRAMPOLINES_FOR_SLOT(25)
VIR_JS_TRAMPOLINES_FOR_SLOT(26)
VIR_JS_TRAMPOLINES_FOR_SLOT(27)
VIR_JS_TRAMPOLINES_FOR_SLOT(28)
VIR_JS_TRAMPOLINES_FOR_SLOT(29)
VIR_JS_TRAMPOLINES_FOR_SLOT(30)
VIR_JS_TRAMPOLINES_FOR_SLOT(31)
VIR_JS_TRAMPOLINES_FOR_SLOT(32)
VIR_JS_TRAMPOLINES_FOR_SLOT(33)
VIR_JS_TRAMPOLINES_FOR_SLOT(34)
VIR_JS_TRAMPOLINES_FOR_SLOT(35)
VIR_JS_TRAMPOLINES_FOR_SLOT(36)
VIR_JS_TRAMPOLINES_FOR_SLOT(37)
VIR_JS_TRAMPOLINES_FOR_SLOT(38)
VIR_JS_TRAMPOLINES_FOR_SLOT(39)
VIR_JS_TRAMPOLINES_FOR_SLOT(40)
VIR_JS_TRAMPOLINES_FOR_SLOT(41)
VIR_JS_TRAMPOLINES_FOR_SLOT(42)
VIR_JS_TRAMPOLINES_FOR_SLOT(43)
VIR_JS_TRAMPOLINES_FOR_SLOT(44)
VIR_JS_TRAMPOLINES_FOR_SLOT(45)
VIR_JS_TRAMPOLINES_FOR_SLOT(46)
VIR_JS_TRAMPOLINES_FOR_SLOT(47)
VIR_JS_TRAMPOLINES_FOR_SLOT(48)
VIR_JS_TRAMPOLINES_FOR_SLOT(49)
VIR_JS_TRAMPOLINES_FOR_SLOT(50)
VIR_JS_TRAMPOLINES_FOR_SLOT(51)
VIR_JS_TRAMPOLINES_FOR_SLOT(52)
VIR_JS_TRAMPOLINES_FOR_SLOT(53)
VIR_JS_TRAMPOLINES_FOR_SLOT(54)
VIR_JS_TRAMPOLINES_FOR_SLOT(55)
VIR_JS_TRAMPOLINES_FOR_SLOT(56)
VIR_JS_TRAMPOLINES_FOR_SLOT(57)
VIR_JS_TRAMPOLINES_FOR_SLOT(58)
VIR_JS_TRAMPOLINES_FOR_SLOT(59)
VIR_JS_TRAMPOLINES_FOR_SLOT(60)
VIR_JS_TRAMPOLINES_FOR_SLOT(61)
VIR_JS_TRAMPOLINES_FOR_SLOT(62)
VIR_JS_TRAMPOLINES_FOR_SLOT(63)

#undef VIR_JS_TRAMPOLINES_FOR_SLOT

#define VIR_JS_TRAMPOLINE_CASE(SLOT, ARITY) \
    if (slot == SLOT && arity == ARITY) { \
        return reinterpret_cast<void *>(vir_js_import_slot_##SLOT##_##ARITY); \
    }

#define VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(SLOT) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 0) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 1) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 2) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 3) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 4) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 5) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 6)

static void * host_import_trampoline_for(uint32_t slot, uint32_t arity) {
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(0)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(1)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(2)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(3)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(4)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(5)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(6)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(7)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(8)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(9)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(10)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(11)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(12)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(13)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(14)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(15)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(16)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(17)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(18)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(19)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(20)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(21)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(22)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(23)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(24)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(25)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(26)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(27)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(28)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(29)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(30)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(31)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(32)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(33)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(34)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(35)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(36)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(37)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(38)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(39)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(40)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(41)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(42)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(43)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(44)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(45)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(46)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(47)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(48)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(49)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(50)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(51)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(52)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(53)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(54)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(55)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(56)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(57)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(58)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(59)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(60)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(61)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(62)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(63)
    return nullptr;
}

#undef VIR_JS_TRAMPOLINE_CASES_FOR_SLOT
#undef VIR_JS_TRAMPOLINE_CASE

static std::string g_call_result;
static std::string g_call_error;
static uint32_t g_direct_u32_result = 0;
struct closure_root {
    object * value = nullptr;
    host_signature signature;
};

static std::vector<closure_root> g_closure_roots;
static std::vector<uint32_t> g_free_closure_root_ids;
static std::string g_closure_call_result;
static std::string g_closure_call_error;

static closure_root * closure_root_for_id(uint32_t root_id) {
    if (root_id == 0 || root_id > g_closure_roots.size()) {
        return nullptr;
    }
    closure_root & root = g_closure_roots[root_id - 1];
    return root.value == nullptr ? nullptr : &root;
}

extern "C" uint32_t vir_closure_root_with_signature(
    object * value,
    char const * signature_bytes,
    uint32_t signature_len,
    uint8_t is_io) {
    if (value == nullptr) {
        return 0;
    }
    host_signature signature = decode_signature_bytes(
        signature_bytes,
        signature_len,
        is_io != 0,
        "missing closure signature",
        "trailing bytes after closure signature");
    if (!signature.ok) {
        return 0;
    }
    lean_inc(value);
    if (!g_free_closure_root_ids.empty()) {
        uint32_t root_id = g_free_closure_root_ids.back();
        g_free_closure_root_ids.pop_back();
        g_closure_roots[root_id - 1] = { value, std::move(signature) };
        return root_id;
    }
    g_closure_roots.push_back({ value, std::move(signature) });
    return static_cast<uint32_t>(g_closure_roots.size());
}

extern "C" uint32_t vir_closure_release(uint32_t root_id) {
    closure_root * root = closure_root_for_id(root_id);
    if (root == nullptr) {
        return 0;
    }
    object * value = root->value;
    g_closure_roots[root_id - 1] = {};
    g_free_closure_root_ids.push_back(root_id);
    lean_dec(value);
    return 1;
}

static void cleanup_closure_call_args(std::vector<object *> const & args) {
    for (object * arg : args) {
        lean_dec(arg);
    }
}

extern "C" char const * vir_closure_call(uint32_t root_id, uint8_t const * request, uint32_t request_len) {
    g_closure_call_result.clear();
    g_closure_call_error.clear();
    if (request == nullptr && request_len != 0) {
        g_closure_call_error = "closure call payload pointer is null";
        return nullptr;
    }
    closure_root * root = closure_root_for_id(root_id);
    if (root == nullptr) {
        g_closure_call_error = "closure root id is not live";
        return nullptr;
    }
    object * fn = root->value;
    host_signature const & signature = root->signature;

    vir_reader reader(request, request_len);
    uint32_t argc = reader.u32();
    if (argc != signature.args.size()) {
        g_closure_call_error =
            "closure argument count mismatch: signature expects " +
            std::to_string(signature.args.size()) +
            ", got " + std::to_string(argc);
        return nullptr;
    }
    std::vector<object *> args;
    args.reserve(argc + 1);
    for (uint32_t i = 0; i < argc; i++) {
        args.push_back(decode_value(reader, signature.args[i]));
    }
    if (!reader.ok) {
        cleanup_closure_call_args(args);
        g_closure_call_error = reader.error();
        return nullptr;
    }
    if (!reader.at_end()) {
        cleanup_closure_call_args(args);
        g_closure_call_error = "trailing bytes after closure call payload";
        return nullptr;
    }

    lean_inc(fn);
    if (signature.is_io) {
        args.push_back(lean_io_mk_world());
    }
    object * result = apply_n(fn, static_cast<unsigned>(args.size()), args.data());
    if (signature.is_io) {
        if (!lean_io_result_is_ok(result)) {
            lean_dec(result);
            g_closure_call_error = "IO callback failed";
            return nullptr;
        }
        result = lean_io_result_take_value(result);
    }
    vir_writer writer;
    encode_result_payload(writer, signature.result, result, true);
    if (!writer.ok) {
        lean_dec(result);
        g_closure_call_error = writer.error();
        return nullptr;
    }
    lean_dec(result);
    g_closure_call_result = writer.take();
    return g_closure_call_result.data();
}

extern "C" uint32_t vir_closure_call_result_size(void) {
    return static_cast<uint32_t>(g_closure_call_result.size());
}

extern "C" char const * vir_closure_call_error(void) {
    return g_closure_call_error.c_str();
}

extern "C" uint32_t vir_closure_call_error_size(void) {
    return static_cast<uint32_t>(g_closure_call_error.size());
}



} // namespace

namespace vir {

void * host_import_trampoline(char const * symbol) {
    int32_t slot = host_import_slot_for_symbol(symbol);
    if (slot < 0) {
        return nullptr;
    }
    return host_import_trampoline_for(
        static_cast<uint32_t>(slot),
        host_import_arity(static_cast<uint32_t>(slot)));
}

} // namespace vir


} // namespace lean

extern "C" void vir_ensure_ir_interpreter_initialized(void) {
    lean::ensure_ir_interpreter_initialized();
}

extern "C" lean::object * lean_ir_find_env_decl(lean::object *, lean::object * n) {
    if (lean::object * decl = lean::vir::find_package_decl(n)) {
        return lean::mk_some(decl);
    }
    return lean_box(0);
}

extern "C" lean::object * lean_ir_find_env_decl_boxed(lean::object *, lean::object * n) {
    if (lean::object * decl = lean::vir::find_package_boxed_decl(n)) {
        return lean::mk_some(decl);
    }
    return lean_box(0);
}

extern "C" uint32_t vir_upstream_target_pointer_bytes(void) {
    return sizeof(void *);
}

static void cleanup_call_args(std::vector<lean::vir_arg> const & args) {
    for (lean::vir_arg const & arg : args) {
        if (arg.owned) lean_dec(arg.value);
    }
}

static uint8_t decode_call_effect(lean::vir_reader & reader) {
    uint8_t effect = 0;
    if (reader.ok && !reader.at_end()) {
        effect = reader.u8();
        if (effect > 1) {
            reader.fail("unsupported call effect tag " + std::to_string(effect));
        }
    }
    return effect;
}

static lean::object * run_package_function(
    lean::name const & fn,
    size_t argc,
    lean::object ** args) {
    lean::ensure_ir_interpreter_initialized();
    lean::elab_environment env(lean_box(0));
    lean::options opts(lean_box(0));
    return lean::ir::run_boxed(env, opts, fn, argc, args);
}

static lean::object * run_package_function(
    lean::object * fn_obj,
    size_t argc,
    lean::object ** args) {
    lean::name fn(fn_obj, true);
    return run_package_function(fn, argc, args);
}

static char const * run_decoded_call(
    lean::name const & fn,
    bool has_boxed_decl,
    lean::vir_type const & result_type,
    uint8_t effect,
    std::vector<lean::object *> & args,
    bool value_only_result) {
    if (effect == 1) {
        args.push_back(lean_io_mk_world());
    }
    lean::object * result = run_package_function(fn, args.size(), args.data());
    if (effect == 1) {
        if (!lean_io_result_is_ok(result)) {
            lean_dec(result);
            lean::g_call_error = "IO action failed";
            return nullptr;
        }
        result = lean_io_result_take_value(result);
    }
    lean::vir_writer writer;
    if (value_only_result) {
        lean::encode_result_payload(writer, result_type, result, has_boxed_decl);
    } else {
        lean::encode_result(writer, result_type, result, has_boxed_decl);
    }
    if (!writer.ok) {
        if (lean::call_result_is_owned(result_type, has_boxed_decl)) {
            lean_dec(result);
        }
        lean::g_call_error = writer.error();
        return nullptr;
    }
    if (lean::call_result_is_owned(result_type, has_boxed_decl)) {
        lean_dec(result);
    }
    lean::g_call_result = writer.take();
    return lean::g_call_result.data();
}

static char const * vir_call_descriptor_core(
    lean::name const & fn,
    bool has_boxed_decl,
    uint8_t const * request,
    uint32_t request_len) {
    lean::vir_reader reader(request, request_len);
    uint32_t argc = reader.u32();
    std::vector<lean::vir_arg> decoded_args;
    std::vector<lean::object *> args;
    decoded_args.reserve(argc);
    args.reserve(argc);
    for (uint32_t i = 0; i < argc; i++) {
        decoded_args.push_back(lean::decode_argument(reader, has_boxed_decl));
        args.push_back(decoded_args.back().value);
    }
    lean::vir_type result_type = lean::decode_type(reader);
    uint8_t effect = decode_call_effect(reader);
    if (!reader.ok) {
        lean::g_call_error = reader.error();
        cleanup_call_args(decoded_args);
        return nullptr;
    }
    if (!has_boxed_decl && lean::needs_boxed_wasm32_call_boundary_type(result_type)) {
        lean::g_call_error = "top-level Float, Float32, UInt64, and trivial wrappers over them require a boxed declaration at the wasm32 interpreter boundary";
        cleanup_call_args(decoded_args);
        return nullptr;
    }
    if (!reader.at_end()) {
        lean::g_call_error = "trailing bytes after call payload";
        cleanup_call_args(decoded_args);
        return nullptr;
    }
    return run_decoded_call(fn, has_boxed_decl, result_type, effect, args, false);
}

static char const * vir_call_resolved_core(
    lean::name const & fn,
    bool has_boxed_decl,
    uint8_t const * request,
    uint32_t request_len,
    lean::host_signature const & signature) {
    if (!signature.ok) {
        lean::g_call_error = signature.error;
        return nullptr;
    }
    lean::vir_reader reader(request, request_len);
    uint32_t argc = reader.u32();
    if (argc != signature.args.size()) {
        lean::g_call_error =
            "call argument count mismatch: package signature expects " +
            std::to_string(signature.args.size()) +
            ", got " + std::to_string(argc);
        return nullptr;
    }
    std::vector<lean::vir_arg> decoded_args;
    std::vector<lean::object *> args;
    decoded_args.reserve(argc);
    args.reserve(argc);
    for (uint32_t i = 0; i < argc; i++) {
        decoded_args.push_back(lean::decode_argument_payload(reader, signature.args[i], has_boxed_decl));
        args.push_back(decoded_args.back().value);
    }
    if (!reader.ok) {
        lean::g_call_error = reader.error();
        cleanup_call_args(decoded_args);
        return nullptr;
    }
    if (!has_boxed_decl && lean::needs_boxed_wasm32_call_boundary_type(signature.result)) {
        lean::g_call_error = "top-level Float, Float32, UInt64, and trivial wrappers over them require a boxed declaration at the wasm32 interpreter boundary";
        cleanup_call_args(decoded_args);
        return nullptr;
    }
    if (!reader.at_end()) {
        lean::g_call_error = "trailing bytes after call payload";
        cleanup_call_args(decoded_args);
        return nullptr;
    }
    return run_decoded_call(
        fn,
        has_boxed_decl,
        signature.result,
        signature.is_io ? 1 : 0,
        args,
        true);
}

extern "C" uint32_t vir_resolve_call(char const * name_text, uint32_t name_len) {
    lean::g_call_error.clear();
    if (name_text == nullptr) {
        lean::g_call_error = "call name pointer is null";
        return 0;
    }
    if (!lean::vir::package_loaded()) {
        lean::g_call_error = "no IR package has been loaded";
        return 0;
    }

    lean::name fn = lean::name_from_dotted(name_text, name_len);
    uint32_t slot = lean::vir::package_call_slot_for_name(fn.to_obj_arg());
    if (slot == 0) {
        lean::g_call_error = "call entry not found";
    }
    return slot;
}

extern "C" char const * vir_call(
    char const * name_text,
    uint32_t name_len,
    uint8_t const * request,
    uint32_t request_len,
    uint8_t result_tag) {
    lean::g_call_result.clear();
    lean::g_call_error.clear();
    if (name_text == nullptr) {
        lean::g_call_error = "call name pointer is null";
        return nullptr;
    }
    if (request == nullptr && request_len != 0) {
        lean::g_call_error = "call payload pointer is null";
        return nullptr;
    }
    if (!lean::vir::package_loaded()) {
        lean::g_call_error = "no IR package has been loaded";
        return nullptr;
    }

    lean::name fn = lean::name_from_dotted(name_text, name_len);
    bool has_boxed_decl = lean::vir::find_package_boxed_decl(fn.to_obj_arg()) != nullptr;
    (void) result_tag;
    return vir_call_descriptor_core(fn, has_boxed_decl, request, request_len);
}

extern "C" char const * vir_call_resolved(
    uint32_t call_slot,
    uint8_t const * request,
    uint32_t request_len,
    uint8_t result_tag) {
    lean::g_call_result.clear();
    lean::g_call_error.clear();
    if (request == nullptr && request_len != 0) {
        lean::g_call_error = "call payload pointer is null";
        return nullptr;
    }
    if (!lean::vir::package_loaded()) {
        lean::g_call_error = "no IR package has been loaded";
        return nullptr;
    }

    lean::object * fn_obj = lean::vir::package_call_slot_name(call_slot);
    if (fn_obj == nullptr) {
        lean::g_call_error = "call slot is not registered";
        return nullptr;
    }
    lean::name fn(fn_obj, true);
    bool has_boxed_decl = lean::vir::package_call_slot_has_boxed_decl(call_slot);
    lean::host_signature const * signature = lean::cached_package_call_signature(call_slot);
    if (signature == nullptr) {
        lean::g_call_error = "resolved call requires a package-owned call signature";
        return nullptr;
    }
    (void) result_tag;
    return vir_call_resolved_core(fn, has_boxed_decl, request, request_len, *signature);
}

static void cleanup_object_call_args(uint32_t argc, lean::object ** args) {
    if (args == nullptr) {
        return;
    }
    for (uint32_t i = 0; i < argc; i++) {
        lean_dec(args[i]);
    }
}

extern "C" lean::object * vir_call_resolved_objects(
    uint32_t call_slot,
    lean::object ** argv,
    uint32_t argc) {
    lean::g_call_result.clear();
    lean::g_call_error.clear();
    lean::g_direct_u32_result = 0;
    if (argv == nullptr && argc != 0) {
        lean::g_call_error = "object call argv pointer is null";
        return nullptr;
    }
    if (!lean::vir::package_loaded()) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error = "no IR package has been loaded";
        return nullptr;
    }

    lean::object * fn_obj = lean::vir::package_call_slot_name(call_slot);
    if (fn_obj == nullptr) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error = "call slot is not registered";
        return nullptr;
    }
    if (!lean::vir::package_call_slot_has_boxed_decl(call_slot)) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error = "object call requires a boxed package declaration";
        return nullptr;
    }
    lean::host_signature const * signature = lean::cached_package_call_signature(call_slot);
    if (signature == nullptr) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error = "object call requires a package-owned call signature";
        return nullptr;
    }
    if (!signature->ok) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error = signature->error;
        return nullptr;
    }
    if (argc != signature->args.size()) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error =
            "object call argument count mismatch: package signature expects " +
            std::to_string(signature->args.size()) +
            ", got " + std::to_string(argc);
        return nullptr;
    }

    std::vector<lean::object *> args;
    args.reserve(argc + (signature->is_io ? 1 : 0));
    for (uint32_t i = 0; i < argc; i++) {
        args.push_back(argv[i]);
    }
    if (signature->is_io) {
        args.push_back(lean_io_mk_world());
    }
    lean::object * result = run_package_function(fn_obj, args.size(), args.data());
    if (signature->is_io) {
        if (!lean_io_result_is_ok(result)) {
            lean_dec(result);
            lean::g_call_error = "IO action failed";
            return nullptr;
        }
        result = lean_io_result_take_value(result);
    }
    return result;
}

static bool direct_call_header(
    uint32_t call_slot,
    char const * label,
    lean::object ** fn_obj,
    bool * has_boxed_decl,
    lean::host_signature const ** signature) {
    lean::g_call_result.clear();
    lean::g_call_error.clear();
    lean::g_direct_u32_result = 0;
    if (!lean::vir::package_loaded()) {
        lean::g_call_error = "no IR package has been loaded";
        return false;
    }
    *fn_obj = lean::vir::package_call_slot_name(call_slot);
    if (*fn_obj == nullptr) {
        lean::g_call_error = "call slot is not registered";
        return false;
    }
    *has_boxed_decl = lean::vir::package_call_slot_has_boxed_decl(call_slot);
    *signature = lean::cached_package_call_signature(call_slot);
    if (*signature == nullptr) {
        lean::g_call_error = std::string(label) + " requires a package-owned call signature";
        return false;
    }
    if (!(*signature)->ok) {
        lean::g_call_error = (*signature)->error;
        return false;
    }
    if ((*signature)->is_io) {
        lean::g_call_error = std::string(label) + " supports pure calls only";
        return false;
    }
    return true;
}

static bool direct_signature_1_1(
    lean::host_signature const & signature,
    lean::vir_wire_type arg,
    lean::vir_wire_type result,
    char const * label) {
    if (
        signature.args.size() != 1 ||
        signature.args[0].tag != arg ||
        signature.result.tag != result) {
        lean::g_call_error = std::string(label) + " signature mismatch";
        return false;
    }
    return true;
}

static bool direct_small_uint_type(lean::vir_wire_type tag) {
    return
        tag == lean::vir_wire_type::UInt8 ||
        tag == lean::vir_wire_type::UInt16 ||
        tag == lean::vir_wire_type::UInt32;
}

static lean::object * direct_small_uint_arg(lean::vir_wire_type tag, uint32_t value, bool has_boxed_decl) {
    uintptr_t raw = value;
    if (tag == lean::vir_wire_type::UInt8) raw = static_cast<uint8_t>(value);
    if (tag == lean::vir_wire_type::UInt16) raw = static_cast<uint16_t>(value);
    if (!has_boxed_decl) {
        return reinterpret_cast<lean::object *>(raw);
    }
    if (tag == lean::vir_wire_type::UInt32) {
        return lean_box_uint32(static_cast<uint32_t>(raw));
    }
    return lean_box(static_cast<unsigned>(raw));
}

static uint32_t direct_small_uint_result(lean::vir_wire_type tag, lean::object * value, bool has_boxed_decl) {
    uintptr_t raw = has_boxed_decl
        ? (tag == lean::vir_wire_type::UInt32 ? lean_unbox_uint32(value) : lean_unbox(value))
        : reinterpret_cast<uintptr_t>(value);
    if (tag == lean::vir_wire_type::UInt8) return static_cast<uint8_t>(raw);
    if (tag == lean::vir_wire_type::UInt16) return static_cast<uint16_t>(raw);
    return static_cast<uint32_t>(raw);
}

static lean::object * run_direct_resolved_call(
    lean::object * fn_obj,
    size_t argc,
    lean::object ** args) {
    return run_package_function(fn_obj, argc, args);
}

extern "C" uint32_t vir_call_resolved_unit_unit(uint32_t call_slot) {
    lean::object * fn_obj = nullptr;
    bool has_boxed_decl = false;
    lean::host_signature const * signature = nullptr;
    char const * label = "direct Unit -> Unit call";
    if (!direct_call_header(call_slot, label, &fn_obj, &has_boxed_decl, &signature)) {
        return 0;
    }
    if (!direct_signature_1_1(*signature, lean::vir_wire_type::Unit, lean::vir_wire_type::Unit, label)) {
        return 0;
    }
    lean::object * arg = lean_box(0);
    lean::object * args[] = { arg };
    lean::object * result = run_direct_resolved_call(fn_obj, 1, args);
    if (lean::call_result_is_owned(signature->result, has_boxed_decl)) {
        lean_dec(result);
    }
    return 1;
}

extern "C" uint32_t vir_call_resolved_bool_bool(uint32_t call_slot, uint32_t value) {
    lean::object * fn_obj = nullptr;
    bool has_boxed_decl = false;
    lean::host_signature const * signature = nullptr;
    char const * label = "direct Bool -> Bool call";
    if (!direct_call_header(call_slot, label, &fn_obj, &has_boxed_decl, &signature)) {
        return 0;
    }
    if (!direct_signature_1_1(*signature, lean::vir_wire_type::Bool, lean::vir_wire_type::Bool, label)) {
        return 0;
    }
    lean::object * arg = lean_box(value == 0 ? 0 : 1);
    lean::object * args[] = { arg };
    lean::object * result = run_direct_resolved_call(fn_obj, 1, args);
    lean::g_direct_u32_result = lean_unbox(result) == 0 ? 0 : 1;
    if (lean::call_result_is_owned(signature->result, has_boxed_decl)) {
        lean_dec(result);
    }
    return 1;
}

extern "C" uint32_t vir_call_resolved_u32_u32(uint32_t call_slot, uint32_t value) {
    lean::object * fn_obj = nullptr;
    bool has_boxed_decl = false;
    lean::host_signature const * signature = nullptr;
    char const * label = "direct unsigned scalar call";
    if (!direct_call_header(call_slot, label, &fn_obj, &has_boxed_decl, &signature)) {
        return 0;
    }
    if (
        signature->args.size() != 1 ||
        !direct_small_uint_type(signature->args[0].tag) ||
        signature->result.tag != signature->args[0].tag) {
        lean::g_call_error = std::string(label) + " signature mismatch";
        return 0;
    }
    lean::object * arg = direct_small_uint_arg(signature->args[0].tag, value, has_boxed_decl);
    lean::object * args[] = { arg };
    lean::object * result = run_direct_resolved_call(fn_obj, 1, args);
    lean::g_direct_u32_result = direct_small_uint_result(signature->result.tag, result, has_boxed_decl);
    if (lean::call_result_is_owned(signature->result, has_boxed_decl)) {
        lean_dec(result);
    }
    return 1;
}

extern "C" char const * vir_call_resolved_string_string(
    uint32_t call_slot,
    char const * text,
    uint32_t len) {
    lean::object * fn_obj = nullptr;
    bool has_boxed_decl = false;
    lean::host_signature const * signature = nullptr;
    char const * label = "direct String -> String call";
    if (text == nullptr && len != 0) {
        lean::g_call_result.clear();
        lean::g_call_error = "string argument pointer is null";
        lean::g_direct_u32_result = 0;
        return nullptr;
    }
    if (!direct_call_header(call_slot, label, &fn_obj, &has_boxed_decl, &signature)) {
        return nullptr;
    }
    if (!direct_signature_1_1(*signature, lean::vir_wire_type::String, lean::vir_wire_type::String, label)) {
        return nullptr;
    }
    lean::object * arg = lean_mk_string_from_bytes(text == nullptr ? "" : text, len);
    lean::object * args[] = { arg };
    lean::object * result = run_direct_resolved_call(fn_obj, 1, args);
    size_t size = lean_string_size(result);
    uint32_t out_len = static_cast<uint32_t>(size == 0 ? 0 : size - 1);
    lean::g_call_result.assign(lean_string_cstr(result), out_len);
    if (lean::call_result_is_owned(signature->result, has_boxed_decl)) {
        lean_dec(result);
    }
    return lean::g_call_result.data();
}

extern "C" uint32_t vir_call_direct_u32_result(void) {
    return lean::g_direct_u32_result;
}

extern "C" uint32_t vir_call_result_size(void) {
    return static_cast<uint32_t>(lean::g_call_result.size());
}

extern "C" char const * vir_call_error(void) {
    return lean::g_call_error.c_str();
}

extern "C" uint32_t vir_call_error_size(void) {
    return static_cast<uint32_t>(lean::g_call_error.size());
}
