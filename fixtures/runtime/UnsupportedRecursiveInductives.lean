structure RecursiveBase where
  label : String

structure RecursiveChild extends RecursiveBase where
  next : Option RecursiveChild

mutual
inductive MutualLeft where
  | leaf (value : Nat)
  | step (right : MutualRight)
inductive MutualRight where
  | step (left : MutualLeft)
end

inductive ProofPayload where
  | mk (value : Nat) (proof : value = value)

def recursiveChildIdentity (box : RecursiveChild) : RecursiveChild := box
def mutualLeftIdentity (value : MutualLeft) : MutualLeft := value
def proofPayloadIdentity (value : ProofPayload) : ProofPayload := value
