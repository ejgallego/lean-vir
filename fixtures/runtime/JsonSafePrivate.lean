/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
-/
module
public section
namespace JsonSafePrivate
structure Secret where
  private mk ::
  private amount : Nat
def amount (value : Secret) : Nat := value.amount
end JsonSafePrivate
