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

/-- Raw rooted JavaScript handle; its runtime representation is an external object. -/
opaque JsHandle : Type

/-- A JavaScript handle with an explicit phantom shape. Unfold only at a reviewed cast. -/
@[expose, irreducible] def Js (_α : Type) : Type := JsHandle

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

/-- Widens the phantom type without changing the value, root, or lifetime. -/
@[inline] def ofJs {α : Type} (value : Lean.Vir.Js α) : UndefinedOr α := by
  unfold UndefinedOr Lean.Vir.Js at *
  exact value

end UndefinedOr

namespace Function

/-- Exact zero-argument JavaScript function; `result` is its Lean boundary view. -/
opaque Nullary (result : Type) : Type

/-- Exact binary JavaScript function; parameters describe Lean boundary views. -/
opaque Binary (first second result : Type) : Type

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

/--
Closed evidence for the JavaScript function shapes VIR can invoke directly.
The proposition is erased; it neither validates a JavaScript value nor changes
its native call signature.
-/
class inductive Shape : Type → Prop where
  | nullary (result : Type) : Shape (Nullary result)
  | unary (argument result : Type) : Shape (Unary argument result)
  | binary (first second result : Type) : Shape (Binary first second result)
  | ternary (first second third result : Type) : Shape (Ternary first second third result)

attribute [instance] Shape.nullary Shape.unary Shape.binary Shape.ternary

end Function

/-- Exact zero-argument JavaScript function with a statically described result. -/
abbrev Function0 (result : Type) : Type :=
  Lean.Vir.Js (Function.Nullary result)

/-- Exact binary JavaScript function with statically described arguments and result. -/
abbrev Function2 (first second result : Type) : Type :=
  Lean.Vir.Js (Function.Binary first second result)

/-- Exact unary JavaScript function with a statically described call shape. -/
abbrev Function1 (argument result : Type) : Type :=
  Lean.Vir.Js (Function.Unary argument result)

/-- Exact ternary JavaScript function with a statically described call shape. -/
abbrev Function3 (first second third result : Type) : Type :=
  Lean.Vir.Js (Function.Ternary first second third result)

/--
Forgets the phantom shape of a JavaScript value without changing its value,
identity, root, or lifetime.
-/
@[inline] def erase {α : Type} (value : Lean.Vir.Js α) : Lean.Vir.Js.Any := by
  unfold Any Lean.Vir.Js at *
  exact value

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

/-- The unary view of Array.map's callback, not general function subtyping.
Only the phantom type changes; the original JS function still receives all
arguments. Lean unary bridges ignore index/source as ordinary unary TS callbacks may. -/
@[inline] instance instUnaryArrayMap {α β : Type} :
    CoeHead (Function1 (Lean.Vir.Js α) (Lean.Vir.Js β))
      (Function3 (Lean.Vir.Js α) (Lean.Vir.Js Float) (Array α) (Lean.Vir.Js β)) where
  coe value := by
    unfold Function1 Function3 Lean.Vir.Js at *
    exact value

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
