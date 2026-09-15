/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Host
public meta import Vir.Host
public import Vir.Runtime

public section

namespace Lean.Vir

/-- Opaque handle to a JavaScript-owned value with a Lean-side phantom shape. -/
opaque Js (α : Type) : Type

namespace Js

namespace Object

/-- Phantom shape for an ordinary JavaScript object. -/
opaque Value : Type

end Object


/-- JavaScript-owned ordinary object. -/
abbrev Object : Type :=
  Lean.Vir.Js Object.Value

namespace Any

/-- Erased phantom shape for a JavaScript value whose static type is deliberately unknown. -/
opaque Value : Type

end Any


/-- JavaScript-owned value with an explicitly erased static shape. -/
abbrev Any : Type :=
  Lean.Vir.Js Any.Value

namespace Undefined

/-- Phantom shape for the exact JavaScript `undefined` value. -/
opaque Value : Type

end Undefined

/-- JavaScript-owned `undefined` value. -/
abbrev Undefined : Type :=
  Lean.Vir.Js Undefined.Value

namespace UndefinedOr

/-- Phantom shape for the native JavaScript union `α | undefined`. -/
opaque Value (α : Type) : Type

end UndefinedOr

/-- The exact JavaScript payload, not a Lean `Option` or a wrapper object. -/
abbrev UndefinedOr (α : Type) : Type :=
  Lean.Vir.Js (UndefinedOr.Value α)

namespace UndefinedOr

@[inline] unsafe def ofJsImpl {α : Type} (value : Lean.Vir.Js α) : UndefinedOr α :=
  unsafeCast value

/-- Widens the phantom type without changing the value, root, or lifetime. -/
@[implemented_by ofJsImpl]
axiom ofJs {α : Type} (value : Lean.Vir.Js α) : UndefinedOr α

end UndefinedOr

namespace Function

/--
Phantom shape for an exact unary JavaScript function.

`argument` and `result` describe the Lean boundary views used when the
function is called; this marker does not wrap the JavaScript function or make
its signature dynamically inspectable.
-/
opaque Unary (argument result : Type) : Type

/--
Phantom shape for an exact ternary JavaScript function.

The argument and result types describe the Lean boundary views used when the
function is called; this marker neither wraps the JavaScript function nor
changes its native invocation arity.
-/
opaque Ternary (first second third result : Type) : Type

end Function

/-- Exact unary JavaScript function with a statically described call shape. -/
abbrev Function1 (argument result : Type) : Type :=
  Lean.Vir.Js (Function.Unary argument result)

/-- Exact ternary JavaScript function with a statically described call shape. -/
abbrev Function3 (first second third result : Type) : Type :=
  Lean.Vir.Js (Function.Ternary first second third result)

/-- Runtime implementation of `Js.erase`; public so module importers can compile it. -/
@[inline] unsafe def eraseImpl {α : Type}
    (value : Lean.Vir.Js α) : Lean.Vir.Js.Any :=
  unsafeCast value

/--
Forgets the phantom shape of a JavaScript value without changing its value,
identity, root, or lifetime.
-/
@[implemented_by eraseImpl]
axiom erase {α : Type} (value : Lean.Vir.Js α) : Lean.Vir.Js.Any

namespace Nullable

/-- Phantom marker for a JavaScript nullable value. -/
opaque Value (α : Type) : Type

end Nullable

/-- JavaScript-owned nullable value. -/
abbrev Nullable (α : Type) : Type :=
  Lean.Vir.Js (Nullable.Value α)

namespace Array

/-- Phantom shape for a JavaScript `Array` whose entries have JavaScript shape `α`. -/
opaque Value (α : Type) : Type

end Array

/-- JavaScript-owned array. Insertion and indexing use `Js α`, never a raw Lean `α`. -/
abbrev Array (α : Type) : Type :=
  Lean.Vir.Js (Array.Value α)

namespace Function

/-- Public implementation symbol needed by imported code; no new JS function is created. -/
@[inline, instance_reducible] unsafe def unaryArrayMapImpl {α β : Type} :
    CoeHead (Function1 (Lean.Vir.Js α) (Lean.Vir.Js β))
      (Function3 (Lean.Vir.Js α) (Lean.Vir.Js Float) (Array α) (Lean.Vir.Js β)) where
  coe function := unsafeCast function

/-- The unary view of Array.map's callback, not general function subtyping.
Only the phantom type changes; the original JS function still receives all
arguments. Lean unary bridges ignore index/source as ordinary unary TS callbacks may. -/
@[implemented_by unaryArrayMapImpl, instance]
axiom instUnaryArrayMap {α β : Type} :
    CoeHead (Function1 (Lean.Vir.Js α) (Lean.Vir.Js β))
      (Function3 (Lean.Vir.Js α) (Lean.Vir.Js Float) (Array α) (Lean.Vir.Js β))

end Function

namespace Tuple2

/-- Phantom shape for an exact native tuple with two independently typed positions. -/
opaque Value (α β : Type) : Type

end Tuple2

/-- Exact JavaScript two-element tuple; parameters describe each position's JavaScript shape. -/
abbrev Tuple2 (α β : Type) : Type :=
  Lean.Vir.Js (Tuple2.Value α β)

namespace NodeList

/-- Phantom shape for a JavaScript DOM `NodeList` whose entries have Lean view `α`. -/
opaque Value (α : Type) : Type

end NodeList

/-- JavaScript-owned DOM `NodeList`. The parameter describes the Lean view returned by indexing. -/
abbrev NodeList (α : Type) : Type :=
  Lean.Vir.Js (NodeList.Value α)

namespace Promise

/-- Phantom shape for a native JavaScript `Promise<T>` with selected JavaScript shape `α`.
This annotation is not a runtime settlement check or a computed `Awaited` type. -/
opaque Value (α : Type) : Type

end Promise

/-- JavaScript-owned native `Promise`; VIR does not await or schedule it. -/
abbrev Promise (α : Type) : Type :=
  Lean.Vir.Js (Promise.Value α)

end Js

namespace LeanRef

/-- Phantom marker for a Lean-owned value retained by a self-owning JavaScript object. -/
opaque Handle (α : Type) : Type

end LeanRef

/-- JavaScript object whose reachability owns a retained Lean value. -/
abbrev JSL (α : Type) : Type :=
  Js (LeanRef.Handle α)

end Lean.Vir
