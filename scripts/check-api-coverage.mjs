#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docPath = path.join(root, "docs/API_COVERAGE.md");
const tsvPath = path.join(root, "docs/API_COVERAGE.tsv");

const expectedColumns = [
  "id",
  "area",
  "layer",
  "status",
  "lean_surface",
  "js_surface",
  "tests",
  "notes",
  "next",
];

const allowedAreas = new Set([
  "core",
  "browser",
  "react",
  "infoview",
  "proofwidgets",
]);
const allowedLayers = new Set([
  "action",
  "compat",
  "dom",
  "interface",
  "renderer",
  "rpc",
  "shell",
  "surface",
]);
const allowedStatuses = new Set(["supported", "partial", "missing"]);

function fail(message) {
  console.error(`API coverage check failed: ${message}`);
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
if (![...args].every((arg) => arg === "--write")) {
  fail("usage: node scripts/check-api-coverage.mjs [--write]");
}

const doc = await readFile(docPath, "utf8");
const blocks = [
  ...doc.matchAll(/^```vir-api-coverage[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm),
];
if (blocks.length !== 1) {
  fail(
    "expected exactly one vir-api-coverage fenced block in " +
      `docs/API_COVERAGE.md, found ${blocks.length}`,
  );
}

const canonicalTsv = `${blocks[0][1].replace(/\r\n/g, "\n").replace(/\n+$/g, "")}\n`;
const lines = canonicalTsv.trimEnd().split("\n");
if (lines.length < 2) {
  fail("coverage block must contain a header and at least one row");
}

const header = lines[0].split("\t");
if (header.join("\t") !== expectedColumns.join("\t")) {
  fail(`unexpected header: ${header.join(", ")}`);
}

const ids = new Set();
const idPattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const rows = lines.slice(1).map((line, index) => {
  const lineNumber = index + 2;
  if (line.trim() === "") {
    fail(`blank row at coverage line ${lineNumber}`);
  }
  const fields = line.split("\t");
  if (fields.length !== expectedColumns.length) {
    fail(
      `coverage line ${lineNumber} has ${fields.length} fields, ` +
        `expected ${expectedColumns.length}`,
    );
  }
  const row = Object.fromEntries(
    expectedColumns.map((column, fieldIndex) => [column, fields[fieldIndex]]),
  );
  for (const column of expectedColumns) {
    if (row[column] === "") {
      fail(`coverage line ${lineNumber} has empty ${column}`);
    }
  }
  if (!idPattern.test(row.id)) {
    fail(`coverage line ${lineNumber} has invalid id ${JSON.stringify(row.id)}`);
  }
  if (ids.has(row.id)) {
    fail(`duplicate id ${row.id}`);
  }
  ids.add(row.id);
  if (!allowedAreas.has(row.area)) {
    fail(`coverage line ${lineNumber} has invalid area ${JSON.stringify(row.area)}`);
  }
  if (!allowedLayers.has(row.layer)) {
    fail(`coverage line ${lineNumber} has invalid layer ${JSON.stringify(row.layer)}`);
  }
  if (!allowedStatuses.has(row.status)) {
    fail(`coverage line ${lineNumber} has invalid status ${JSON.stringify(row.status)}`);
  }
  if (row.status === "supported" && row.tests === "none") {
    fail(`supported row ${row.id} must name at least one test surface`);
  }
  if (row.status === "missing") {
    if (row.lean_surface !== "none" || row.js_surface !== "none" || row.tests !== "none") {
      fail(
        `missing row ${row.id} must use none for lean_surface, ` +
          "js_surface, and tests",
      );
    }
  } else {
    if (row.lean_surface === "none" || row.js_surface === "none" || row.tests === "none") {
      fail(`${row.status} row ${row.id} must name Lean, JS, and test surfaces`);
    }
  }
  if (row.status !== "supported" && row.next === "none") {
    fail(`${row.status} row ${row.id} must name a follow-up in next`);
  }
  return row;
});

if (args.has("--write")) {
  await writeFile(tsvPath, canonicalTsv);
  console.log(`wrote docs/API_COVERAGE.tsv from ${rows.length} docs rows`);
} else {
  const existingTsv = (await readFile(tsvPath, "utf8")).replace(/\r\n/g, "\n");
  if (existingTsv !== canonicalTsv) {
    fail("docs/API_COVERAGE.tsv is stale; run node scripts/check-api-coverage.mjs --write");
  }
  console.log(`validated ${rows.length} API coverage rows from docs/API_COVERAGE.md`);
}
