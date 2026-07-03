/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"
#include "name_utils.h"
#include "signature_cache.h"

#include <stddef.h>
#include <stdint.h>

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

#include "library/elab_environment.h"
#include "library/ir_interpreter.h"
#include "runtime/io.h"
#include "runtime/object.h"

extern "C" {
extern lean_object * l_ByteArray_empty;
lean::object * vir_js_call_objects(uint32_t slot, lean::object ** argv, uint32_t argc);
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

static void cleanup_object_args(uint32_t argc, object ** args) {
    if (args == nullptr) {
        return;
    }
    for (uint32_t i = 0; i < argc; i++) {
        lean_dec(args[i]);
    }
}

static object * default_host_import_result(bool is_io) {
    return is_io ? lean_io_result_mk_ok(lean_box(0)) : lean_box(0);
}

static object * call_js_import(uint32_t slot, uint32_t argc, object ** args) {
    bool is_io = vir::host_import_is_io(slot);
    uint32_t arity = vir::host_import_arity(slot);
    uint32_t erased_prefix_args = vir::host_import_erased_prefix_args(slot);
    uint32_t effect_args = is_io ? 1 : 0;
    if (arity < erased_prefix_args || arity - erased_prefix_args < effect_args || argc != arity) {
        cleanup_object_args(argc, args);
        return default_host_import_result(is_io);
    }
    uint32_t js_argc = arity - erased_prefix_args - effect_args;
    object * value = vir_js_call_objects(
        slot,
        args == nullptr ? nullptr : args + erased_prefix_args,
        js_argc);
    if (value == nullptr) {
        value = lean_box(0);
    }
    cleanup_object_args(argc, args);
    if (is_io) {
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
VIR_JS_TRAMPOLINES_FOR_SLOT(64)
VIR_JS_TRAMPOLINES_FOR_SLOT(65)
VIR_JS_TRAMPOLINES_FOR_SLOT(66)
VIR_JS_TRAMPOLINES_FOR_SLOT(67)
VIR_JS_TRAMPOLINES_FOR_SLOT(68)
VIR_JS_TRAMPOLINES_FOR_SLOT(69)
VIR_JS_TRAMPOLINES_FOR_SLOT(70)
VIR_JS_TRAMPOLINES_FOR_SLOT(71)
VIR_JS_TRAMPOLINES_FOR_SLOT(72)
VIR_JS_TRAMPOLINES_FOR_SLOT(73)
VIR_JS_TRAMPOLINES_FOR_SLOT(74)
VIR_JS_TRAMPOLINES_FOR_SLOT(75)
VIR_JS_TRAMPOLINES_FOR_SLOT(76)
VIR_JS_TRAMPOLINES_FOR_SLOT(77)
VIR_JS_TRAMPOLINES_FOR_SLOT(78)
VIR_JS_TRAMPOLINES_FOR_SLOT(79)
VIR_JS_TRAMPOLINES_FOR_SLOT(80)
VIR_JS_TRAMPOLINES_FOR_SLOT(81)
VIR_JS_TRAMPOLINES_FOR_SLOT(82)
VIR_JS_TRAMPOLINES_FOR_SLOT(83)
VIR_JS_TRAMPOLINES_FOR_SLOT(84)
VIR_JS_TRAMPOLINES_FOR_SLOT(85)
VIR_JS_TRAMPOLINES_FOR_SLOT(86)
VIR_JS_TRAMPOLINES_FOR_SLOT(87)
VIR_JS_TRAMPOLINES_FOR_SLOT(88)
VIR_JS_TRAMPOLINES_FOR_SLOT(89)
VIR_JS_TRAMPOLINES_FOR_SLOT(90)
VIR_JS_TRAMPOLINES_FOR_SLOT(91)
VIR_JS_TRAMPOLINES_FOR_SLOT(92)
VIR_JS_TRAMPOLINES_FOR_SLOT(93)
VIR_JS_TRAMPOLINES_FOR_SLOT(94)
VIR_JS_TRAMPOLINES_FOR_SLOT(95)
VIR_JS_TRAMPOLINES_FOR_SLOT(96)
VIR_JS_TRAMPOLINES_FOR_SLOT(97)
VIR_JS_TRAMPOLINES_FOR_SLOT(98)
VIR_JS_TRAMPOLINES_FOR_SLOT(99)
VIR_JS_TRAMPOLINES_FOR_SLOT(100)
VIR_JS_TRAMPOLINES_FOR_SLOT(101)
VIR_JS_TRAMPOLINES_FOR_SLOT(102)
VIR_JS_TRAMPOLINES_FOR_SLOT(103)
VIR_JS_TRAMPOLINES_FOR_SLOT(104)
VIR_JS_TRAMPOLINES_FOR_SLOT(105)
VIR_JS_TRAMPOLINES_FOR_SLOT(106)
VIR_JS_TRAMPOLINES_FOR_SLOT(107)
VIR_JS_TRAMPOLINES_FOR_SLOT(108)
VIR_JS_TRAMPOLINES_FOR_SLOT(109)
VIR_JS_TRAMPOLINES_FOR_SLOT(110)
VIR_JS_TRAMPOLINES_FOR_SLOT(111)
VIR_JS_TRAMPOLINES_FOR_SLOT(112)
VIR_JS_TRAMPOLINES_FOR_SLOT(113)
VIR_JS_TRAMPOLINES_FOR_SLOT(114)
VIR_JS_TRAMPOLINES_FOR_SLOT(115)
VIR_JS_TRAMPOLINES_FOR_SLOT(116)
VIR_JS_TRAMPOLINES_FOR_SLOT(117)
VIR_JS_TRAMPOLINES_FOR_SLOT(118)
VIR_JS_TRAMPOLINES_FOR_SLOT(119)
VIR_JS_TRAMPOLINES_FOR_SLOT(120)
VIR_JS_TRAMPOLINES_FOR_SLOT(121)
VIR_JS_TRAMPOLINES_FOR_SLOT(122)
VIR_JS_TRAMPOLINES_FOR_SLOT(123)
VIR_JS_TRAMPOLINES_FOR_SLOT(124)
VIR_JS_TRAMPOLINES_FOR_SLOT(125)
VIR_JS_TRAMPOLINES_FOR_SLOT(126)
VIR_JS_TRAMPOLINES_FOR_SLOT(127)

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
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(64)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(65)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(66)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(67)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(68)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(69)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(70)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(71)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(72)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(73)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(74)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(75)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(76)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(77)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(78)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(79)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(80)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(81)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(82)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(83)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(84)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(85)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(86)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(87)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(88)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(89)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(90)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(91)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(92)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(93)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(94)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(95)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(96)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(97)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(98)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(99)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(100)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(101)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(102)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(103)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(104)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(105)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(106)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(107)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(108)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(109)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(110)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(111)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(112)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(113)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(114)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(115)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(116)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(117)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(118)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(119)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(120)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(121)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(122)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(123)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(124)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(125)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(126)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(127)
    return nullptr;
}

#undef VIR_JS_TRAMPOLINE_CASES_FOR_SLOT
#undef VIR_JS_TRAMPOLINE_CASE

static std::string g_call_error;
struct closure_root {
    object * value = nullptr;
    uint32_t arity = 0;
    bool is_io = false;
};

static std::vector<closure_root> g_closure_roots;
static std::vector<uint32_t> g_free_closure_root_ids;
static std::string g_closure_call_error;

static closure_root * closure_root_for_id(uint32_t root_id) {
    if (root_id == 0 || root_id > g_closure_roots.size()) {
        return nullptr;
    }
    closure_root & root = g_closure_roots[root_id - 1];
    return root.value == nullptr ? nullptr : &root;
}

extern "C" uint32_t vir_closure_root(
    object * value,
    uint32_t arity,
    uint8_t is_io) {
    if (value == nullptr) {
        return 0;
    }
    lean_inc(value);
    if (!g_free_closure_root_ids.empty()) {
        uint32_t root_id = g_free_closure_root_ids.back();
        g_free_closure_root_ids.pop_back();
        g_closure_roots[root_id - 1] = { value, arity, is_io != 0 };
        return root_id;
    }
    g_closure_roots.push_back({ value, arity, is_io != 0 });
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

extern "C" object * vir_closure_call_objects(uint32_t root_id, object ** argv, uint32_t argc) {
    g_closure_call_error.clear();
    if (argv == nullptr && argc != 0) {
        g_closure_call_error = "closure object argv pointer is null";
        return nullptr;
    }
    closure_root * root = closure_root_for_id(root_id);
    if (root == nullptr) {
        cleanup_object_args(argc, argv);
        g_closure_call_error = "closure root id is not live";
        return nullptr;
    }
    object * fn = root->value;
    if (argc != root->arity) {
        cleanup_object_args(argc, argv);
        g_closure_call_error =
            "closure argument count mismatch: expected " +
            std::to_string(root->arity) +
            ", got " + std::to_string(argc);
        return nullptr;
    }

    std::vector<object *> args;
    args.reserve(argc + (root->is_io ? 1 : 0));
    for (uint32_t i = 0; i < argc; i++) {
        args.push_back(argv[i]);
    }
    if (root->is_io) {
        args.push_back(lean_io_mk_world());
    }
    lean_inc(fn);
    object * result = apply_n(fn, static_cast<unsigned>(args.size()), args.data());
    if (root->is_io) {
        if (!lean_io_result_is_ok(result)) {
            lean_dec(result);
            g_closure_call_error = "IO callback failed";
            return nullptr;
        }
        result = lean_io_result_take_value(result);
    }
    return result;
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
    lean::g_call_error.clear();
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
    bool has_boxed_decl = lean::vir::package_call_slot_has_boxed_decl(call_slot);
    lean::package_call_signature const * signature = lean::cached_package_call_signature(call_slot);
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
    if (!has_boxed_decl && signature->needs_boxed_wasm32_boundary) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error = "object call requires a boxed package declaration for this signature";
        return nullptr;
    }
    if (argc != signature->arg_count) {
        cleanup_object_call_args(argc, argv);
        lean::g_call_error =
            "object call argument count mismatch: package signature expects " +
            std::to_string(signature->arg_count) +
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

extern "C" char const * vir_call_error(void) {
    return lean::g_call_error.c_str();
}

extern "C" uint32_t vir_call_error_size(void) {
    return static_cast<uint32_t>(lean::g_call_error.size());
}
