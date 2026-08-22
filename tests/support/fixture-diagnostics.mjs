/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

function reportSections(report) {
  const sections = new Map();
  let current = null;
  for (const rawLine of report.split("\n")) {
    const line = rawLine.trim();
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      current = [];
      sections.set(heading[1], current);
    } else if (current !== null && line !== "" && line !== "None.") {
      current.push(line);
    }
  }
  return sections;
}

function parseLoadedDecl(line) {
  const match = line.match(/^- `([^`]+)` from `([^`]+)`$/);
  if (!match) return null;
  return { name: match[1], source: match[2], imported: match[2].startsWith("imported by ") };
}

function parseNativeExtern(line) {
  const match = line.match(/^- `([^`]+)` -> `([^`]+)`$/);
  if (!match) return null;
  return { name: match[1], symbol: match[2] };
}

function parseInitGlobal(line) {
  const match = line.match(/^- `([^`]+)` <- `([^`]+)`$/);
  if (!match) return null;
  return { name: match[1], initName: match[2] };
}

function parseDependency(line) {
  const match = line.match(/^- `([^`]+)`(?: \(via (.+)\))?$/);
  if (!match) return null;
  return { name: match[1], via: match[2]?.split(" -> ") ?? [] };
}

function parseSection(sections, header, parseLine) {
  return (sections.get(header) ?? []).map((line) => {
    const entry = parseLine(line);
    if (entry === null) {
      throw new Error(`invalid ${header} report line: ${JSON.stringify(line)}`);
    }
    return entry;
  });
}

function dependencyDetail(dependency) {
  const suffix = dependency.via.length === 0 ? "" : ` (via ${dependency.via.join(" -> ")})`;
  return `${dependency.name}${suffix}`;
}

export function packageDiagnostics(report) {
  const sections = reportSections(report);
  const loadedDecls = parseSection(sections, "Loaded IR Declarations", parseLoadedDecl);
  const nativeExterns = parseSection(sections, "Native Extern Declarations", parseNativeExtern);
  const initGlobals = parseSection(sections, "Initializer Globals", parseInitGlobal);
  const missingDecls = parseSection(sections, "Missing IR Declarations", parseDependency);
  const missingNativeExterns = parseSection(sections, "Missing Native Extern Registrations", parseDependency);
  const unsupportedInitGlobals = parseSection(sections, "Unsupported Init Globals", parseDependency);
  return {
    loadedDecls,
    importedDecls: loadedDecls.filter((decl) => decl.imported),
    nativeExterns,
    initGlobals,
    missingDecls,
    missingNativeExterns,
    unsupportedInitGlobals,
  };
}

export function classifyPackageFailure(diagnostics, stderr) {
  if (diagnostics.missingNativeExterns.length !== 0) {
    return { kind: "missing-native-extern", detail: diagnostics.missingNativeExterns.map(dependencyDetail).join(", ") };
  }
  if (diagnostics.missingDecls.length !== 0) {
    return { kind: "missing-ir-decl", detail: diagnostics.missingDecls.map(dependencyDetail).join(", ") };
  }
  if (diagnostics.unsupportedInitGlobals.length !== 0) {
    return {
      kind: "unsupported-init-global",
      detail: diagnostics.unsupportedInitGlobals.map(dependencyDetail).join(", "),
    };
  }
  if (stderr.includes("unsupported")) {
    return { kind: "unsupported-ir-package", detail: stderr.trim().split("\n")[0] };
  }
  return { kind: "package-generation-failed", detail: stderr.trim().split("\n")[0] || "unknown failure" };
}
