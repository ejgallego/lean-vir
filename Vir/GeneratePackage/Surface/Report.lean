/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.GeneratePackage.Surface

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR

private def jsonNames (names : Array Name) : String :=
  jsonArray (names.map jsonName)

private def surfaceIRTypeLabel : IRType → String
  | .float => "float"
  | .uint8 => "uint8"
  | .uint16 => "uint16"
  | .uint32 => "uint32"
  | .uint64 => "uint64"
  | .usize => "usize"
  | .erased => "erased"
  | .object => "object"
  | .tobject => "tobject"
  | .float32 => "float32"
  | .struct name _ => s!"struct:{name}"
  | .union name _ => s!"union:{name}"
  | .tagged => "tagged"
  | .void => "void"

private def NativeExtern.surfaceJson (ext : NativeExtern) : String :=
  jsonObject #[
    ("name", jsonName ext.name),
    ("symbol", jsonString ext.symbol),
    ("generateBoxedWrapper", jsonBool ext.generateBoxedWrapper),
    ("params", jsonArray (ext.params.map fun param => jsonObject #[
      ("index", jsonNat param.x.idx),
      ("borrow", jsonBool param.borrow),
      ("type", jsonString (surfaceIRTypeLabel param.ty))
    ])),
    ("resultType", jsonString (surfaceIRTypeLabel ext.resultType)),
    ("deps", jsonNames ext.deps)
  ]

private def SurfaceBlocker.toJson (blocker : SurfaceBlocker) : String :=
  jsonObject #[
    ("kind", jsonString blocker.kind.label),
    ("name", jsonName blocker.name)
  ]

private def SurfaceCounts.toJson (counts : SurfaceCounts) : String :=
  jsonObject #[
    ("total", jsonNat counts.total),
    ("runnable", jsonNat counts.runnable),
    ("blocked", jsonNat counts.blocked),
    ("publicTotal", jsonNat counts.publicTotal),
    ("publicRunnable", jsonNat counts.publicRunnable),
    ("privateTotal", jsonNat counts.privateTotal),
    ("boxedTotal", jsonNat counts.boxedTotal),
    ("generatedTotal", jsonNat counts.generatedTotal)
  ]

private def SurfaceModuleResult.toJson (result : SurfaceModuleResult) : String :=
  jsonObject #[
    ("name", jsonName result.name),
    ("counts", result.counts.toJson)
  ]

private def SurfaceLibraryResult.toJson (result : SurfaceLibraryResult) : String :=
  jsonObject #[
    ("name", jsonName result.name),
    ("modulesWithFunctions", jsonNat result.modulesWithFunctions),
    ("counts", result.counts.toJson)
  ]

private def SurfaceBlockerSummary.toJson (summary : SurfaceBlockerSummary) : String :=
  jsonObject #[
    ("blocker", summary.blocker.toJson),
    ("roots", jsonNat summary.roots),
    ("publicRoots", jsonNat summary.publicRoots),
    ("exampleRoot", jsonName summary.exampleRoot),
    ("examplePath", jsonNames summary.examplePath)
  ]

private def SurfaceDeclResult.toJson (result : SurfaceDeclResult) : String :=
  jsonObject #[
    ("name", jsonName result.name),
    ("module", jsonName result.moduleName),
    ("kind", jsonString result.kind.label),
    ("runnable", jsonBool result.runnable),
    ("blocker", result.blocker?.map SurfaceBlocker.toJson |>.getD "null"),
    ("blockerPath", jsonNames result.blockerPath)
  ]

/-- Machine-readable complete declaration and module surface report. -/
def SurfaceReport.toJson (report : SurfaceReport) : String :=
  let externs := report.nativeExterns.qsort fun lhs rhs => lhs.name.toString < rhs.name.toString
  jsonObject #[
    ("format", jsonString surfaceReportFormat),
    ("version", jsonNat currentSurfaceReportVersion),
    ("lean", jsonObject #[
      ("version", jsonString Lean.versionString),
      ("toolchain", jsonString Lean.toolchain),
      ("githash", jsonString Lean.githash)
    ]),
    ("definition", jsonObject #[
      ("headline", jsonString "static transitive IR closure completeness"),
      ("encodingIsGate", jsonBool false),
      ("interfaceCallabilityIsGate", jsonBool false),
      ("dynamicValidationIsGate", jsonBool false),
      ("primaryBlockerPolicy", jsonString "deterministic nearest terminal blocker")
    ]),
    ("selectedModules", jsonNames report.selectedModules),
    ("loadedModules", jsonNat report.loadedModules),
    ("runtimeCapabilities", jsonObject #[
      ("nativeExternCount", jsonNat externs.size),
      ("nativeExterns", jsonArray (externs.map NativeExtern.surfaceJson))
    ]),
    ("counts", report.counts.toJson),
    ("libraries", jsonArray (report.libraries.map SurfaceLibraryResult.toJson)),
    ("modules", jsonArray (report.modules.map SurfaceModuleResult.toJson)),
    ("primaryBlockers", jsonArray (report.blockers.map SurfaceBlockerSummary.toJson)),
    ("declarations", jsonArray (report.declarations.map SurfaceDeclResult.toJson))
  ]

private def percentTenths (part total : Nat) : String :=
  if total == 0 then
    "n/a"
  else
    let value := (part * 1000 + total / 2) / total
    s!"{value / 10}.{value % 10}%"

private def ratio (part total : Nat) : String :=
  s!"{part} / {total} ({percentTenths part total})"

private def displayName (name : Name) : String :=
  if name.isAnonymous then "(unknown)" else name.toString

private def pathText (path : Array Name) : String :=
  " → ".intercalate (path.map displayName).toList

/-- Human-readable overview; exact per-function status remains in the JSON report. -/
def SurfaceReport.toMarkdown (report : SurfaceReport) : String :=
  let summary := report.counts
  let moduleRows := report.modules.map fun result =>
    s!"| `{displayName result.name}` | {ratio result.counts.publicRunnable result.counts.publicTotal} | " ++
      s!"{ratio result.counts.runnable result.counts.total} | {result.counts.blocked} |"
  let libraryRows := report.libraries.map fun result =>
    s!"| `{displayName result.name}` | {result.modulesWithFunctions} | " ++
      s!"{ratio result.counts.publicRunnable result.counts.publicTotal} | " ++
      s!"{ratio result.counts.runnable result.counts.total} | {result.counts.blocked} |"
  let blockerRows := report.blockers.take 50 |>.map fun summary =>
    s!"| `{summary.blocker.kind.label}` | `{displayName summary.blocker.name}` | " ++
      s!"{summary.publicRoots} | {summary.roots} | `{pathText summary.examplePath}` |"
  "# VIR Lean Library Surface\n\n" ++
  "This is a static transitive-closure report. `.irpkg` encoding, direct JavaScript " ++
  "callability, and dynamic semantic validation are intentionally separate axes.\n\n" ++
  "## Summary\n\n" ++
  s!"- Lean: `{Lean.versionString}` (`{Lean.githash}`)\n" ++
  s!"- Selected modules: {report.selectedModules.size}\n" ++
  s!"- Loaded modules including dependencies: {report.loadedModules}\n" ++
  s!"- Native runtime capabilities: {report.nativeExterns.size}\n" ++
  s!"- Public constants with IR runnable: {ratio summary.publicRunnable summary.publicTotal}\n" ++
  s!"- All IR functions runnable: {ratio summary.runnable summary.total}\n" ++
  s!"- Blocked IR functions: {summary.blocked}\n\n" ++
  "## By Library\n\n" ++
  "| Library | Modules with functions | Public constants runnable | All IR runnable | Blocked |\n" ++
  "| --- | ---: | ---: | ---: | ---: |\n" ++
  "\n".intercalate libraryRows.toList ++ "\n\n" ++
  "## Per Module\n\n" ++
  "| Module | Public constants runnable | All IR runnable | Blocked |\n" ++
  "| --- | ---: | ---: | ---: |\n" ++
  "\n".intercalate moduleRows.toList ++ "\n\n" ++
  "## Top Primary Blockers\n\n" ++
  "A blocked function may reach more than one unsupported boundary. This table assigns " ++
  "each function one deterministic nearest blocker so its rows do not double-count roots.\n\n" ++
  "| Kind | Boundary | Public roots | All roots | Example path |\n" ++
  "| --- | --- | ---: | ---: | --- |\n" ++
  (if blockerRows.isEmpty then "| — | — | 0 | 0 | — |" else "\n".intercalate blockerRows.toList) ++
  "\n\nThe JSON companion contains every analyzed declaration and its representative blocker path.\n"

end Vir.GeneratePackage
