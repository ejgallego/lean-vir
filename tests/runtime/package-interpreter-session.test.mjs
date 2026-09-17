/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Compile the actual shim entry/reset functions against a tiny execution mock.
// This checks C++ policy/unwinding/ownership, not real Lean IR or Wasm traps.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const source = await readFile(
  new URL(
    "../../wasm/upstream_shim/interpreter/persistent_ir_interpreter.cpp",
    import.meta.url,
  ),
  "utf8",
);
function extract(start) {
  // Deliberately limited to these simple definitions, not a C++ parser. Braces
  // in comments/string literals or preprocessor branches require revisiting this
  // harness; it does not validate the real interpreter class or Wasm traps.
  const begin = source.indexOf(start);
  assert.ok(begin >= 0, start);
  let end = source.indexOf("{", begin),
    depth = 1;
  while (depth) {
    const char = source[++end];
    assert.ok(end < source.length);
    if (char === "{") depth++;
    if (char === "}") depth--;
  }
  return source.slice(begin, end + 1);
}
const program = `
#include <cassert>
#include <functional>
#include <stdexcept>
#include <string>
namespace lean {
struct object { int refs = 1; bool ok = true; };
void lean_dec(object * o) { if (o) --o->refs; }
bool lean_io_result_is_ok(object * o) { return o->ok; }
object failure {1, false};
object * lean_mk_string(char const *) { return &failure; }
object * lean_mk_io_user_error(object * o) { return o; }
object * lean_io_result_mk_error(object * o) { return o; }
struct name { name(object *, bool) {} };
namespace ir { struct interpreter {}; interpreter * g_interpreter = nullptr; }
namespace vir {
int created = 0, destroyed = 0;
object result;
std::function<object *()> action = [] { return &result; };
class package_interpreter_session {
    ir::interpreter interp;
    object * execute(size_t argc, object ** args) {
        for (size_t i = 0; i < argc; ++i) lean_dec(args[i]);
        auto previous = ir::g_interpreter;
        ir::g_interpreter = &interp;
        auto current = action;
        try { auto r = current(); ir::g_interpreter = previous; return r; }
        catch (...) { ir::g_interpreter = previous; throw; }
    }
public:
    package_interpreter_session() { ++created; }
    ~package_interpreter_session() { assert(!is_active()); ++destroyed; }
    bool is_active() const { return ir::g_interpreter == &interp; }
    object * call(name const &, size_t n, object ** a) { return execute(n, a); }
    object * apply(object * fn, unsigned n, object ** a) { lean_dec(fn); return execute(n, a); }
    object * initialize(name const &, name const &) { return execute(0, nullptr); }
};
package_interpreter_session * g_package_interpreter = nullptr;
unsigned g_session_depth = 0;
bool g_reset_pending = false;
char const * g_entry_error = nullptr;
void reset_package_interpreter();
${extract("bool prepare_entry()")}
${extract("void release_arguments(")}
${extract("struct session_entry")} ;
${extract("object * run_package_interpreter_function(")}
${extract("object * apply_package_closure(")}
${extract("char const * package_interpreter_entry_error()")}
${extract("object * run_package_interpreter_initializer(")}
${extract("void reset_package_interpreter()")}
}}
int main() {
    using namespace lean; using namespace lean::vir;
    object a, fn; object * args[] = { &a };
    assert(run_package_interpreter_initializer(nullptr, nullptr) == &result);
    assert(created == 1);
    assert(run_package_interpreter_function(nullptr, 1, args) == &result);
    assert(created == 1 && a.refs == 0);
    a.refs = 1;
    assert(apply_package_closure(&fn, 1, args) == &result);
    assert(created == 1 && fn.refs == 0 && a.refs == 0);
    ir::interpreter foreign; ir::g_interpreter = &foreign;
    a.refs = fn.refs = 1;
    assert(apply_package_closure(&fn, 1, args) == nullptr);
    assert(a.refs == 0 && fn.refs == 0 && created == 1);
    assert(std::string(package_interpreter_entry_error()).find("foreign") != std::string::npos);
    ir::g_interpreter = nullptr;
    action = [] {
        assert(g_package_interpreter->is_active());
        auto outer = action;
        action = []() -> object * { throw std::runtime_error("nested failure"); };
        object inner; object * argv[] = { &inner }; object callback;
        try { apply_package_closure(&callback, 1, argv); assert(false); }
        catch (std::runtime_error const &) {}
        assert(inner.refs == 0 && callback.refs == 0);
        assert(g_reset_pending && destroyed == 0 && g_session_depth == 1);
        object rejected; object * rejectedArgs[] = { &rejected };
        assert(run_package_interpreter_function(nullptr, 1, rejectedArgs) == nullptr);
        assert(rejected.refs == 0 && created == 1);
        assert(std::string(package_interpreter_entry_error()).find("pending") != std::string::npos);
        action = outer;
        return &result;
    };
    assert(run_package_interpreter_function(nullptr, 0, nullptr) == &result);
    assert(destroyed == 1 && !g_reset_pending && g_session_depth == 0);
    action = [] { return &result; };
    object callback;
    assert(apply_package_closure(&callback, 0, nullptr) == &result);
    assert(created == 2 && callback.refs == 0);
    reset_package_interpreter(); reset_package_interpreter();
    assert(destroyed == 2);
    action = [] { return &failure; };
    assert(run_package_interpreter_initializer(nullptr, nullptr) == &failure);
    assert(created == 3 && destroyed == 3 && g_package_interpreter == nullptr);
}
`;
const directory = new URL(
  "../../build/package-interpreter-session/",
  import.meta.url,
);
await mkdir(directory, { recursive: true });
const executable = new URL("session-policy-test", directory).pathname;
const compiled = spawnSync(
  "c++",
  ["-std=c++20", "-x", "c++", "-", "-o", executable],
  { input: program, encoding: "utf8" },
);
assert.equal(compiled.status, 0, compiled.stderr);
const tested = spawnSync(executable, [], { encoding: "utf8" });
assert.equal(tested.status, 0, tested.stderr);
console.log(
  "PASS actual entry/reset policy with mocked execution: initializer/call/callback reuse, foreign/pending rejection, exactly-once consumption, deferred retirement/recreation and initializer failure",
);
