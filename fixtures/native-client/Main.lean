import NativeClient

def main : IO Unit := do
  IO.println (NativeClient.greet "native 🌍")
  IO.println (NativeClient.double 9007199254740993)
  IO.println (String.fromUTF8! (Vir.Resources.encodeDescriptor NativeClient.descriptor))
