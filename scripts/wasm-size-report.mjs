#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const DEFAULT_WASM_PATHS = [
  "web/public/vir-upstream.wasm",
  "web/public/vir-upstream.dev.wasm",
];
const DEFAULT_MAP_PATH = "build/upstream-probe/link.map";
const SECTION_NAMES = new Map([
  [0, "Custom"],
  [1, "Type"],
  [2, "Import"],
  [3, "Function"],
  [4, "Table"],
  [5, "Memory"],
  [6, "Global"],
  [7, "Export"],
  [8, "Start"],
  [9, "Element"],
  [10, "Code"],
  [11, "Data"],
  [12, "DataCount"],
]);

function usage() {
  console.log(`Usage: node scripts/wasm-size-report.mjs [options] [WASM ...]

Emit Markdown size tables for WASM sections and, when a linker map is
available, a code-area attribution table for the first WASM file.

Options:
  --map PATH   Read a wasm-ld --Map file for code-area attribution.
               Defaults to ${DEFAULT_MAP_PATH} when it exists.
  --no-map     Do not emit code-area attribution.
  --top N      Number of detailed object/member rows to print. Default: 15.
  -h, --help   Show this help.
`);
}

function parseArgs(argv) {
  const wasmPaths = [];
  let mapPath = null;
  let useDefaultMap = true;
  let detailLimit = 15;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    if (arg === "--map") {
      mapPath = argv[index + 1];
      if (!mapPath || mapPath.startsWith("--")) {
        throw new Error("--map requires a path");
      }
      useDefaultMap = false;
      index += 1;
      continue;
    }
    if (arg === "--no-map") {
      mapPath = null;
      useDefaultMap = false;
      continue;
    }
    if (arg === "--top") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--top requires a non-negative integer");
      }
      detailLimit = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    }
    wasmPaths.push(arg);
  }

  const paths = wasmPaths.length === 0
    ? DEFAULT_WASM_PATHS.filter((path) => existsSync(path))
    : wasmPaths;
  if (paths.length === 0) {
    throw new Error(`no WASM files supplied and no default artifacts found; run npm run build:demo first`);
  }
  if (useDefaultMap && existsSync(DEFAULT_MAP_PATH)) {
    mapPath = DEFAULT_MAP_PATH;
  }
  return { help: false, wasmPaths: paths, mapPath, detailLimit };
}

function readU32(buffer, offset) {
  let result = 0;
  let shift = 0;
  let position = offset;
  while (position < buffer.length) {
    const byte = buffer[position];
    position += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result >>> 0, next: position };
    shift += 7;
  }
  throw new Error("unexpected EOF while reading varuint32");
}

function parseWasm(path) {
  const buffer = readFileSync(path);
  if (buffer.length < 8 || buffer.readUInt32LE(0) !== 0x6d736100) {
    throw new Error(`${path} is not a WebAssembly binary`);
  }

  const sections = [];
  let offset = 8;
  while (offset < buffer.length) {
    const start = offset;
    const id = buffer[offset];
    offset += 1;
    const length = readU32(buffer, offset);
    offset = length.next;
    const payloadStart = offset;
    const payloadEnd = offset + length.value;
    if (payloadEnd > buffer.length) {
      throw new Error(`${path} has a section that extends past EOF`);
    }

    let label = SECTION_NAMES.get(id) ?? `Section ${id}`;
    if (id === 0) {
      const nameLength = readU32(buffer, payloadStart);
      const nameStart = nameLength.next;
      const nameEnd = nameStart + nameLength.value;
      if (nameEnd > payloadEnd) {
        throw new Error(`${path} has a custom section name that extends past its payload`);
      }
      label = `Custom:${buffer.subarray(nameStart, nameEnd).toString("utf8")}`;
    }

    const bytes = buffer.subarray(start, payloadEnd);
    sections.push({
      label,
      rawBytes: bytes.length,
      gzipBytes: gzipSize(bytes),
    });
    offset = payloadEnd;
  }

  return {
    path,
    buffer,
    rawBytes: buffer.length,
    gzipBytes: gzipSize(buffer),
    sections,
  };
}

function gzipSize(buffer) {
  const result = spawnSync("gzip", ["-9cn"], {
    input: buffer,
    maxBuffer: Math.max(1024 * 1024, buffer.length * 2),
  });
  if (result.status === 0) return result.stdout.length;

  return gzipSync(buffer, { level: 9, mtime: 0 }).length;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes.toLocaleString("en-US")} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatPercent(numerator, denominator) {
  return `${((numerator * 100) / denominator).toFixed(1)}%`;
}

function printSectionReport(report) {
  console.log(`## ${report.path}`);
  console.log();
  console.log(`Full file: ${formatBytes(report.rawBytes)} raw, ${formatBytes(report.gzipBytes)} gzip -9 -n`);
  console.log();
  console.log("| Section | Raw | Raw % | gzip | gzip % |");
  console.log("| --- | ---: | ---: | ---: | ---: |");
  for (const section of [...report.sections].sort((a, b) => b.rawBytes - a.rawBytes)) {
    console.log(
      `| ${section.label} | ${formatBytes(section.rawBytes)} | ` +
      `${formatPercent(section.rawBytes, report.rawBytes)} | ` +
      `${formatBytes(section.gzipBytes)} | ${formatPercent(section.gzipBytes, report.gzipBytes)} |`,
    );
  }
  console.log();
}

function mapAreaFor(input) {
  if (input === "<internal>") return "Linker/internal glue";
  if (input.includes("libc++.a(") || input.includes("libc++abi.a(")) return "WASI SDK C++ runtime";
  if (input.includes("libc.a(") || input.includes("crt1-")) return "WASI libc / startup";
  if (input.includes("libclang_rt.builtins")) return "compiler-rt builtins";
  if (input.endsWith("/ir_interpreter.o") || input.endsWith("build/upstream-probe/obj/ir_interpreter.o") ||
      input === "build/upstream-probe/obj/ir_interpreter.o") {
    return "Lean upstream IR interpreter";
  }
  if (input.includes("third_party_lean4-src_src_runtime_")) return "Lean C runtime";
  if (input.includes("third_party_lean4-src_src_util_name.cpp.o")) return "Lean name support";
  if (input.includes("wasm_upstream_shim_native_symbols.cpp.o")) return "VIR native extern wrappers";
  if (input.includes("wasm_upstream_shim_native_symbol_lookup.cpp.o")) return "VIR native extern registry";
  if (input.includes("wasm_upstream_shim_")) return "VIR WASI/JS shim and package ABI";
  return "Other";
}

function mapDetailFor(input) {
  if (input === "<internal>") return "<internal>";
  const archiveMember = input.match(/([^/]+\.a)\(([^)]+)\)$/);
  if (archiveMember) return `${archiveMember[1]}(${archiveMember[2]})`;
  return input.split("/").at(-1);
}

function isMapInput(input) {
  return input === "<internal>" ||
    input.includes(".o") ||
    input.includes(".a(") ||
    input.includes(".obj") ||
    input.includes("crt1-");
}

function parseLinkMap(path, wasmReport) {
  const groups = new Map();
  const details = new Map();
  const sectionTotals = new Map();
  let currentSection = null;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(\S+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)(?:\s+(.*?))?\s*$/);
    if (!match) continue;

    const offset = Number.parseInt(match[2], 16);
    const size = Number.parseInt(match[3], 16);
    const rest = match[4] ?? "";
    if (/^[A-Z][A-Z0-9_]*$/.test(rest)) {
      currentSection = rest;
      sectionTotals.set(rest, (sectionTotals.get(rest) ?? 0) + size);
      continue;
    }

    if (currentSection !== "CODE" && currentSection !== "DATA") continue;
    if (currentSection === "DATA" && offset === 0) continue; // .bss is memory footprint, not file bytes.

    const inputMatch = rest.match(/^(.+?):\(/);
    if (!inputMatch || !isMapInput(inputMatch[1])) continue;
    const input = inputMatch[1];
    const area = mapAreaFor(input);
    const range = [offset, size];

    const group = groups.get(area) ?? { rawBytes: 0, ranges: [], count: 0 };
    group.rawBytes += size;
    group.ranges.push(range);
    group.count += 1;
    groups.set(area, group);

    const detailKey = `${area}\t${mapDetailFor(input)}`;
    const detail = details.get(detailKey) ?? {
      area,
      name: mapDetailFor(input),
      rawBytes: 0,
      ranges: [],
      count: 0,
    };
    detail.rawBytes += size;
    detail.ranges.push(range);
    detail.count += 1;
    details.set(detailKey, detail);
  }

  const withGzip = (entry) => {
    const chunks = entry.ranges
      .slice()
      .sort((a, b) => a[0] - b[0])
      .map(([offset, size]) => {
        if (offset + size > wasmReport.buffer.length) {
          throw new Error(`${path} does not match ${wasmReport.path}; map range extends past EOF`);
        }
        return wasmReport.buffer.subarray(offset, offset + size);
      });
    return {
      ...entry,
      gzipBytes: gzipSize(Buffer.concat(chunks)),
    };
  };

  return {
    source: path,
    codeDataBytes: (sectionTotals.get("CODE") ?? 0) + (sectionTotals.get("DATA") ?? 0),
    groups: [...groups.entries()]
      .map(([area, entry]) => ({ area, ...withGzip(entry) }))
      .sort((a, b) => b.rawBytes - a.rawBytes),
    details: [...details.values()]
      .map(withGzip)
      .sort((a, b) => b.rawBytes - a.rawBytes),
  };
}

function printAttribution(report, mapReport, detailLimit) {
  const attributedBytes = mapReport.groups.reduce((sum, entry) => sum + entry.rawBytes, 0);
  console.log(`## Code Area Attribution: ${report.path}`);
  console.log();
  console.log(`Source map: ${mapReport.source}`);
  console.log();
  console.log(
    `Attribution covers ${formatBytes(attributedBytes)} of ` +
    `${formatBytes(mapReport.codeDataBytes)} Code+Data section bytes. ` +
    "gzip columns compress each area independently and are not additive.",
  );
  console.log();
  console.log("| Area | Raw | Raw % of file | Raw % of Code+Data | gzip | gzip % of file |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const entry of mapReport.groups) {
    console.log(
      `| ${entry.area} | ${formatBytes(entry.rawBytes)} | ` +
      `${formatPercent(entry.rawBytes, report.rawBytes)} | ` +
      `${formatPercent(entry.rawBytes, mapReport.codeDataBytes)} | ` +
      `${formatBytes(entry.gzipBytes)} | ${formatPercent(entry.gzipBytes, report.gzipBytes)} |`,
    );
  }
  console.log();

  if (detailLimit > 0) {
    console.log(`Top ${detailLimit} object/member contributors:`);
    console.log();
    console.log("| Object/member | Area | Raw | gzip |");
    console.log("| --- | --- | ---: | ---: |");
    for (const entry of mapReport.details.slice(0, detailLimit)) {
      console.log(`| \`${entry.name}\` | ${entry.area} | ${formatBytes(entry.rawBytes)} | ${formatBytes(entry.gzipBytes)} |`);
    }
    console.log();
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const reports = args.wasmPaths.map(parseWasm);
  console.log("# WASM Size Report");
  console.log();
  console.log("gzip columns use `gzip -9 -n` when available.");
  console.log();
  for (const report of reports) {
    printSectionReport(report);
  }

  if (args.mapPath) {
    if (!existsSync(args.mapPath)) {
      throw new Error(`linker map not found: ${args.mapPath}`);
    }
    printAttribution(reports[0], parseLinkMap(args.mapPath, reports[0]), args.detailLimit);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Run node scripts/wasm-size-report.mjs --help for usage.");
  process.exit(1);
}
