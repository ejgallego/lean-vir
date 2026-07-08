/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean

namespace Vir.Fixtures.FormatPretty

open Std

inductive PrettyCase where
  | group
  | list
  | fill
  | nested
  | all

def groupedLineDoc : Format :=
  Format.group ("hello" ++ Format.line ++ "world")

def hardLineDoc : Format :=
  "αβ" ++ Format.text "\n" ++ "γ"

def nestedDoc : Format :=
  Format.nest 2 ("." ++ Format.align false ++ "a" ++ Format.line ++ "b")

def listDoc : Format :=
  Format.group <|
    Format.nest 1 <|
      "[" ++ "alpha," ++ Format.line ++
      "beta," ++ Format.line ++
      "gamma" ++ "]"

def paragraphDoc : Format :=
  Format.fill <|
    "lean" ++ Format.line ++
    "ir" ++ Format.line ++
    "runs" ++ Format.line ++
    "format.pretty" ++ Format.line ++
    "inside wasm"

def demoWidth (width : Nat) : Nat :=
  if width < 4 then 4 else width

def formatPrettyScore : Nat :=
  let wide := Format.pretty groupedLineDoc 80
  let narrow := Format.pretty groupedLineDoc 8
  let hard := Format.pretty hardLineDoc 80
  let nested := Format.pretty nestedDoc 5
  let list := Format.pretty listDoc 12
  let paragraph := Format.pretty paragraphDoc 16
  wide.length + narrow.length + hard.length + nested.length +
    (if wide == "hello world" then 1000 else 0) +
    (if narrow == "hello\nworld" then 1000 else 0) +
    (if hard == "αβ\nγ" then 1000 else 0) +
    (if nested == ". a\n  b" then 1000 else 0) +
    list.length + (if list == "[alpha,\n beta,\n gamma]" then 1000 else 0) +
    paragraph.length + (if paragraph == "lean ir runs\nformat.pretty\ninside wasm" then 1000 else 0)

def formatPrettyPreview : String :=
  let wide := Format.pretty groupedLineDoc 80
  let narrow := Format.pretty groupedLineDoc 8
  let hard := Format.pretty hardLineDoc 80
  let nested := Format.pretty nestedDoc 5
  let list := Format.pretty listDoc 12
  let paragraph := Format.pretty paragraphDoc 16
  "wide group:\n" ++ wide ++
    "\n---\nnarrow group:\n" ++ narrow ++
    "\n---\nhard newline:\n" ++ hard ++
    "\n---\nnested align:\n" ++ nested ++
    "\n---\nlist group:\n" ++ list ++
    "\n---\nfill paragraph:\n" ++ paragraph

def formatPrettyAtWidth (width : Nat) : String :=
  let width := demoWidth width
  "group:\n" ++ Format.pretty groupedLineDoc width ++
    "\n---\nlist:\n" ++ Format.pretty listDoc width ++
    "\n---\nfill:\n" ++ Format.pretty paragraphDoc width ++
    "\n---\nnested:\n" ++ Format.pretty nestedDoc width

def formatPrettyCaseAtWidth (caseName : PrettyCase) (width : Nat) : String :=
  let width := demoWidth width
  match caseName with
  | .group => Format.pretty groupedLineDoc width
  | .list => Format.pretty listDoc width
  | .fill => Format.pretty paragraphDoc width
  | .nested => Format.pretty nestedDoc width
  | .all => formatPrettyAtWidth width

def formatBoundaryPretty (doc : Format) (width : Nat) : String :=
  Format.pretty doc (demoWidth width)

def formatBoundaryRoundtrip (doc : Format) : Format :=
  Format.group (Format.tag 7 doc) .fill

end Vir.Fixtures.FormatPretty
