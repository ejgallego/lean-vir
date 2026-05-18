import Lean
import Lean.Elab.Frontend
import Lean.Compiler.IR.CompilerM
import Lean.Compiler.LCNF.Main

open Lean

namespace Vir.GenerateProvider

open Lean.IR

structure Target where
  source : System.FilePath
  roots : Array Name

structure LoadedDecl where
  source : String
  decl : Decl

structure NativeExtern where
  name : Name
  params : Array Param
  resultType : IRType
  symbol : String

structure Closure where
  seen : NameSet := {}
  decls : Array LoadedDecl := #[]
  externs : Array NativeExtern := #[]
  missing : Array Name := #[]

def targets : Array Target := #[
  {
    source := "examples/Fib.lean",
    roots := #[`fib, `fib._boxed]
  },
  {
    source := "examples/Tamagotchi.lean",
    roots := #[
      `Tamagotchi.step,
      `Tamagotchi.step._boxed,
      `Tamagotchi.run,
      `Tamagotchi.run._boxed,
      `Tamagotchi.trace,
      `Tamagotchi.trace._boxed,
      `Tamagotchi.demoScript
    ]
  }
]

def param (idx : Nat) (borrow : Bool) (ty : IRType) : Param :=
  { x := { idx }, borrow, ty }

def nativeExterns : Array NativeExtern := #[
  {
    name := `Nat.add,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_add"
  },
  {
    name := `Nat.sub,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_sub"
  },
  {
    name := `Nat.decEq,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_nat_dec_eq"
  }
]

def nativeExtern? (n : Name) : Option NativeExtern :=
  nativeExterns.find? fun ext => ext.name == n

def sanitizeSource (input : String) : String :=
  "\n".intercalate <|
    input.splitOn "\n" |>.filter fun line =>
      !(line.trimAsciiStart.copy.startsWith "#eval")

def moduleNameFor (path : System.FilePath) : Name :=
  .str (.str `VirIRInput (path.fileStem.getD "Input")) "Generated"

unsafe def frontendEnv (target : Target) : IO Environment := do
  -- Match Lean's CLI startup path: the frontend imports modules with loaded extensions.
  enableInitializersExecution
  let contents <- IO.FS.readFile target.source
  let opts := Elab.async.set ({} : Options) false
  let fileName := target.source.toString
  match <- Elab.runFrontend (sanitizeSource contents) opts fileName (moduleNameFor target.source) with
  | some env => return env
  | none => throw <| IO.userError s!"Lean frontend failed for {fileName}"

unsafe def loadDeclIndex : IO (NameMap LoadedDecl) := do
  initSearchPath (← getBuildDir)
  let mut index : NameMap LoadedDecl := {}
  for target in targets do
    let env <- frontendEnv target
    for decl in getDecls env do
      index := index.insert decl.name { source := target.source.toString, decl }
  return index

def refsOfExpr (expr : IR.Expr) (refs : Array Name) : Array Name :=
  match expr with
  | .fap f _ => refs.push f
  | .pap f _ => refs.push f
  | _ => refs

partial def refsOfBody : FnBody -> Array Name -> Array Name
  | .vdecl _ _ expr cont, refs => refsOfBody cont (refsOfExpr expr refs)
  | .jdecl _ _ body cont, refs => refsOfBody cont (refsOfBody body refs)
  | .set _ _ _ cont, refs => refsOfBody cont refs
  | .setTag _ _ cont, refs => refsOfBody cont refs
  | .uset _ _ _ cont, refs => refsOfBody cont refs
  | .sset _ _ _ _ _ cont, refs => refsOfBody cont refs
  | .inc _ _ _ _ cont, refs => refsOfBody cont refs
  | .dec _ _ _ _ cont, refs => refsOfBody cont refs
  | .del _ cont, refs => refsOfBody cont refs
  | .case _ _ _ alts, refs =>
      alts.foldl (fun refs alt =>
        match alt with
        | .ctor _ body => refsOfBody body refs
        | .default body => refsOfBody body refs) refs
  | .ret _, refs => refs
  | .jmp _ _, refs => refs
  | .unreachable, refs => refs

def refsOfDecl : Decl -> Array Name
  | .fdecl (body := body) .. => refsOfBody body #[]
  | .extern .. => #[]

partial def collectName (index : NameMap LoadedDecl) (name : Name) (state : Closure) : Closure :=
  if state.seen.contains name then
    state
  else
    let state := { state with seen := state.seen.insert name }
    match nativeExtern? name with
    | some ext => { state with externs := state.externs.push ext }
    | none =>
        match index.find? name with
        | none => { state with missing := state.missing.push name }
        | some loaded =>
            let state := { state with decls := state.decls.push loaded }
            refsOfDecl loaded.decl |>.foldl (fun state dep => collectName index dep state) state

def collectClosure (index : NameMap LoadedDecl) : Closure :=
  targets.foldl (fun state target =>
    target.roots.foldl (fun state root => collectName index root state) state) {}

def comma (parts : Array String) : String :=
  ", ".intercalate parts.toList

def cppBool (b : Bool) : String :=
  if b then "true" else "false"

def cppStringLit (s : String) : String :=
  "\"" ++ s.foldl (init := "") (fun out c =>
    match c with
    | '\n' => out ++ "\\n"
    | '\r' => out ++ "\\r"
    | '\t' => out ++ "\\t"
    | '"'  => out ++ "\\\""
    | '\\' => out ++ "\\\\"
    | _    => out.push c) ++ "\""

partial def emitName (name : Name) : String :=
  match name with
  | .anonymous => "lean_box(0)"
  | .str pre part => "mk_name_str(" ++ emitName pre ++ ", " ++ cppStringLit part ++ ")"
  | .num pre idx => "mk_name_num(" ++ emitName pre ++ ", " ++ toString idx ++ ")"

def emitType : IRType -> Except String String
  | .float => pure "type::Float"
  | .uint8 => pure "type::UInt8"
  | .uint16 => pure "type::UInt16"
  | .uint32 => pure "type::UInt32"
  | .uint64 => pure "type::UInt64"
  | .usize => pure "type::USize"
  | .erased => pure "type::Irrelevant"
  | .object => pure "type::Object"
  | .tobject => pure "type::TObject"
  | .float32 => pure "type::Float32"
  | .tagged => pure "type::Tagged"
  | .void => pure "type::Void"
  | .struct .. => throw "IR struct return values are not supported by the demo provider yet"
  | .union .. => throw "IR union return values are not supported by the demo provider yet"

def emitArg : Arg -> String
  | .var id => s!"mk_arg_var({id.idx})"
  | .erased => "mk_arg_erased()"

def emitArray (items : Array String) : String :=
  "mk_array({" ++ comma items ++ "})"

def emitArgs (args : Array Arg) : String :=
  emitArray <| args.map emitArg

def emitParam (p : Param) : Except String String := do
  let ty <- emitType p.ty
  pure s!"mk_param({p.x.idx}, {ty}, {cppBool p.borrow})"

def emitParams (params : Array Param) : Except String String := do
  emitArray <$> params.mapM emitParam

def emitCtorInfo (info : CtorInfo) : String :=
  "mk_ctor_info(" ++ emitName info.name ++ s!", {info.cidx}, {info.size}, {info.usize}, {info.ssize})"

partial def emitExpr : IR.Expr -> Except String String
  | .ctor info args => pure <| "mk_ctor_expr(" ++ emitCtorInfo info ++ ", " ++ emitArgs args ++ ")"
  | .reset n x => pure s!"mk_reset({n}, {x.idx})"
  | .reuse x info updtHeader args =>
      pure <| s!"mk_reuse({x.idx}, " ++ emitCtorInfo info ++ s!", {cppBool updtHeader}, " ++ emitArgs args ++ ")"
  | .proj i x => pure s!"mk_proj({i}, {x.idx})"
  | .uproj i x => pure s!"mk_uproj({i}, {x.idx})"
  | .sproj i offset x => pure s!"mk_sproj({i}, {offset}, {x.idx})"
  | .fap f args => pure <| "mk_fap(" ++ emitName f ++ ", " ++ emitArgs args ++ ")"
  | .pap f args => pure <| "mk_pap(" ++ emitName f ++ ", " ++ emitArgs args ++ ")"
  | .ap x args => pure <| s!"mk_ap({x.idx}, " ++ emitArgs args ++ ")"
  | .box ty x => do
      let ty <- emitType ty
      pure <| "mk_box(" ++ ty ++ s!", {x.idx})"
  | .unbox x => pure s!"mk_unbox({x.idx})"
  | .lit (.num v) => pure s!"mk_lit_num({v})"
  | .lit (.str v) => pure <| "mk_lit_str(" ++ cppStringLit v ++ ")"
  | .isShared x => pure s!"mk_is_shared({x.idx})"

partial def emitAlt : Alt -> Except String String
  | .ctor info body => do
      pure <| "mk_ctor_alt(" ++ emitCtorInfo info ++ ", " ++ (<- emitBody body) ++ ")"
  | .default body => do
      pure <| "mk_default_alt(" ++ (<- emitBody body) ++ ")"
where
  emitBody : FnBody -> Except String String
    | .vdecl x ty expr cont => do
        pure <| s!"mk_vdecl({x.idx}, " ++ (<- emitType ty) ++ ", " ++ (<- emitExpr expr) ++ ", " ++ (<- emitBody cont) ++ ")"
    | .jdecl jp params body cont => do
        pure <| s!"mk_jdecl({jp.idx}, " ++ (<- emitParams params) ++ ", " ++ (<- emitBody body) ++ ", " ++ (<- emitBody cont) ++ ")"
    | .set x i arg cont => do
        pure <| s!"mk_set({x.idx}, {i}, {emitArg arg}, " ++ (<- emitBody cont) ++ ")"
    | .setTag x cidx cont => do
        pure <| s!"mk_set_tag({x.idx}, {cidx}, " ++ (<- emitBody cont) ++ ")"
    | .uset x i y cont => do
        pure <| s!"mk_uset({x.idx}, {i}, {y.idx}, " ++ (<- emitBody cont) ++ ")"
    | .sset x i offset y ty cont => do
        pure <| s!"mk_sset({x.idx}, {i}, {offset}, {y.idx}, " ++ (<- emitType ty) ++ ", " ++ (<- emitBody cont) ++ ")"
    | .inc x n maybeScalar _ cont => do
        pure <| s!"mk_inc({x.idx}, {n}, {cppBool maybeScalar}, " ++ (<- emitBody cont) ++ ")"
    | .dec x n maybeScalar _ cont => do
        pure <| s!"mk_dec({x.idx}, {n}, {cppBool maybeScalar}, " ++ (<- emitBody cont) ++ ")"
    | .del x cont => do
        pure <| s!"mk_del({x.idx}, " ++ (<- emitBody cont) ++ ")"
    | .case tid x ty alts => do
        pure <| "mk_case(" ++ emitName tid ++ s!", {x.idx}, " ++ (<- emitType ty) ++ ", "
          ++ emitArray (<- alts.mapM emitAlt) ++ ")"
    | .ret arg => pure <| "mk_ret(" ++ emitArg arg ++ ")"
    | .jmp jp args => pure <| s!"mk_jmp({jp.idx}, " ++ emitArgs args ++ ")"
    | .unreachable => pure "mk_unreachable()"

def emitBody (body : FnBody) : Except String String :=
  emitAlt.emitBody body

def boxedBaseName? (name : Name) : Option Name :=
  match name with
  | .str pre "_boxed" => some pre
  | _ => none

def cppPrelude1 : String :=
"// Generated by tools/GenerateProvider.lean.
// Do not edit by hand.

#include \"decl_provider.h\"

#include <stddef.h>

#include <initializer_list>

#include \"library/ir_types.h\"
#include \"util/name.h\"

namespace lean {
extern \"C\" obj_res lean_name_mk_string(obj_arg prefix, obj_arg suffix);
extern \"C\" obj_res lean_name_mk_numeral(obj_arg prefix, obj_arg suffix);
}

namespace lean::vir {
namespace {

using ir::type;

struct decl_entry {
    char const * name_text;
    object * boxed_base;
    object * name;
    object * decl;
};

struct fixture {
    decl_entry entries["

def cppPrelude2 : String :=
"];
};

static fixture * g_fixture = nullptr;

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

static object * mk_name_str(object * prefix, char const * part) {
    object * suffix = lean_mk_string(part);
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

static object * mk_array(std::initializer_list<object *> fields) {
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

static object * mk_lit_str(char const * value) {
    object * str = lean_mk_string(value);
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
"

def cppFooter (entryCount : Nat) : String :=
"
    g_fixture = f;
    return f;
}

} // namespace

object * mk_static_nat(size_t value) {
    return lean_usize_to_nat(value);
}

size_t static_nat_to_usize(object * value) {
    return lean_usize_of_nat(value);
}

object * find_static_decl(object * n) {
    fixture * f = get_fixture();
    for (decl_entry const & entry : f->entries) {
        if (lean_name_eq(n, entry.name)) {
            return entry.decl;
        }
    }
    return nullptr;
}

object * find_static_boxed_decl(object * n) {
    fixture * f = get_fixture();
    for (decl_entry const & entry : f->entries) {
        if (entry.boxed_base && lean_name_eq(n, entry.boxed_base)) {
            return entry.decl;
        }
    }
    return nullptr;
}

uint32_t static_decl_count() {
    (void)get_fixture();
    return " ++ toString entryCount ++ ";
}

} // namespace lean::vir
"

def emitBuildDecl (idx : Nat) (loaded : LoadedDecl) : Except String String := do
  match loaded.decl with
  | .fdecl f params resultType body _ =>
      pure <|
        "static object * build_decl_" ++ toString idx ++ "() {\n"
        ++ "    object * fn = " ++ emitName f ++ ";\n"
        ++ "    return mk_fun_decl(fn, " ++ (<- emitParams params) ++ ", "
        ++ (<- emitType resultType) ++ ", " ++ (<- emitBody body) ++ ");\n"
        ++ "}\n"
  | .extern f params resultType _ =>
      pure <|
        "static object * build_decl_" ++ toString idx ++ "() {\n"
        ++ "    object * fn = " ++ emitName f ++ ";\n"
        ++ "    return mk_extern_decl(fn, " ++ (<- emitParams params) ++ ", "
        ++ (<- emitType resultType) ++ ");\n"
        ++ "}\n"

def emitBuildExtern (idx : Nat) (ext : NativeExtern) : Except String String := do
  pure <|
    "static object * build_extern_" ++ toString idx ++ "() {\n"
    ++ "    object * fn = " ++ emitName ext.name ++ ";\n"
    ++ "    return mk_extern_decl(fn, " ++ (<- emitParams ext.params) ++ ", "
    ++ (<- emitType ext.resultType) ++ ");\n"
    ++ "}\n"

def entryInit (entryIdx : Nat) (builder : String) (name : Name) : String :=
  let nameText := name.toString
  let boxedBase := match boxedBaseName? name with
    | some base => emitName base
    | none => "nullptr"
  "    f->entries[" ++ toString entryIdx ++ "] = { "
    ++ cppStringLit nameText ++ ", " ++ boxedBase ++ ", " ++ emitName name
    ++ ", " ++ builder ++ " };\n"

def emitProvider (closure : Closure) : Except String String := do
  let entryCount := closure.decls.size + closure.externs.size
  let declBuilders <- closure.decls.mapIdxM emitBuildDecl
  let externBuilders <- closure.externs.mapIdxM emitBuildExtern
  let mut entries := ""
  for h : i in [:closure.decls.size] do
    let name := closure.decls[i].decl.name
    entries := entries ++ entryInit i s!"build_decl_{i}()" name
  for h : j in [:closure.externs.size] do
    let entryIdx := closure.decls.size + j
    let name := closure.externs[j].name
    entries := entries ++ entryInit entryIdx s!"build_extern_{j}()" name
  pure <|
    cppPrelude1 ++ toString entryCount ++ cppPrelude2
    ++ "\n" ++ "\n".intercalate declBuilders.toList
    ++ "\n" ++ "\n".intercalate externBuilders.toList
    ++ "\nstatic fixture * get_fixture() {\n"
    ++ "    if (g_fixture) {\n"
    ++ "        return g_fixture;\n"
    ++ "    }\n"
    ++ "    auto * f = new fixture();\n"
    ++ entries
    ++ cppFooter entryCount

def reportFor (closure : Closure) : String :=
  let roots :=
    targets.foldl (fun acc target => acc ++ target.roots) #[]
  let loadedLines :=
    closure.decls.map fun loaded =>
      s!"- `{loaded.decl.name}` from `{loaded.source}`"
  let externLines :=
    closure.externs.map fun ext =>
      s!"- `{ext.name}` -> `{ext.symbol}`"
  let missingLines :=
    if closure.missing.isEmpty then #["None."] else closure.missing.map fun n => s!"- `{n}`"
  "# Generated IR Provider Report\n\n"
  ++ "Generated by `tools/GenerateProvider.lean` from typed `Lean.IR.Decl` values.\n\n"
  ++ "## Roots\n\n"
  ++ "\n".intercalate (roots.map (fun n => s!"- `{n}`")).toList ++ "\n\n"
  ++ "## Loaded IR Declarations\n\n"
  ++ "\n".intercalate loadedLines.toList ++ "\n\n"
  ++ "## Native Extern Declarations\n\n"
  ++ "\n".intercalate externLines.toList ++ "\n\n"
  ++ "## Missing Declarations\n\n"
  ++ "\n".intercalate missingLines.toList ++ "\n"

def readTextFile? (path : System.FilePath) : IO (Option String) := do
  try
    return some (← IO.FS.readFile path)
  catch _ =>
    return none

def writeTextFile (path : System.FilePath) (content : String) : IO Unit := do
  if let some parent := path.parent then
    IO.FS.createDirAll parent
  if (← readTextFile? path) != some content then
    IO.FS.writeFile path content

unsafe def run (providerPath reportPath : System.FilePath) : IO UInt32 := do
  let index <- loadDeclIndex
  let closure := collectClosure index
  let report := reportFor closure
  writeTextFile reportPath report
  if !closure.missing.isEmpty then
    IO.eprintln s!"missing IR declarations; see {reportPath}"
    return 1
  match emitProvider closure with
  | .ok provider =>
      writeTextFile providerPath provider
      IO.println s!"wrote {providerPath}"
      IO.println s!"wrote {reportPath}"
      return 0
  | .error err =>
      IO.eprintln err
      return 1

end Vir.GenerateProvider

unsafe def main (args : List String) : IO UInt32 := do
  match args with
  | [providerPath, reportPath] =>
      Vir.GenerateProvider.run providerPath reportPath
  | _ =>
      IO.eprintln "usage: lean --run tools/GenerateProvider.lean <provider.cpp> <report.md>"
      return 2
