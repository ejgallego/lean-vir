import Vir

@[extern "vir_test_increment"]
def externIncrement (n : Nat) : Nat := n + 1

@[extern "vir_test_borrowed_identity"]
def externBorrowedIdentity (input : @& ByteArray) : ByteArray := input

@[extern "vir_test_owned_size"]
def externOwnedSize (input : ByteArray) : Nat := input.size

vir_extern_fallback externIncrement, externBorrowedIdentity, externOwnedSize

@[vir_export]
def callExternIncrement (n : Nat) : Nat := externIncrement n

@[vir_export]
def callExternBorrowedIdentity (input : ByteArray) : ByteArray :=
  externBorrowedIdentity input

@[vir_export]
def callExternOwnedSize (input : ByteArray) : Nat := externOwnedSize input
