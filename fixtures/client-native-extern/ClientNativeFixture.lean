module

public import Vir

public section

namespace ClientNativeFixture

@[extern "vir_client_native_increment"]
def increment (value : UInt32) : UInt32 := value + 1

@[extern "vir_client_native_quoted_dot"]
def «quoted.dot» (value : UInt32) : UInt32 := value + 10

@[extern "vir_client_native_quoted_numeral"]
def «1» (value : UInt32) : UInt32 := value + 20

@[extern "vir_client_native_cafe"]
def café (value : UInt32) : UInt32 := value + 30

@[extern "vir_client_native_increment"]
def incompatibleIncrement (value extra : UInt32) : UInt32 := value + extra

vir_extern_fallback ClientNativeFixture.increment
vir_extern_fallback ClientNativeFixture.«quoted.dot»
vir_extern_fallback ClientNativeFixture.«1»
vir_extern_fallback ClientNativeFixture.café

@[vir_export]
def exportedIncrement (value : UInt32) : UInt32 := increment value

@[vir_export]
def exportedQuotedDot (value : UInt32) : UInt32 := «quoted.dot» value

@[vir_export]
def exportedQuotedNumeral (value : UInt32) : UInt32 := «1» value

@[vir_export]
def exportedCafe (value : UInt32) : UInt32 := café value

end ClientNativeFixture
