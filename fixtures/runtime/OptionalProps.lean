/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.ProofWidgets.Jsx

public section

namespace Vir.Fixtures.OptionalProps

open Lean.Vir
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

/-- Optional presence does not add `undefined` to the permitted present value. -/
structure OptionalProps where
  title : Js String

attribute [js_optional] OptionalProps.title

/-- A union with `undefined` does not make a required property optional. -/
structure RequiredUndefinedProps where
  title : Js.UndefinedOr String

structure OptionalUndefinedProps where
  title : Js.UndefinedOr String

attribute [js_optional] OptionalUndefinedProps.title

structure OptionalNullableProps where
  title : Js.Nullable String

attribute [js_optional] OptionalNullableProps.title

def omitted (Component : React.FunctionComponent OptionalProps) : React.ReactM (Js React.Node) :=
  jsx%{<Component/>}

def present (Component : React.FunctionComponent OptionalProps) (title : Js String) :
    React.ReactM (Js React.Node) :=
  jsx%{<Component title={title}/>}

def readTitle (props : Js OptionalProps) : RuntimeM (Js.UndefinedOr String) :=
  js_field% props "title"

def requiredUndefined (Component : React.FunctionComponent RequiredUndefinedProps)
    (title : Js.UndefinedOr String) : React.ReactM (Js React.Node) :=
  jsx%{<Component title={title}/>}

def optionalUndefined (Component : React.FunctionComponent OptionalUndefinedProps)
    (title : Js.UndefinedOr String) : React.ReactM (Js React.Node) :=
  jsx%{<Component title={title}/>}

def omittedUndefined (Component : React.FunctionComponent OptionalUndefinedProps) :
    React.ReactM (Js React.Node) :=
  jsx%{<Component/>}

def readUndefinedTitle (props : Js OptionalUndefinedProps) : RuntimeM (Js.UndefinedOr String) :=
  js_field% props "title"

abbrev MaybeString := Js.UndefinedOr.Value String

structure AliasedUndefinedProps where
  title : Js MaybeString

attribute [js_optional] AliasedUndefinedProps.title

example (props : Js AliasedUndefinedProps) : RuntimeM (Js.UndefinedOr String) :=
  js_field% props "title"

def nullable (Component : React.FunctionComponent OptionalNullableProps) (title : Js.Nullable String) :
    React.ReactM (Js React.Node) :=
  jsx%{<Component title={title}/>}

def omittedNullable (Component : React.FunctionComponent OptionalNullableProps) :
    React.ReactM (Js React.Node) :=
  jsx%{<Component/>}

def readNullableTitle (props : Js OptionalNullableProps) :
    RuntimeM (Js.UndefinedOr (Js.Nullable.Value String)) :=
  js_field% props "title"

def component : RuntimeM (React.FunctionComponent OptionalProps) :=
  Js.Function.ofLean fun props => do
    let title ← readTitle props
    jsx%{<span>{title}</span>}

-- Literal construction and native fields retain the same present-value checks.
example (Component : React.FunctionComponent OptionalProps) : React.ReactM (Js React.Node) :=
  jsx%{<Component title="present"/>}

example (Component : React.FunctionComponent OptionalProps) : React.ReactM (Js React.Node) :=
  jsx%{<Component title={js#"present"}/>}

example (Component : React.FunctionComponent OptionalProps) (name : Js String) :
    React.ReactM (Js React.Node) :=
  jsx%{<Component title={js#!"Hello {name}"}/>}

example (props : Js OptionalProps) (Component : React.FunctionComponent OptionalProps) :
    React.ReactM (Js React.Node) :=
  jsx%{<Component @props={props}/>}

example (Component : React.FunctionComponent OptionalProps) (absent : Js.Undefined)
    (maybeTitle : Js.UndefinedOr String) (nullableTitle : Js.Nullable String)
    (wrong : Js Float) (props : Js OptionalProps) : True := by
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component title={absent}/>}
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component title={maybeTitle}/>}
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component title={nullableTitle}/>}
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component title={wrong}/>}
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component title="a" title="b"/>}
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component unknown="a"/>}
  fail_if_success have _ : RuntimeM (Js String) := js_field% props "title"
  trivial

example (Component : React.FunctionComponent RequiredUndefinedProps) : True := by
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component/>}
  trivial

example (Component : React.FunctionComponent RequiredUndefinedProps) (title : Js String) :
    React.ReactM (Js React.Node) :=
  jsx%{<Component title={Js.UndefinedOr.ofJs title}/>}

example (Component : React.FunctionComponent OptionalUndefinedProps) (title : Js String) :
    React.ReactM (Js React.Node) :=
  jsx%{<Component title={Js.UndefinedOr.ofJs title}/>}

example (Component : React.FunctionComponent OptionalUndefinedProps) (title : Js.Nullable String) : True := by
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component title={title}/>}
  trivial

example (Component : React.FunctionComponent OptionalNullableProps) (title : Js.UndefinedOr String) : True := by
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component title={title}/>}
  trivial

structure MixedProps where
  requiredTitle : Js String
  title : Js String

attribute [js_optional] MixedProps.title

example (Component : React.FunctionComponent MixedProps) : React.ReactM (Js React.Node) :=
  jsx%{<Component requiredTitle="required"/>}

example (Component : React.FunctionComponent MixedProps) : True := by
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component/>}
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component title="present"/>}
  trivial

-- Tagging metadata cannot bypass the existing bounded schema checks.
structure NonNativeProps where
  title : String

attribute [js_optional] NonNativeProps.title

example (Component : React.FunctionComponent NonNativeProps) (props : Js NonNativeProps) : True := by
  fail_if_success have _ : React.ReactM (Js React.Node) := jsx%{<Component/>}
  fail_if_success have _ : RuntimeM (Js.UndefinedOr String) := js_field% props "title"
  trivial

/-- error: `js_optional` applies only to a props schema field projection -/
#guard_msgs in
attribute [js_optional] readTitle

end Vir.Fixtures.OptionalProps
