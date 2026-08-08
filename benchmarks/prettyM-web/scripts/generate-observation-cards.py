#!/usr/bin/env python3
"""Generate forwardable performance observation cards from a benchmark report."""

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


WORKSPACE = Path(__file__).resolve().parent.parent
DEFAULT_REPORT = Path("_results/pretty-benchmark.json")
DEFAULT_OUTPUT = Path("_results/performance-cards")
DEFAULT_VIR_ATTRIBUTION = Path("evidence/vir-pr104-runtime-call-profile.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "report",
        nargs="?",
        type=Path,
        default=DEFAULT_REPORT,
        help=f"workspace-relative benchmark report (default: {DEFAULT_REPORT})",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"workspace-relative card directory (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--vir-attribution",
        type=Path,
        default=DEFAULT_VIR_ATTRIBUTION,
        help=(
            "workspace-relative imported VIR profile summary "
            f"(default: {DEFAULT_VIR_ATTRIBUTION})"
        ),
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail instead of writing when committed cards differ",
    )
    return parser.parse_args()


def workspace_path(path: Path, operation: str) -> Path:
    resolved = (WORKSPACE / path).resolve() if not path.is_absolute() else path.resolve()
    try:
        resolved.relative_to(WORKSPACE)
    except ValueError as error:
        raise SystemExit(
            f"refusing to {operation} outside {WORKSPACE}: {resolved}"
        ) from error
    return resolved


def relative_path(path: Path) -> str:
    return path.relative_to(WORKSPACE).as_posix()


def milliseconds(value: float) -> str:
    return f"{value:.3f}"


def ratio(numerator: float, denominator: float) -> str:
    if denominator == 0:
        return "∞"
    return f"{numerator / denominator:.1f}×"


def percent_range(values: list[float]) -> str:
    return f"{min(values):.1f}–{max(values):.1f}%"


def mebibytes(value: int | float) -> str:
    return f"{value / (1024 * 1024):.2f} MiB"


def timing(study: dict[str, Any], backend: str, phase: str, statistic: str) -> float:
    return study["summaries"][backend]["timing"][phase][statistic]


def endpoint_rows(
    groups: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    return [(group, group["points"][-1]) for group in groups]


def group_by_id(groups: list[dict[str, Any]], group_id: str) -> dict[str, Any]:
    return next(group for group in groups if group["id"] == group_id)


def provenance_lines(
    report: dict[str, Any], report_path: Path, report_digest: str
) -> list[str]:
    vir = report["coldStart"]["backends"]["vir"]
    metadata = vir["provenance"]["packageMetadata"]
    assets = report["runtimeProfile"]["backends"]["vir"]["assets"]
    wasm = next(asset for asset in assets if asset["file"].endswith(".wasm"))
    package = next(asset for asset in assets if asset["file"].endswith(".irpkg"))
    return [
        f"- Report: `{relative_path(report_path)}`",
        f"- Report generated: `{report['generatedAt']}`",
        f"- Report SHA-256: `{report_digest}`",
        f"- Lean: `{metadata['leanVersion']}` (`{metadata['leanGithash']}`)",
        f"- VIR Wasm: `{wasm['sha256']}` ({wasm['byteLength']:,} bytes)",
        f"- IR package: `{package['sha256']}` ({package['byteLength']:,} bytes)",
        f"- Browser: `{report['runtimeProfile']['userAgent']}`",
        (
            f"- VIR cold start ({report['coldStart']['runs']} fresh contexts): "
            f"{milliseconds(vir['startupMs']['median'])} ms median / "
            f"{milliseconds(vir['startupMs']['p95'])} ms p95; resource-load wall "
            f"{milliseconds(vir['resourceLoadMs']['median'])} ms median"
        ),
        (
            f"- Correctness: `{report['parityCount']}/{report['scenarioCount']}` "
            "corpus scenarios passed; scaling and interaction parity passed"
        ),
    ]


def card_header(
    card_id: str,
    audience: str,
    title: str,
    summary: str,
    status: str = "observed; needs owner-side profiling",
    priority: str = "performance follow-up",
) -> list[str]:
    return [
        f"# {card_id}: {title}",
        "",
        f"- Audience: {audience}",
        f"- Status: {status}",
        f"- Priority: {priority}",
        "",
        "## Forwardable summary",
        "",
        f"> {summary}",
        "",
    ]


def measurement_context(
    report: dict[str, Any], report_path: Path, report_digest: str
) -> list[str]:
    return [
        "## Measurement context",
        "",
        *provenance_lines(report, report_path, report_digest),
        (
            f"- Scaling protocol: {report['scaling']['samples']} logical samples, "
            f"{report['scaling']['warmup']} warm-ups, adaptive batches targeting "
            f"{report['scaling']['batchTargetMs']:.0f} ms, capped at "
            f"{report['scaling']['maxBatchIterations']} calls"
        ),
        "",
        "Regenerate this card after collecting a new report:",
        "",
        "```sh",
        "npm run cards",
        "```",
        "",
    ]


def json_boundary_card(
    report: dict[str, Any], report_path: Path, report_digest: str
) -> str:
    direct = "vir-format"
    scaling_rows = endpoint_rows(report["scaling"]["dimensions"])
    scaling_ratios = [
        point["backends"]["vir"]["summary"]["executeMs"]["median"]
        / point["backends"][direct]["summary"]["executeMs"]["median"]
        for _, point in scaling_rows
    ]
    tags = group_by_id(
        report["interactions"]["interactions"], "tags-transitions"
    )["points"][-1]
    tags_json = tags["backends"]["vir"]["summary"]["executeMs"]["median"]
    tags_direct = tags["backends"][direct]["summary"]["executeMs"]["median"]
    json_round_trip = report.get("jsonRoundTrip")
    lines = card_header(
        "VIR-001",
        "lean-vir runtime and browser ABI owners",
        "the JSON boundary dominates VIR pretty-print time",
        (
            "With the same VIR runtime, IR package, Lean implementation, and output, "
            f"the direct `Std.Format` entry point is {min(scaling_ratios):.1f}×–"
            f"{max(scaling_ratios):.1f}× faster in the measured execute phase than the "
            "JSON entry point at the six scaling endpoints. "
            "The JSON route should be treated as a compatibility path, not as the VIR "
            "compiler-performance baseline."
        ),
        status="characterized; interface trade-off recorded",
        priority="no immediate follow-up",
    )
    lines += [
        "## Evidence",
        "",
        (
            "Representative corpus "
            f"({report['summaries']['vir']['timing']['totalMs']['samples']:,} "
            "timed invocations per backend):"
        ),
        "",
        "| Metric | VIR JSON | VIR Format | JSON / Format |",
        "| --- | ---: | ---: | ---: |",
    ]
    for label, phase, statistic in [
        ("Median execute", "executeMs", "median"),
        ("p95 execute", "executeMs", "p95"),
        ("Median total", "totalMs", "median"),
        ("p95 total", "totalMs", "p95"),
    ]:
        json_value = timing(report, "vir", phase, statistic)
        direct_value = timing(report, direct, phase, statistic)
        lines.append(
            f"| {label} | {milliseconds(json_value)} ms | "
            f"{milliseconds(direct_value)} ms | {ratio(json_value, direct_value)} |"
        )

    lines += [
        "",
        "Largest point in each one-dimensional scaling study:",
        "",
        "| Dimension | Endpoint | JSON execute | Format execute | Ratio |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for group, point in scaling_rows:
        json_value = point["backends"]["vir"]["summary"]["executeMs"]["median"]
        direct_value = point["backends"][direct]["summary"]["executeMs"]["median"]
        lines.append(
            f"| {group['label']} | {point['sizeLabel']} | "
            f"{milliseconds(json_value)} ms | {milliseconds(direct_value)} ms | "
            f"{ratio(json_value, direct_value)} |"
        )

    lines += [
        "",
        "The strongest interaction point was 64 nested tags × 64 output chunks: "
        f"{milliseconds(tags_json)} ms "
        "through JSON versus "
        f"{milliseconds(tags_direct)} ms "
        "through the direct entry point.",
    ]
    if json_round_trip:
        lines += [
            "",
            "Independent JSON parse-and-compact control (no `Std.Format` construction "
            "or `prettyM`):",
            "",
            "| Payload | Bytes | JS execute | VIR execute | VIR / JS |",
            "| ---: | ---: | ---: | ---: | ---: |",
        ]
        for point in json_round_trip["dimension"]["points"]:
            js_value = point["candidates"]["js"]["summary"]["executeMs"][
                "median"
            ]
            vir_value = point["candidates"]["vir"]["summary"]["executeMs"][
                "median"
            ]
            lines.append(
                f"| {point['sizeLabel']} | {point['input']['jsonBytes']:,} | "
                f"{milliseconds(js_value)} ms | {milliseconds(vir_value)} ms | "
                f"{ratio(vir_value, js_value)} |"
            )
        lines += [
            "",
            f"This control passed exact semantic parity at "
            f"{json_round_trip['parityCount']}/{json_round_trip['pointCount']} points.",
        ]

    lines += [
        "",
        "## Interpretation",
        "",
        "The browser's `marshalMs` includes `JSON.stringify`, and `decodeMs` includes "
        "the final `JSON.parse` and segment validation. The much larger difference is "
        "inside `executeMs`: `runtime.call` plus Lean-side JSON parsing, recursive "
        "`Std.Format` construction, `prettyM`, result JSON construction, compression, "
        "and runtime return conversion. This card does not attribute the cost to one "
        "of those operations; the current boundary does not expose that split.",
    ]
    if json_round_trip:
        lines += [
            "",
            "The independent JSON control removes format decoding, `prettyM`, and "
            "segment construction. Its remaining execute phase is the string ABI, "
            "Lean `Json.parse`/`Json.compress`, envelope construction, and VIR "
            "execution. The persistent gap therefore is not specific to the pretty "
            "printer. This control was requested to characterize the cost of a simple "
            "string-to-string interface relative to the lower-level object ABI; it is "
            "not being treated as a performance regression.",
        ]
    lines += [
        "",
        "## Decision",
        "",
        "- Use the direct `Std.Format` route as the VIR performance baseline.",
        "- Keep the JSON route as the deliberately simpler string-to-string option "
        "for consumers that accept its expected parsing and serialization cost.",
        "- Do not spend further profiling or optimization effort on this experiment "
        "without a concrete JSON-boundary use case or ABI proposal.",
        "",
        "## Caveats",
        "",
        "- These are warmed, adaptively batched browser medians, not pure Wasm "
        "instruction counts.",
    ]
    if json_round_trip:
        lines += [
            f"- The independent JSON control uses {json_round_trip['samples']} logical "
            f"samples and {json_round_trip['warmup']} warm-ups with batching disabled; "
            "its sub-millisecond JavaScript medians are timer-resolution-sensitive.",
        ]
    lines += [
        "- Both VIR modes share one runtime and artifact, which makes their relative "
        "comparison strong but prevents independent memory attribution.",
        "- Exact output parity passed at every reported scaling and interaction point.",
        "",
    ]
    lines += measurement_context(report, report_path, report_digest)
    return "\n".join(lines)


def direct_execution_card(
    report: dict[str, Any],
    report_path: Path,
    report_digest: str,
    attribution: dict[str, Any],
    attribution_path: Path,
    attribution_digest: str,
) -> str:
    scaling_rows = endpoint_rows(report["scaling"]["dimensions"])
    native_ratios = [
        point["backends"]["vir-format"]["summary"]["executeMs"]["median"]
        / point["backends"]["native"]["summary"]["executeMs"]["median"]
        for _, point in scaling_rows
    ]
    corpus_median = report["summaries"]["vir-format"]["timing"]["totalMs"][
        "median"
    ]
    tags = group_by_id(
        report["interactions"]["interactions"], "tags-transitions"
    )["points"][-1]
    tags_vir_execute = tags["backends"]["vir-format"]["summary"]["executeMs"][
        "median"
    ]
    tags_vir_total = tags["backends"]["vir-format"]["summary"]["totalMs"][
        "median"
    ]
    tags_native_execute = tags["backends"]["native"]["summary"]["executeMs"][
        "median"
    ]
    tags_native_total = tags["backends"]["native"]["summary"]["totalMs"][
        "median"
    ]
    profile_rows = []
    for workload_id, label in [
        ("tag-transitions-64x64", "64 tags × 64 chunks"),
        ("nodes-2047", "2,047 empty-output nodes"),
    ]:
        workload_runs = [
            next(
                workload
                for workload in run["workloads"]
                if workload["id"] == workload_id
            )
            for run in attribution["runs"]
        ]
        profile_rows.append((label, workload_runs))
    object_abi_range = percent_range(
        [
            workload["ownerPercent"]["objectAbiImportAndLift"]
            for _label, workloads in profile_rows
            for workload in workloads
        ]
    )
    wasm_range = percent_range(
        [
            workload["ownerPercent"]["wasmSelf"]
            for _label, workloads in profile_rows
            for workload in workloads
        ]
    )
    lines = card_header(
        "VIR-002",
        "lean-vir compiler and runtime owners",
        "direct Format ABI is viable; public-call sampling points to object import",
        (
            "The direct VIR `Std.Format` ABI removes most boundary overhead and keeps "
            f"representative-corpus median total latency at "
            f"{milliseconds(corpus_median)} ms. Its measured execute phase is "
            f"nevertheless {min(native_ratios):.1f}×–{max(native_ratios):.1f}× slower "
            "than FIR-native Wasm across the six large scaling endpoints, with the "
            "largest interaction gap on nested tags and output transitions. Two "
            f"independent sampled captures assign {object_abi_range} of the profiled "
            f"public call path to object import/result lifting and {wasm_range} to "
            "Wasm self samples."
        ),
        status="profiled; boundary optimization candidate identified",
    )
    lines += [
        "## Evidence",
        "",
        (
            "Representative corpus "
            f"({report['summaries']['vir']['timing']['totalMs']['samples']:,} "
            "timed invocations per backend):"
        ),
        "",
        "| Backend | Execute median | Execute p95 | Total median | Total p95 |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for backend in ["vir-format", "native", "llvm"]:
        summary = report["summaries"][backend]
        phases = summary["timing"]
        lines.append(
            f"| {summary['label']} | "
            f"{milliseconds(phases['executeMs']['median'])} ms | "
            f"{milliseconds(phases['executeMs']['p95'])} ms | "
            f"{milliseconds(phases['totalMs']['median'])} ms | "
            f"{milliseconds(phases['totalMs']['p95'])} ms |"
        )

    lines += [
        "",
        "Largest point in each one-dimensional scaling study:",
        "",
        "| Dimension | Endpoint | VIR execute | VIR / Native execute | VIR / LLVM execute | VIR / Native total |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for group, point in scaling_rows:
        backends = point["backends"]
        vir_execute = backends["vir-format"]["summary"]["executeMs"]["median"]
        native_execute = backends["native"]["summary"]["executeMs"]["median"]
        llvm_execute = backends["llvm"]["summary"]["executeMs"]["median"]
        vir_total = backends["vir-format"]["summary"]["totalMs"]["median"]
        native_total = backends["native"]["summary"]["totalMs"]["median"]
        lines.append(
            f"| {group['label']} | {point['sizeLabel']} | "
            f"{milliseconds(vir_execute)} ms | {ratio(vir_execute, native_execute)} | "
            f"{ratio(vir_execute, llvm_execute)} | {ratio(vir_total, native_total)} |"
        )

    lines += [
        "",
        "Interaction endpoints:",
        "",
        "| Interaction | Endpoint | VIR execute | VIR / Native execute | VIR / Native total |",
        "| --- | --- | ---: | ---: | ---: |",
    ]
    for group, point in endpoint_rows(report["interactions"]["interactions"]):
        backends = point["backends"]
        vir_execute = backends["vir-format"]["summary"]["executeMs"]["median"]
        native_execute = backends["native"]["summary"]["executeMs"]["median"]
        vir_total = backends["vir-format"]["summary"]["totalMs"]["median"]
        native_total = backends["native"]["summary"]["totalMs"]["median"]
        endpoint = f"{point['xLabel']} × {point['yLabel']}"
        lines.append(
            f"| {group['label']} | {endpoint} | {milliseconds(vir_execute)} ms | "
            f"{ratio(vir_execute, native_execute)} | {ratio(vir_total, native_total)} |"
        )

    lines += [
        "",
        "The end-to-end gap is smaller than the execute-only gap because the direct "
        "VIR bridge has very low separately measured marshal/decode cost, while the "
        "native and LLVM adapters perform explicit encoding and decoding.",
        "",
        "## Interpretation",
        "",
        "`VIR Format` is the right path for interactive use, but its `executeMs` is "
        "still a user-visible `runtime.call` measurement. It includes importing the "
        "JavaScript `Std.Format` object, executing `formatSegmentsForVir`/`prettyM`, "
        "allocating the `StateM` arrays and strings, and exporting the segment array. "
        "The imported sampled profiles now separate the main owner classes, while "
        "the benchmark continues to provide the diagnostics-off product timing.",
        "",
        "The 64-tag × 64-chunk endpoint is the clearest profiling target: direct VIR "
        f"takes {milliseconds(tags_vir_execute)} ms execute / "
        f"{milliseconds(tags_vir_total)} ms total, versus native at "
        f"{milliseconds(tags_native_execute)} ms execute / "
        f"{milliseconds(tags_native_total)} ms total. The total-time result also shows "
        "why optimizing only core execution is insufficient: output transport remains "
        "material for all backends.",
        "",
        "## Sampled attribution",
        "",
        "Two independent V8 CPU-profile captures used the normal direct-Format "
        "`runtime.call`. The JavaScript `Std.Format` value was built once outside the "
        "sampled loop; each call still imported a fresh Lean object graph and lifted "
        "its result. Each capture ran both structural targets for about four seconds "
        "and checked the known output digest after every batch.",
        "",
        "| Workload | Object import / result lift | Wasm self | Lookup / name maps | `eval_body` | `customInductiveShape` self |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for label, workloads in profile_rows:
        lines.append(
            f"| {label} | "
            f"{percent_range([row['ownerPercent']['objectAbiImportAndLift'] for row in workloads])} | "
            f"{percent_range([row['ownerPercent']['wasmSelf'] for row in workloads])} | "
            f"{percent_range([row['ownerPercent']['lookupAndNameMaps'] for row in workloads])} | "
            f"{percent_range([row['ownerPercent']['evalBody'] for row in workloads])} | "
            f"{percent_range([row['customInductiveShapeSelfPercent'] for row in workloads])} |"
        )
    lines += [
        "",
        "The boundary bucket is dominated by successful input import. The largest "
        "self symbol in both captures is `customInductiveShape`, followed by "
        "custom-inductive constructor validation and normalization. These functions "
        "eagerly build diagnostic shape descriptions while importing valid nodes. "
        "Lookup and name-map work remains visible, but owns only 4.6–5.9% of the "
        "complete public call path in these captures.",
        "",
        "Sample shares are noisy diagnostic evidence. Artifact and harness hashes are "
        "deterministic evidence; stable output digests are semantic evidence.",
        "",
        "## Requested follow-up",
        "",
        "- Measure a narrow runtime candidate that makes diagnostic custom-inductive "
        "shape construction lazy on successful imports while preserving malformed-input "
        "validation and error text.",
        "- Compare the unchanged public `runtime.call` path with order-balanced, "
        "diagnostics-off runs, then collect a post-change profile to verify that the "
        "shape/normalization bucket moves as predicted.",
        "- Add explicit phase timing only if it preserves the same fresh-input "
        "ownership path; do not retain a pre-lowered Lean object across calls.",
        "- Preserve both execute-only and total-time comparisons; improvements should "
        "not move work into an unmeasured adapter phase.",
        "",
        "## Caveats",
        "",
        "- Native and LLVM have different physical ABIs, so total-time comparisons are "
        "product-level measurements rather than compiler-only measurements.",
        "- The execute phase is the fairest phase currently available, but it still "
        "includes each runtime's in-call ABI work.",
        "- The CPU profiles use an optimized, unstripped macro-off companion Wasm, "
        "not the exact stripped benchmark binary; profiled timings are not headline "
        "latency measurements.",
        "- Exact styled-output parity passed at every reported point.",
        "",
        "## Imported profile context",
        "",
        f"- Evidence: `{relative_path(attribution_path)}` (`{attribution_digest}`)",
        f"- VIR source: `{attribution['target']['runtimeSourceCommit']}`",
        f"- Profiling harness commit: `{attribution['target']['profilingHarnessCommit']}`",
        f"- Harness SHA-256: `{attribution['artifacts']['harness']['sha256']}`",
        f"- Profile Wasm SHA-256: `{attribution['artifacts']['profileWasm']['sha256']}`",
        f"- IR package SHA-256: `{attribution['artifacts']['irPackage']['sha256']}`",
        "- Raw summary SHA-256: "
        + ", ".join(f"`{run['summarySha256']}`" for run in attribution["runs"]),
        "",
    ]
    lines += measurement_context(report, report_path, report_digest)
    return "\n".join(lines)


def memory_card(
    report: dict[str, Any], report_path: Path, report_digest: str
) -> str:
    memory = report["memory"]
    repeated = report["repeated"]
    initial = memory["initialMemory"]["backends"]["vir"]["committedBytes"]
    final = memory["finalMemory"]["backends"]["vir"]["committedBytes"]
    repeat = repeated["memoryGrowth"]["vir"]
    cold = report["coldStart"]["backends"]["vir"]["memoryBytes"]
    post = report["postRunProfile"]["backends"]["vir"]["memoryBytes"]
    vir_repeat_calls = sum(
        repeated["summaries"][backend]["invocations"]
        for backend in ("vir", "vir-format")
    )
    retained_calls = memory["pointCount"] * 2
    isolated = repeated.get("isolated")
    isolated_rows: list[dict[str, Any]] = []
    if isolated:
        for backend_id in isolated["backendIds"]:
            isolated_report = isolated["reports"][backend_id]
            series = next(
                item
                for item in isolated_report["memoryTrace"]["series"]
                if item["id"] == "vir-runtime"
            )
            isolated_rows.append(
                {
                    "label": isolated_report["summaries"][backend_id]["label"],
                    "calls": isolated_report["callsPerBackend"],
                    "summary": series["committed"],
                }
            )
    if isolated_rows:
        isolated_growth = "; ".join(
            f"{row['label']} grew by {mebibytes(row['summary']['growthBytes'])} "
            f"over {row['calls']} calls"
            for row in isolated_rows
        )
        forward_summary = (
            f"The shared VIR runtime starts with {mebibytes(cold)} committed and ends "
            f"the full suite at {mebibytes(post)}. In separate fresh runtimes, "
            f"{isolated_growth}. Current telemetry exposes committed pages only, so "
            "this is a high-water/retention observation—not evidence of a live-memory "
            "leak."
        )
    else:
        forward_summary = (
            f"The shared VIR runtime starts with {mebibytes(cold)} committed and ends "
            f"the full suite at {mebibytes(post)}. It grew by "
            f"{mebibytes(final - initial)} during the retained one-call scaling study "
            f"and by {mebibytes(repeat['deltaBytes'])} during {vir_repeat_calls} "
            "repeated VIR calls. Current telemetry exposes committed pages only, so "
            "this is a high-water/retention observation—not evidence of a live-memory "
            "leak."
        )
    lines = card_header(
        "VIR-003",
        "lean-vir runtime, allocator, and GC owners",
        "shared Wasm memory reaches a high-water mark that cannot yet be classified",
        forward_summary,
    )
    lines += [
        "## Evidence",
        "",
        "| Observation window | Calls into shared VIR runtime | Before | After | Growth |",
        "| --- | ---: | ---: | ---: | ---: |",
        (
            f"| Retained one-call scaling study | {retained_calls} | "
            f"{mebibytes(initial)} | {mebibytes(final)} | {mebibytes(final - initial)} |"
        ),
        (
            f"| Repeated-call study | {vir_repeat_calls} | "
            f"{mebibytes(repeat['beforeBytes'])} | {mebibytes(repeat['afterBytes'])} | "
            f"{mebibytes(repeat['deltaBytes'])} |"
        ),
    ]
    for row in isolated_rows:
        summary = row["summary"]
        assessment = "tail plateau" if summary["plateau"] else "growing in tail"
        lines.append(
            f"| Fresh runtime · {row['label']} | {row['calls']} | "
            f"{mebibytes(summary['initialBytes'])} | "
            f"{mebibytes(summary['finalBytes'])} | "
            f"{mebibytes(summary['growthBytes'])} ({assessment}; "
            f"{mebibytes(summary['tailGrowthBytes'])} over final "
            f"{summary['tailCycles']} cycles) |"
        )
    lines += [
        "",
        f"- Fresh-context committed memory after initialization: {mebibytes(cold)}.",
        f"- Committed memory after the complete benchmark sequence: {mebibytes(post)}.",
        "- `VIR JSON` and `VIR Format` report the same `vir-runtime` memory group; "
        "their figures must not be added together.",
        f"- All {repeated['totalBackendCalls']} calls in the five-backend repeated study "
        "preserved output stability; the shared VIR runtime received "
        f"{repeated['summaries']['vir']['invocations']} JSON calls and "
        f"{repeated['summaries']['vir-format']['invocations']} direct-Format calls.",
        "",
        "## Interpretation",
        "",
        "Wasm committed memory is an allocator capacity/high-water metric. It does not "
        "show live bytes, unreachable bytes waiting for collection, fragmentation, or "
        "reusable free-list capacity. The full-suite endpoint also follows large "
        "adaptive batches, so it must not be described as the footprint of one "
        "pretty-print operation.",
        "",
        "The repeated-call delta is worth explaining because it occurs in a bounded, "
        "rotating workload after earlier warm-up. Without allocator frontier and GC "
        "telemetry, the harness cannot distinguish expected heap expansion from "
        "retained live state or a leak.",
    ]
    if isolated_rows:
        lines += [
            "",
            "The fresh-runtime JSON and direct-Format traces remove cross-mode "
            "contamination. Their per-cycle tail classifications report only whether "
            "committed capacity stopped growing in the observed final window.",
        ]
    lines += [
        "",
        "## Requested follow-up",
        "",
        "- Expose committed pages, allocator frontier, live/reachable bytes if "
        "available, free-list capacity, and collection count/time around each call.",
        "- Provide a documented runtime reset/dispose operation, or state explicitly "
        "which caches and arenas are intentionally process-lifetime.",
    ]
    if isolated_rows:
        lines += [
            "- Extend any still-growing isolated trace until it plateaus or reaches a "
            "documented bound, preserving the per-cycle series.",
            "- Correlate growth events with JSON and direct calls using the separate "
            "fresh-runtime reports.",
        ]
    else:
        lines += [
            "- Rerun the repeated workload for more cycles and record memory after each "
            "cycle to determine whether growth plateaus.",
            "- Attribute memory to JSON and direct calls with separate fresh-runtime "
            "runs; the current shared instance cannot do so.",
        ]
    lines += [
        "",
        "## Caveats",
        "",
        "- No browser API currently exposes the VIR runtime's resident/live heap.",
        "- The values are Wasm linear-memory capacity, not host-process RSS.",
        "- The main five-backend study shares one VIR runtime instance; the "
        "isolated mode traces each start from a fresh runtime.",
        "",
    ]
    lines += measurement_context(report, report_path, report_digest)
    return "\n".join(lines)


def index_card(
    report: dict[str, Any], report_path: Path, report_digest: str
) -> str:
    return "\n".join(
        [
            "# Pretty-printer performance observation cards",
            "",
            "These self-contained Markdown cards turn benchmark observations into "
            "forwardable owner reports. Each card separates measured evidence, "
            "interpretation, requested follow-up, and caveats.",
            "",
            "| Card | Intended owner | Observation |",
            "| --- | --- | --- |",
            "| [VIR-001](VIR-001-json-boundary.md) | Runtime / browser ABI | JSON boundary dominates VIR time |",
            "| [VIR-002](VIR-002-direct-format-execution.md) | Compiler / runtime | Public-call profiles point to object import |",
            "| [VIR-003](VIR-003-shared-memory-growth.md) | Runtime / allocator / GC | Shared linear-memory high-water needs attribution |",
            "",
            "The numbers are generated, not hand-maintained. After refreshing an "
            "artifact and collecting a new benchmark report, run:",
            "",
            "```sh",
            "npm run cards",
            "npm run cards -- --check",
            "```",
            "",
            "`--check` is suitable for review or CI: it fails if any card is missing "
            "or stale. Both report and output paths are restricted to this workspace.",
            "",
            "## Current source",
            "",
            *provenance_lines(report, report_path, report_digest),
            "",
        ]
    )


def render_cards(
    report: dict[str, Any],
    report_path: Path,
    report_digest: str,
    attribution: dict[str, Any],
    attribution_path: Path,
    attribution_digest: str,
) -> dict[str, str]:
    return {
        "README.md": index_card(report, report_path, report_digest),
        "VIR-001-json-boundary.md": json_boundary_card(
            report, report_path, report_digest
        ),
        "VIR-002-direct-format-execution.md": direct_execution_card(
            report,
            report_path,
            report_digest,
            attribution,
            attribution_path,
            attribution_digest,
        ),
        "VIR-003-shared-memory-growth.md": memory_card(
            report, report_path, report_digest
        ),
    }


def validate_report(report: dict[str, Any]) -> None:
    required_backends = {"js", "vir", "vir-format", "native", "llvm"}
    available = set(report.get("backendIds", []))
    missing = sorted(required_backends - available)
    if missing:
        raise SystemExit(f"report is missing required backends: {', '.join(missing)}")
    if not report.get("passed"):
        raise SystemExit("refusing to generate performance cards from a failed corpus")
    for study in ("scaling", "memory", "interactions", "repeated"):
        if not report.get(study, {}).get("passed"):
            raise SystemExit(f"refusing to generate cards from failed {study} study")
    if "jsonRoundTrip" in report and not report["jsonRoundTrip"].get("passed"):
        raise SystemExit("refusing to generate cards from failed JSON round-trip study")


def validate_attribution(
    attribution: dict[str, Any], report: dict[str, Any]
) -> None:
    if attribution.get("schemaVersion") != 1 or attribution.get("kind") != (
        "prettyM-runtime-call-profile-attribution"
    ):
        raise SystemExit("unsupported VIR profile attribution schema")
    runs = attribution.get("runs")
    if not isinstance(runs, list) or len(runs) < 2:
        raise SystemExit("VIR profile attribution requires at least two captures")
    required_workloads = {"tag-transitions-64x64", "nodes-2047"}
    for run in runs:
        workloads = run.get("workloads", [])
        if {workload.get("id") for workload in workloads} != required_workloads:
            raise SystemExit(f"VIR profile capture {run.get('id')} has wrong workloads")
        for workload in workloads:
            if workload.get("samples", 0) <= 0 or workload.get("calls", 0) <= 0:
                raise SystemExit("VIR profile attribution contains an empty capture")
            if len(workload.get("profileSha256", "")) != 64 or len(
                workload.get("outputDigest", "")
            ) != 64:
                raise SystemExit("VIR profile attribution has an invalid output digest")
            percentages = [
                *workload.get("ownerPercent", {}).values(),
                workload.get("customInductiveShapeSelfPercent", -1),
            ]
            if any(value < 0 or value > 100 for value in percentages):
                raise SystemExit("VIR profile attribution has an invalid percentage")
    for workload_id in required_workloads:
        digests = {
            next(
                workload
                for workload in run["workloads"]
                if workload["id"] == workload_id
            )["outputDigest"]
            for run in runs
        }
        if len(digests) != 1:
            raise SystemExit(
                f"VIR profile output changed between captures for {workload_id}"
            )
    vir_assets = report["runtimeProfile"]["backends"]["vir"]["assets"]
    expected_assets = {
        "prettyM-vir.irpkg": attribution["artifacts"]["irPackage"],
        "vir-runtime.js": attribution["artifacts"]["boundedRuntimeJs"],
        "vir-upstream.wasm": attribution["artifacts"]["boundedRuntimeWasm"],
    }
    for filename, expected in expected_assets.items():
        actual = next(
            (asset for asset in vir_assets if asset["file"] == filename), None
        )
        if (
            actual is None
            or actual["byteLength"] != expected["bytes"]
            or actual["sha256"] != expected["sha256"]
        ):
            raise SystemExit(
                f"VIR profile attribution {filename} does not match the report"
            )
    metadata = report["coldStart"]["backends"]["vir"]["provenance"][
        "packageMetadata"
    ]
    if metadata["leanVersion"] != attribution["target"]["leanVersion"]:
        raise SystemExit(
            "VIR profile attribution Lean version does not match the report"
        )


def main() -> int:
    args = parse_args()
    report_path = workspace_path(args.report, "read")
    output_dir = workspace_path(args.output_dir, "write")
    attribution_path = workspace_path(args.vir_attribution, "read")
    report_bytes = report_path.read_bytes()
    report = json.loads(report_bytes)
    attribution_bytes = attribution_path.read_bytes()
    attribution = json.loads(attribution_bytes)
    validate_report(report)
    validate_attribution(attribution, report)
    cards = render_cards(
        report,
        report_path,
        hashlib.sha256(report_bytes).hexdigest(),
        attribution,
        attribution_path,
        hashlib.sha256(attribution_bytes).hexdigest(),
    )

    stale: list[str] = []
    for filename, contents in cards.items():
        expected = contents.rstrip() + "\n"
        target = output_dir / filename
        if args.check:
            if not target.exists() or target.read_text() != expected:
                stale.append(relative_path(target))
        else:
            output_dir.mkdir(parents=True, exist_ok=True)
            target.write_text(expected)
            print(f"wrote {relative_path(target)}")

    if stale:
        print("stale observation cards:")
        for path in stale:
            print(f"  {path}")
        return 1
    if args.check:
        print(f"{len(cards)} observation cards are current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
