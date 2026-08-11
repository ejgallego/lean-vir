import Vir

namespace ClientNativeFixture

@[extern "vir_client_native_increment"]
def increment (value : UInt32) : UInt32 := value + 1

@[extern "vir_client_native_increment"]
def incompatibleIncrement (value extra : UInt32) : UInt32 := value + extra

vir_extern_fallback ClientNativeFixture.increment

@[vir_export]
def exportedIncrement (value : UInt32) : UInt32 := increment value

end ClientNativeFixture
