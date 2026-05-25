import Lean

namespace Vir.Fixtures.InterfaceShapes

open Lean

def arrayStringTotalLength (xs : Array String) : Nat :=
  xs.foldl (fun acc text => acc + text.length) 0

def listUInt32Sum (xs : List UInt32) : Nat :=
  xs.foldl (fun acc value => acc + value.toNat) 0

def optionNatBump : Option Nat → Option Nat
  | none => some 0
  | some value => some (value + 1)

def optionStringBang : Option String → Option String
  | none => some "empty"
  | some value => some (value ++ "!")

def optionNatScore : Option Nat → Nat
  | none => 7
  | some value => value + 11

def prodNatNatSwap (pair : Prod Nat Nat) : Prod Nat Nat :=
  (pair.snd, pair.fst)

def prodNatNatSum (pair : Prod Nat Nat) : Nat :=
  pair.fst + pair.snd

def optionArrayNatSum : Option (Array Nat) → Nat
  | none => 0
  | some values => values.foldl (· + ·) 0

def listProdNatStringScore (xs : List (Nat × String)) : Nat :=
  xs.foldl (fun acc pair => acc + pair.fst + pair.snd.length) 0

def prodStringNatSwap (pair : String × Nat) : Nat × String :=
  (pair.snd + 1, pair.fst ++ "!")

def arrayExprKindScore (xs : Array Expr) : Nat :=
  xs.foldl (fun acc expr =>
    acc +
      match expr with
      | .bvar idx => idx + 1
      | .const .. => 10
      | .lit (.natVal n) => n + 20
      | _ => 100) 0

def optionExprBump : Option Expr → Option Expr
  | none => some (.bvar 0)
  | some (.bvar idx) => some (.bvar (idx + 1))
  | some expr => some expr

structure Profile where
  nickname : String
  points : Nat
  tags : List String

structure ProfileSummary where
  label : String
  total : Nat
  bonus : Option Nat

structure ProfileEnvelope where
  profile : Profile
  summary : ProfileSummary

inductive ProfileTier where
  | basic
  | pro
  | elite

def tierScore : ProfileTier → Nat
  | .basic => 1
  | .pro => 10
  | .elite => 100

structure ProfileStats where
  enabled : Bool
  level : UInt8
  score16 : UInt16
  visits : UInt32
  quota : USize
  checksum : UInt64
  tier : ProfileTier
  note : String

def profileBump (profile : Profile) : Profile :=
  { profile with
    nickname := profile.nickname ++ "!"
    points := profile.points + profile.tags.length }

def profileScore (profile : Profile) : Nat :=
  profile.points + profile.nickname.length + profile.tags.foldl (fun acc tag => acc + tag.length) 0

def profileSummary (profile : Profile) : ProfileSummary :=
  {
    label := profile.nickname ++ ":" ++ toString profile.tags.length
    total := profileScore profile
    bonus := some (profile.points + 10)
  }

def profileEnvelopeScore (envelope : ProfileEnvelope) : Nat :=
  profileScore envelope.profile
    + envelope.summary.total
    + envelope.summary.label.length
    + envelope.summary.bonus.getD 0

def profileStatsBump (stats : ProfileStats) : ProfileStats :=
  { stats with
    enabled := !stats.enabled
    level := stats.level + 1
    score16 := stats.score16 + 2
    visits := stats.visits + 3
    quota := stats.quota + 4
    checksum := stats.checksum + 5
    tier := .elite
    note := stats.note ++ "!" }

def profileStatsScore (stats : ProfileStats) : Nat :=
  (if stats.enabled then 100 else 0)
    + stats.level.toNat
    + stats.score16.toNat
    + stats.visits.toNat
    + stats.quota.toNat
    + stats.checksum.toNat
    + tierScore stats.tier
    + stats.note.length

def interfaceShapeScore : Nat :=
  arrayStringTotalLength #["a", "bc"]
    + listUInt32Sum [1, 2, 3]
    + optionNatScore none
    + prodNatNatSum (4, 5)
    + optionArrayNatSum (some #[1, 2, 3])
    + listProdNatStringScore [(4, "ab"), (5, "c")]
    + arrayExprKindScore #[.const `Nat [], .bvar 2]
    + profileScore { nickname := "lean", points := 4, tags := ["ir", "wasm"] }
    + profileStatsScore {
      enabled := true,
      level := 2,
      score16 := 30,
      visits := 400,
      quota := 5,
      checksum := 6000,
      tier := .pro,
      note := "ok"
    }

end Vir.Fixtures.InterfaceShapes
