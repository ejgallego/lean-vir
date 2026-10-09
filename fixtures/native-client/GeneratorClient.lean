module

public meta import Vir.GeneratePackage

run_meta do
  let target : Vir.GeneratePackage.Target := {
    origin := .module `NativeClient, mode := .marked }
  unless target.publicSource == "module NativeClient" do
    Lean.throwError "unexpected native-loaded generator target"
