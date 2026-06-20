abbrev AliasUserId := Nat
abbrev AliasNatArray := Array AliasUserId
abbrev AliasCallback := AliasUserId -> AliasUserId
abbrev AliasIO (α : Type) := IO α

def aliasArraySum (xs : AliasNatArray) : AliasUserId :=
  xs.foldl (fun acc n => acc + n) 0

def aliasCallbackApply (callback : AliasCallback) (n : AliasUserId) : AliasUserId :=
  callback n

def aliasIoBump (n : AliasUserId) : AliasIO AliasUserId :=
  pure (n + 1)
