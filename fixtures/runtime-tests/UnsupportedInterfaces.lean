import Vir.React

inductive IndexedPair : Nat → Type where
  | mk (left : Nat) (right : Nat) : IndexedPair 0

def indexedPairIdentity (box : IndexedPair 0) : IndexedPair 0 := box
def implicitBump {offset : Nat} (n : Nat) : Nat := n + offset
def polymorphicJsIdentity {α : Type} (value : Lean.Vir.Js α) : Lean.Vir.Js α := value
def nakedElementIdentity (element : Lean.Vir.Browser.Element) : Lean.Vir.Browser.Element := element
def nakedReactRootIdentity (root : Lean.Vir.React.Root) : Lean.Vir.React.Root := root
def nakedStateSetterIdentity (setter : Lean.Vir.React.StateSetter Nat) : Lean.Vir.React.StateSetter Nat := setter
def nakedPropsIdentity (props : Lean.Vir.React.Props) : Lean.Vir.React.Props := props
