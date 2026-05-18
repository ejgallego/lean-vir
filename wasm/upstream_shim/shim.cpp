#include "decl_provider.h"

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <initializer_list>
#include <string>

#include "kernel/environment.h"
#include "kernel/expr.h"
#include "kernel/trace.h"
#include "library/elab_environment.h"
#include "library/init_attribute.h"
#include "library/ir_interpreter.h"
#include "library/time_task.h"
#include "runtime/io.h"
#include "runtime/object.h"
#include "util/name.h"
#include "util/option_declarations.h"
#include "util/options.h"

extern "C" lean_object * lean_nat_add___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_nat_add(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_nat_sub___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_nat_sub(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_nat_dec_eq___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_nat_dec_eq(a, b);
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_nat_dec_le___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_nat_dec_le(a, b);
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_nat_mul___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_nat_mul(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_array_mk_empty___boxed(lean_object * type, lean_object * capacity) {
    lean_dec(type);
    lean_object * result = lean_mk_empty_array_with_capacity(capacity);
    lean_dec(capacity);
    return result;
}

extern "C" lean_object * lean_array_push___boxed(lean_object * type, lean_object * array, lean_object * value) {
    lean_dec(type);
    return lean_array_push(array, value);
}

extern "C" lean_object * lean_array_to_list___boxed(lean_object * type, lean_object * array) {
    lean_dec(type);
    lean_object * result = lean_box(0);
    size_t idx = lean_array_size(array);
    while (idx > 0) {
        idx--;
        lean_object * value = lean_array_get_core(array, idx);
        lean_inc(value);
        lean_object * cons = lean_alloc_ctor(1, 2, 0);
        lean_ctor_set(cons, 0, value);
        lean_ctor_set(cons, 1, result);
        result = cons;
    }
    lean_dec(array);
    return result;
}

extern "C" void * dlsym(void *, char const * sym) {
    if (strcmp(sym, "lean_nat_add___boxed") == 0) {
        return reinterpret_cast<void *>(lean_nat_add___boxed);
    }
    if (strcmp(sym, "lean_nat_sub___boxed") == 0) {
        return reinterpret_cast<void *>(lean_nat_sub___boxed);
    }
    if (strcmp(sym, "lean_nat_dec_eq___boxed") == 0) {
        return reinterpret_cast<void *>(lean_nat_dec_eq___boxed);
    }
    if (strcmp(sym, "lean_nat_dec_le___boxed") == 0) {
        return reinterpret_cast<void *>(lean_nat_dec_le___boxed);
    }
    if (strcmp(sym, "lean_nat_mul___boxed") == 0) {
        return reinterpret_cast<void *>(lean_nat_mul___boxed);
    }
    if (strcmp(sym, "lean_array_mk_empty___boxed") == 0) {
        return reinterpret_cast<void *>(lean_array_mk_empty___boxed);
    }
    if (strcmp(sym, "lean_array_push___boxed") == 0) {
        return reinterpret_cast<void *>(lean_array_push___boxed);
    }
    if (strcmp(sym, "lean_array_to_list___boxed") == 0) {
        return reinterpret_cast<void *>(lean_array_to_list___boxed);
    }
    return nullptr;
}

extern "C" void * __cxa_allocate_exception(size_t size) {
    return malloc(size == 0 ? 1 : size);
}

extern "C" [[noreturn]] void __cxa_throw(void *, void *, void (*)(void *)) {
    __builtin_trap();
    abort();
}

namespace lean {
namespace {

constexpr unsigned NAME_HASH_OFFSET = 2 * sizeof(void *);

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

static void set_name_hash(object * name, uint64_t hash) {
    lean_ctor_set_uint64(name, NAME_HASH_OFFSET, hash);
}

static void ensure_ir_interpreter_initialized() {
    static bool initialized = false;
    if (!initialized) {
        initialize_ir_interpreter();
        initialized = true;
    }
}

static uint32_t run_nat_function(name const & fn, unsigned n, object ** args) {
    elab_environment env(lean_box(0));
    options opts(lean_box(0));
    object * result = ir::run_boxed(env, opts, fn, n, args);
    uint32_t out = static_cast<uint32_t>(vir::static_nat_to_usize(result));
    lean_dec(result);
    return out;
}

static uint32_t run_tagged_function(name const & fn, unsigned n, object ** args) {
    elab_environment env(lean_box(0));
    options opts(lean_box(0));
    object * result = ir::run_boxed(env, opts, fn, n, args);
    uint32_t out = static_cast<uint32_t>(lean_obj_tag(result));
    lean_dec(result);
    return out;
}

static object * mk_nat_array(uint32_t const * values, uint32_t len) {
    object * array = lean_alloc_array(len, len);
    for (uint32_t i = 0; i < len; i++) {
        lean_array_set_core(array, i, vir::mk_static_nat(values[i]));
    }
    return array;
}

static char const * known_symbol_stem(name const & n) {
    if (n == name({ "Nat", "add" })) {
        return "lean_nat_add";
    }
    if (n == name({ "Nat", "sub" })) {
        return "lean_nat_sub";
    }
    if (n == name({ "Nat", "decEq" })) {
        return "lean_nat_dec_eq";
    }
    if (n == name({ "Nat", "decLe" })) {
        return "lean_nat_dec_le";
    }
    if (n == name({ "Nat", "mul" })) {
        return "lean_nat_mul";
    }
    if (n == name({ "Array", "mkEmpty" })) {
        return "lean_array_mk_empty";
    }
    if (n == name({ "Array", "push" })) {
        return "lean_array_push";
    }
    if (n == name({ "Array", "toList" })) {
        return "lean_array_to_list";
    }
    return nullptr;
}

static name name_from_dotted(char const * text, size_t len) {
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

} // namespace

extern "C" obj_res lean_name_mk_string(obj_arg prefix, obj_arg suffix) {
    object * obj = mk_ctor(static_cast<unsigned>(name_kind::STRING), { prefix, suffix }, sizeof(uint64_t));
    set_name_hash(obj, 1729);
    return obj;
}

extern "C" obj_res lean_name_mk_numeral(obj_arg prefix, obj_arg suffix) {
    object * obj = mk_ctor(static_cast<unsigned>(name_kind::NUMERAL), { prefix, suffix }, sizeof(uint64_t));
    set_name_hash(obj, 1729);
    return obj;
}

void check_system(char const *, bool) {}

void reset_heartbeat() {}

void save_stack_info(bool) {}

void notify_assertion_violation(char const *, int, char const *) {
    __builtin_trap();
}

bool options::get_bool(name const &, bool default_value) const {
    return default_value;
}

time_task::time_task(std::string const & category, options const &, name):
    m_category(category),
    m_timeit(),
    m_parent_task(nullptr) {
}

time_task::~time_task() {}

scope_trace_env::scope_trace_env(elab_environment const &, options const &):
    m_old_opts(nullptr) {
}

scope_trace_env::~scope_trace_env() {}

environment elab_environment::to_kernel_env() const {
    lean_inc(raw());
    return environment(raw());
}

constant_info environment::get(name const &) const {
    return constant_info(lean_box(0));
}

bool is_arrow(expr const &) {
    return false;
}

name const & get_uint32_name() {
    static name * n = nullptr;
    if (!n) {
        n = new name("UInt32");
    }
    return *n;
}

optional<name> get_init_fn_name_for(elab_environment const &, name const &) {
    return optional<name>();
}

void register_option(name const &, name const &, data_value_kind, char const *, char const *) {}

} // namespace lean

extern "C" lean::object * lean_decl_get_sorry_dep(lean::object *, lean::object *) {
    return lean_box(0);
}

extern "C" lean::object * lean_get_regular_init_fn_name_for(lean::object *, lean::object *) {
    return lean_box(0);
}

extern "C" lean::object * lean_get_export_name_for(lean::object *, lean::object *) {
    return lean_box(0);
}

extern "C" lean::obj_res lean_get_symbol_stem(lean::obj_arg env, lean::obj_arg fn) {
    lean_dec(env);
    lean::name n(fn);
    if (char const * stem = lean::known_symbol_stem(n)) {
        return lean_mk_string(stem);
    }
    std::string fallback = n.to_string();
    return lean_mk_string(fallback.c_str());
}

extern "C" lean::obj_res lean_mk_mangled_boxed_name(lean::obj_arg str) {
    lean::string_ref stem(str);
    std::string boxed = stem.to_std_string() + "___boxed";
    return lean_mk_string(boxed.c_str());
}

extern "C" double lean_float_of_nat(lean_obj_arg a) {
    double result = static_cast<double>(lean_usize_of_nat(a));
    lean_dec(a);
    return result;
}

extern "C" float lean_float32_of_nat(lean_obj_arg a) {
    float result = static_cast<float>(lean_usize_of_nat(a));
    lean_dec(a);
    return result;
}

extern "C" lean::obj_res lean_io_eprintln(lean::obj_arg s) {
    lean_dec(s);
    return lean_io_result_mk_ok(lean_box(0));
}

extern "C" void lean_io_result_show_error(lean::b_obj_arg) {}

extern "C" lean::object * lean_ir_find_env_decl(lean::object *, lean::object * n) {
    if (lean::object * decl = lean::vir::find_static_decl(n)) {
        return lean::mk_some(decl);
    }
    return lean_box(0);
}

extern "C" lean::object * lean_ir_find_env_decl_boxed(lean::object *, lean::object * n) {
    if (lean::object * decl = lean::vir::find_static_boxed_decl(n)) {
        return lean::mk_some(decl);
    }
    return lean_box(0);
}

extern "C" uint32_t vir_upstream_shim_fixture_count(void) {
    return lean::vir::static_decl_count();
}

extern "C" uint32_t vir_upstream_target_pointer_bytes(void) {
    return sizeof(void *);
}

extern "C" uint32_t vir_upstream_fib(uint32_t n) {
    lean::ensure_ir_interpreter_initialized();
    lean::object * arg = lean::vir::mk_static_nat(n);
    lean::object * args[] = { arg };
    return lean::run_nat_function(lean::name("fib"), 1, args);
}

extern "C" uint32_t vir_upstream_tamagotchi_step(uint32_t mood, uint32_t action) {
    lean::ensure_ir_interpreter_initialized();
    lean::object * mood_obj = lean_box(mood);
    lean::object * action_obj = lean_box(action);
    lean::object * args[] = { mood_obj, action_obj };
    return lean::run_tagged_function(lean::name({ "Tamagotchi", "step" }), 2, args);
}

extern "C" uint32_t vir_upstream_tamagotchi_run_demo(void) {
    lean::ensure_ir_interpreter_initialized();
    lean::elab_environment env(lean_box(0));
    lean::options opts(lean_box(0));
    lean::object * script = lean::ir::run_boxed(env, opts, lean::name({ "Tamagotchi", "demoScript" }), 0, nullptr);
    lean::object * initial = lean_box(0);
    lean::object * args[] = { initial, script };
    lean::object * result = lean::ir::run_boxed(env, opts, lean::name({ "Tamagotchi", "run" }), 2, args);
    uint32_t out = static_cast<uint32_t>(lean_obj_tag(result));
    lean_dec(result);
    return out;
}

extern "C" uint32_t vir_eval_const_nat(char const * name_text, uint32_t name_len) {
    lean::ensure_ir_interpreter_initialized();
    lean::name fn = lean::name_from_dotted(name_text, name_len);
    return lean::run_nat_function(fn, 0, nullptr);
}

extern "C" uint32_t vir_sort_checksum(uint32_t const * values, uint32_t len) {
    if (values == nullptr && len != 0) {
        return 0;
    }
    lean::ensure_ir_interpreter_initialized();
    lean::object * input = lean::mk_nat_array(values, len);
    lean::object * args[] = { input };
    return lean::run_nat_function(lean::name({ "SortDemo", "demoFromArray" }), 1, args);
}
