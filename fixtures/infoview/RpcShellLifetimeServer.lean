/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

meta import fixtures.infoview.RpcBrowserServer
import ShellLifetime

-- Reuse the actual RPC methods and Lean stale-guard component unchanged.
-- The browser asks the server to package these roots from this live snapshot.

-- rpc-position-a
example (n : Nat) : n = n := by
  rfl

-- rpc-position-b
example (p : Prop) (h : p) : p := by
  exact h
