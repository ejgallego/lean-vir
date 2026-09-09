/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  buildBindingExplorerReport,
  renderBindingExplorerHtml,
} from "../../scripts/bindings/binding-explorer.mjs";
import {
  renderTypeAnchorReport,
} from "../../scripts/bindings/type-anchor-renderer.mjs";
import {
  emitGeneratedFile,
  requiredValue,
} from "../../scripts/bindings/tool-utils.mjs";
import {
  repositoryPath,
  repositoryRoot,
} from "../../scripts/repository-paths.mjs";

test("binding explorer rendering injects one script-safe report", () => {
  const template = "<script id=\"report-data\">__VIR_BINDING_REPORT__</script>";
  const rendered = renderBindingExplorerHtml(template, { unsafe: "</script>" });

  assert.equal(
    rendered,
    '<script id="report-data">{"unsafe":"\\u003c/script>"}</script>',
  );
  assert.throws(
    () => renderBindingExplorerHtml("no marker", {}),
    /exactly one report marker/u,
  );
});

const demoTypeScriptSurface = {
  symbols: [{
    id: "Widget.render",
    kind: "method",
    surfaceRoot: "Widget",
    display: "render(): void;",
    source: { path: "demo.d.ts", startLine: 1 },
    shape: { kind: "function", args: [], result: { kind: "primitive", name: "void" } },
  }],
};

function demoProtocolOperation(target, semantics) {
  return {
    id: target,
    group: "widget",
    target,
    lean: `Lean.Vir.Demo.Widget.${target.split(".").at(-1)}`,
    marker: "vir_js",
    reason: `${target} has reviewed ${semantics} behavior.`,
    upstreamRelation: { kind: "upstream-adapter", member: "Widget.render", semantics },
    effect: { id: "runtime", lean: "RuntimeM" },
    arguments: [],
    result: { type: { lean: "Unit", representation: "immediate" } },
  };
}

function demoGeneration(protocolOperations) {
  return {
    output: "Vir/Demo/Generated.lean",
    imports: ["Vir.Demo.Types"],
    namespace: "Lean.Vir.Demo",
    abiProfile: {
      id: "demo-v1",
      effect: { id: "runtime", lean: "RuntimeM" },
      types: { void: { lean: "Unit", representation: "immediate" } },
      resource: {
        constructor: "Lean.Vir.Js",
        nullableConstructor: "Lean.Vir.Js.Nullable",
        argument: { passing: "borrowed", retention: "call" },
        result: { ownership: "owned" },
      },
      receiver: {
        default: { passing: "borrowed", retention: "call" },
        globalTypes: {},
      },
    },
    resources: {},
    members: [],
    methodPolicies: {},
    exceptions: {},
    protocolOperations,
  };
}

function buildDemoReport(targets, {
  unsupported = [],
  protocolOperations = [],
  mappings,
  surface = demoTypeScriptSurface,
  publicEntries = [],
} = {}) {
  const generation = demoGeneration(protocolOperations);
  generation.resources = { Widget: "Widget" };
  generation.members = (mappings ?? []).map((mapping) => mapping.typescript);
  return buildBindingExplorerReport(
    {
      format: "lean-vir-shipped-bindings-coverage",
      version: 1,
      lean: {},
      providers: [],
      summary: {
        totalTargets: targets.length,
        provided: targets.length,
        missingProvider: 0,
        runtimeOnly: 0,
        publicEntries: publicEntries.length,
        publicTargetEdges: publicEntries.reduce((sum, entry) => sum + entry.targets.length, 0),
        targetsReachedByPublicEntries: new Set(publicEntries.flatMap((entry) =>
          entry.targets.map(({ target }) => target))).size,
      },
      bindings: targets.map((target) => ({
        target,
        status: "provided",
        declarations: [{ module: "Vir.Demo", source: { path: generation.output } }],
        providers: ["demo"],
      })),
      publicEntries,
    },
    [{
      id: "demo",
      title: "Demo",
      description: "Demo bindings.",
      path: "Vir/Demo.bindings.json",
      lean: { modules: ["Vir.Demo"] },
      generation,
      roots: [{
        id: "widget",
        title: "Widget",
        targets: ["demo.widget.*"],
        lean: { public: ["Lean.Vir.Demo.Widget"] },
        upstream: { kind: "typescript", roots: ["Widget"] },
        unsupported,
        ...(mappings === undefined ? {} : { mappings }),
      }],
    }],
    new Map([["demo/widget", surface]]),
    repositoryPath("build", "bindings", "demo.coverage.json"),
  );
}

test("unsupported members are excluded from automatic correspondence", () => {
  const target = "demo.widget.render";
  const report = buildDemoReport([target], {
    unsupported: [{
      typescript: "Widget.render",
      scope: "symbol",
      note: "Not part of the VIR surface.",
    }],
  });
  const group = report.libraries[0].apiGroups[0];
  const member = group.coverage.members[0];

  assert.equal(member.status, "missing");
  assert.equal(member.generation.disposition, "unsupported");
  assert.equal(member.generation.semanticCoverage.status, "not-provided");
  assert.equal(member.generation.candidateTargets, undefined);
  assert.deepEqual(group.coverage.targetMappings, [{
    target,
    status: "unmatched",
    source: "automatic",
    candidates: [],
  }]);
  assert.ok(group.workItems.some((item) =>
    item.code === "upstream-identity-missing" && item.target === target));
});

test("changing operations conservatively determine mixed member coverage", () => {
  const targets = ["demo.widget.render", "demo.widget.renderAdapted"];
  const report = buildDemoReport(targets, {
    protocolOperations: [
      demoProtocolOperation(targets[0], "preserving"),
      demoProtocolOperation(targets[1], "changing"),
    ],
  });
  const coverage = report.libraries[0].apiGroups[0].coverage.members[0]
    .generation.semanticCoverage;

  assert.deepEqual(coverage, {
    status: "adapter-only",
    relations: ["changing", "preserving"],
  });
  assert.equal(report.summary.generation.semanticCoverage.preserving, 0);
  assert.equal(report.summary.generation.semanticCoverage["adapter-only"], 1);
});

test("protocol links survive empty, sibling, and same-member direct mappings", () => {
  const protocol = demoProtocolOperation("demo.widget.renderAdapted", "changing");
  const { surfaceRoot, ...render } = demoTypeScriptSurface.symbols[0];
  const surface = { symbols: [render, { ...render, id: "Widget.mount" }] };
  for (const directMember of [undefined, null, "Widget.mount", "Widget.render"]) {
    const directTarget = "demo.widget.direct";
    const mappings = directMember === undefined ? undefined : directMember === null ? [] : [{
      typescript: directMember,
      targets: [directTarget],
      lean: ["Lean.Vir.Demo.Widget.direct"],
    }];
    const targets = [protocol.target, ...(directMember ? [directTarget] : [])];
    const publicEntries = targets.map((target) => {
      const declaration = `Lean.Vir.Demo.Widget.${target.split(".").at(-1)}`;
      return {
        declaration,
        module: "Vir.Demo",
        type: "Unit",
        source: { path: "Vir/Demo/Generated.lean", startLine: 1 },
        targets: [{ target, path: [declaration] }],
      };
    });
    const report = buildDemoReport(targets, { mappings, surface, publicEntries, protocolOperations: [protocol] });
    const group = report.libraries[0].apiGroups[0];
    const member = group.coverage.members.find((entry) => entry.id === "Widget.render");
    assert.ok(member, `protocol member disappeared with ${directMember} direct mapping`);
    assert.deepEqual(member.generation.targets,
      directMember === "Widget.render" ? [directTarget, protocol.target] : [protocol.target]);
    assert.equal(member.generation.disposition, directMember === "Widget.render" ? "generated" : "adapted");
    assert.equal(member.generation.semanticCoverage.status, "adapter-only");
    assert.equal(group.coverage.targetMappings.find((mapping) =>
      mapping.target === protocol.target)?.typescript, "Widget.render");
    assert.equal(group.coverage.summary.mappedTargets, targets.length);
    assert.deepEqual(group.workItems, []);
    assert.deepEqual(report.issues, []);
  }
});

test("reviewed method mappings require their named public declaration to reach the target", () => {
  const target = "demo.widget.render";
  const coverage = {
    format: "lean-vir-shipped-bindings-coverage",
    version: 1,
    lean: {},
    providers: [],
    summary: {
      totalTargets: 1,
      provided: 1,
      missingProvider: 0,
      runtimeOnly: 0,
      publicEntries: 1,
      publicTargetEdges: 1,
      targetsReachedByPublicEntries: 1,
    },
    bindings: [{
      target,
      status: "provided",
      declarations: [{ module: "Vir.Demo" }],
      providers: ["demo"],
    }],
    publicEntries: [{
      declaration: "Lean.Vir.Demo.Widget.other",
      module: "Vir.Demo",
      type: "Unit",
      source: { path: "Vir/Demo.lean", startLine: 1 },
      targets: [{ target, path: ["Lean.Vir.Demo.Widget.other"] }],
    }],
  };
  const config = {
    id: "demo",
    title: "Demo",
    description: "Demo bindings.",
    path: "Vir/Demo.bindings.json",
    lean: { modules: ["Vir.Demo"] },
    generation: {
      output: "Vir/Demo/Generated.lean",
      imports: ["Vir.Demo.Types"],
      namespace: "Lean.Vir.Demo",
      abiProfile: {
        id: "demo-v1",
        effect: { id: "runtime", lean: "RuntimeM" },
        types: { void: { lean: "Unit", representation: "immediate" } },
        resource: {
          constructor: "Lean.Vir.Js",
          nullableConstructor: "Lean.Vir.Js.Nullable",
          argument: { passing: "borrowed", retention: "call" },
          result: { ownership: "owned" },
        },
        receiver: { default: { passing: "borrowed", retention: "call" }, globalTypes: {} },
      },
      resources: { Widget: "Widget" },
      members: ["Widget.render"],
      methodPolicies: {},
      exceptions: {},
    },
    roots: [{
      id: "widget",
      title: "Widget",
      targets: ["demo.widget.*"],
      lean: { public: ["Lean.Vir.Demo.Widget"] },
      upstream: { kind: "typescript", roots: ["Widget"] },
      mappings: [{
        typescript: "Widget.render",
        targets: [target],
        lean: ["Lean.Vir.Demo.Widget.render"],
      }],
    }],
  };
  const typeScript = {
    symbols: [{
      id: "Widget.render",
      kind: "method",
      surfaceRoot: "Widget",
      display: "render(): void;",
      source: { path: "demo.d.ts", startLine: 1 },
      shape: { kind: "function", args: [], result: { kind: "primitive", name: "void" } },
    }],
  };

  const report = buildBindingExplorerReport(
    coverage,
    [config],
    new Map([["demo/widget", typeScript]]),
    repositoryPath("build", "bindings", "demo.coverage.json"),
  );

  assert.ok(report.issues.some((entry) =>
    entry.kind === "mapped-public-api-unreachable" &&
    entry.declaration === "Lean.Vir.Demo.Widget.render" &&
    entry.target === target));
});

test("type anchor rendering is a side-effect-free format choice", () => {
  const report = {
    summary: { exact: 1, compatible: 0, weak: 0, missing: 0 },
    diagnosticSummary: { error: 0, warning: 0, info: 0 },
    results: [],
  };

  assert.match(renderTypeAnchorReport(report), /exact\t1/u);
  assert.match(renderTypeAnchorReport(report, "html"), /<!doctype html>/u);
});

test("binding CLI argument helpers report errors without exiting", () => {
  assert.throws(
    () => requiredValue(["--check"], 0, "--out"),
    /--out requires a value/u,
  );
});

test("generated-file checks reject stale output without exiting", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "vir-binding-tooling-"));
  try {
    const output = join(temporary, "artifact.txt");
    await writeFile(output, "old\n");
    await assert.rejects(
      emitGeneratedFile(output, "new\n", {
        check: true,
        root: temporary,
        staleHint: "regenerate it",
      }),
      /artifact\.txt is stale; regenerate it/u,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("binding entry points own help and error exit status", () => {
  const helpCases = [
    ["generate-binding-explorer.mjs", /Generate the consolidated Lean VIR upstream reference, shipped inventory, and author actions/u],
    ["generate-shipped-bindings-report.mjs", /Reconcile compiler-derived JavaScript bindings/u],
    ["generate-lean-bindings.mjs", /Generate Lean host declarations/u],
    ["generate-lean-type-anchor-manifest.mjs", /Generate a checked-in interface manifest fixture/u],
    ["generate-ts-descriptors.mjs", /Generate Lean VIR TypeScript descriptor JSON/u],
    ["render-type-anchors.mjs", /Render a Verso\/Blueprint-friendly Markdown fragment/u],
    ["check-type-anchors.mjs", /Compare TypeScript descriptor JSON with Lean VIR interface descriptors/u],
  ];
  for (const [file, pattern] of helpCases) {
    const script = repositoryPath("scripts", "bindings", file);
    const help = spawnSync(process.execPath, [script, "--help"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.equal(help.status, 0, `${file}: ${help.stderr}`);
    assert.match(help.stdout, pattern, file);
    assert.equal(help.stderr, "", file);
  }

  const script = repositoryPath("scripts", "bindings", "generate-ts-descriptors.mjs");
  const invalid = spawnSync(process.execPath, [script, "--unknown"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(invalid.status, 1, invalid.stdout);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /^error: unknown option --unknown\n$/u);
});

test("binding entry points propagate a returned nonzero status", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "vir-binding-cli-main-"));
  try {
    const entrypoint = join(temporary, "returned-status.mjs");
    const cliMainUrl = pathToFileURL(
      repositoryPath("scripts", "bindings", "cli-main.mjs"),
    ).href;
    await writeFile(
      entrypoint,
      `import { runCliMain } from ${JSON.stringify(cliMainUrl)};\n` +
        "await runCliMain(async () => 7);\n",
    );
    const result = spawnSync(process.execPath, [entrypoint], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 7, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
