import Vir

@[extern "vir_test_increment"]
def externIncrement (n : Nat) : Nat := n + 1

vir_extern_fallback externIncrement

@[vir_export]
def callExternIncrement (n : Nat) : Nat := externIncrement n
