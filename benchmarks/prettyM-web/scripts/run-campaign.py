#!/usr/bin/env python3
"""Run benchmark reports in fresh browser processes and aggregate variability."""

import argparse
import hashlib
import json
import math
import shutil
import statistics
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


WORKSPACE = Path(__file__).resolve().parent.parent
COLLECTOR = WORKSPACE / "scripts/collect-report.mjs"
PHASES = ("marshalMs", "executeMs", "decodeMs", "totalMs")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", default="http://127.0.0.1:18334/")
    parser.add_argument("--runs", type=int, default=3, help="total process count")
    parser.add_argument(
        "--seed-report",
        type=Path,
        action="append",
        default=[],
        help="existing workspace report to include before launching new processes",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        help="workspace benchmark report used for before/after deltas",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="workspace output directory (default: timestamped under _results)",
    )
    parser.add_argument("--warmup", type=int, default=2)
    parser.add_argument("--samples", type=int, default=9)
    parser.add_argument("--scaling-warmup", type=int, default=2)
    parser.add_argument("--scaling-samples", type=int, default=9)
    parser.add_argument("--interaction-warmup", type=int, default=1)
    parser.add_argument("--interaction-samples", type=int, default=5)
    parser.add_argument("--repeat-cycles", type=int, default=32)
    parser.add_argument("--cold-runs", type=int, default=5)
    parser.add_argument("--batch-target-ms", type=float, default=20.0)
    parser.add_argument("--max-batch-iterations", type=int, default=512)
    parser.add_argument("--batch-memory-mib", type=float, default=64.0)
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


def relative(path: Path) -> str:
    return path.relative_to(WORKSPACE).as_posix()


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1)]


def distribution(values: list[float | int | None]) -> dict[str, float | int | None]:
    observed = [float(value) for value in values if value is not None and math.isfinite(value)]
    if not observed:
        return {
            "runs": 0,
            "min": None,
            "median": None,
            "p95": None,
            "max": None,
            "mean": None,
            "stdev": None,
            "cv": None,
        }
    mean = statistics.fmean(observed)
    stdev = statistics.pstdev(observed)
    return {
        "runs": len(observed),
        "min": min(observed),
        "median": statistics.median(observed),
        "p95": percentile(observed, 0.95),
        "max": max(observed),
        "mean": mean,
        "stdev": stdev,
        "cv": stdev / mean if mean != 0 else None,
    }


def point_by_case(groups: list[dict[str, Any]], case_id: str) -> dict[str, Any]:
    return next(
        point
        for group in groups
        for point in group["points"]
        if point["caseId"] == case_id
    )


def artifact_fingerprint(report: dict[str, Any]) -> dict[str, Any]:
    return {
        backend_id: {
            "assets": sorted(
                (asset.get("file"), asset.get("sha256"), asset.get("byteLength"))
                for asset in report["runtimeProfile"]["backends"][backend_id]["assets"]
                if asset.get("sha256")
            ),
            "provenance": report["runtimeProfile"]["backends"][backend_id].get(
                "provenance"
            ),
        }
        for backend_id in report["backendIds"]
    }


def benchmark_protocol(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "corpus": {
            "warmup": report["warmup"],
            "samples": report["samples"],
            "widths": report["widths"],
            "coldRuns": report["coldStart"]["runs"],
        },
        "scaling": {
            key: report["scaling"][key]
            for key in (
                "warmup",
                "samples",
                "batchTargetMs",
                "maxBatchIterations",
                "batchMemoryBudgetBytes",
            )
        },
        "interactions": {
            key: report["interactions"][key]
            for key in (
                "warmup",
                "samples",
                "batchTargetMs",
                "maxBatchIterations",
                "batchMemoryBudgetBytes",
            )
        },
        "repeatedCycles": report["repeated"]["cycles"],
    }


def validate_reports(reports: list[dict[str, Any]]) -> None:
    first = reports[0]
    fingerprint = artifact_fingerprint(first)
    protocol = benchmark_protocol(first)
    for index, report in enumerate(reports, start=1):
        if report["backendIds"] != first["backendIds"]:
            raise SystemExit(f"campaign run {index} has a different backend set")
        if artifact_fingerprint(report) != fingerprint:
            raise SystemExit(f"campaign run {index} has different artifact provenance")
        if benchmark_protocol(report) != protocol:
            raise SystemExit(f"campaign run {index} used a different benchmark protocol")
        if not all(
            report[study]["passed"]
            for study in ("scaling", "memory", "interactions", "repeated")
        ):
            raise SystemExit(f"campaign run {index} contains a failed core study")
        if not report["passed"]:
            raise SystemExit(f"campaign run {index} contains a failed corpus")


def aggregate_timing_summaries(
    reports: list[dict[str, Any]], study: str | None
) -> dict[str, Any]:
    selected = reports if study is None else [report[study] for report in reports]
    return {
        backend_id: {
            "label": selected[0]["summaries"][backend_id]["label"],
            "phases": {
                phase: distribution(
                    report["summaries"][backend_id]["timing"][phase]["median"]
                    for report in selected
                )
                for phase in PHASES
            },
        }
        for backend_id in selected[0]["backendIds"]
    }


def aggregate_grouped_points(
    reports: list[dict[str, Any]], study: str, group_key: str
) -> list[dict[str, Any]]:
    first_study = reports[0][study]
    groups: list[dict[str, Any]] = []
    for source_group in first_study[group_key]:
        group = {
            key: value
            for key, value in source_group.items()
            if key not in {"points", "phaseTrends"}
        }
        group["points"] = []
        for source_point in source_group["points"]:
            run_points = [
                point_by_case(report[study][group_key], source_point["caseId"])
                for report in reports
            ]
            group["points"].append(
                {
                    "caseId": source_point["caseId"],
                    "label": source_point["label"],
                    "size": source_point.get("size"),
                    "sizeLabel": source_point.get("sizeLabel"),
                    "x": source_point.get("x"),
                    "xLabel": source_point.get("xLabel"),
                    "y": source_point.get("y"),
                    "yLabel": source_point.get("yLabel"),
                    "width": source_point["width"],
                    "input": source_point["input"],
                    "output": source_point["output"],
                    "backends": {
                        backend_id: {
                            phase: distribution(
                                point["backends"][backend_id]["summary"][phase]["median"]
                                for point in run_points
                            )
                            for phase in PHASES
                        }
                        for backend_id in first_study["backendIds"]
                    },
                }
            )
        groups.append(group)
    return groups


def aggregate_memory(reports: list[dict[str, Any]]) -> dict[str, Any]:
    backend_ids = reports[0]["backendIds"]
    retained: dict[str, Any] = {}
    for backend_id in backend_ids:
        growth: list[int | None] = []
        for report in reports:
            before = report["memory"]["initialMemory"]["backends"][backend_id][
                "committedBytes"
            ]
            after = report["memory"]["finalMemory"]["backends"][backend_id][
                "committedBytes"
            ]
            growth.append(
                after - before
                if isinstance(before, int) and isinstance(after, int)
                else None
            )
        retained[backend_id] = distribution(growth)

    repeated: dict[str, Any] = {}
    series_ids = {
        series["id"]
        for report in reports
        for series in report["repeated"].get("memoryTrace", {}).get("series", [])
    }
    for series_id in sorted(series_ids):
        values: dict[str, list[float | int | None]] = {
            "growthBytes": [],
            "tailGrowthBytes": [],
            "lastGrowthCycle": [],
        }
        labels: list[str] = []
        plateau_runs = 0
        observed_runs = 0
        for report in reports:
            trace = report["repeated"].get("memoryTrace", {})
            series = next(
                (
                    item
                    for item in trace.get("series", [])
                    if item["id"] == series_id
                ),
                None,
            )
            if not series or series["committed"]["samples"] == 0:
                continue
            labels.append(series["label"])
            summary = series["committed"]
            observed_runs += 1
            if summary["plateau"] is True:
                plateau_runs += 1
            for key in values:
                values[key].append(summary[key])
        if observed_runs > 0:
            repeated[series_id] = {
                "label": labels[0] if labels else series_id,
                "observedRuns": observed_runs,
                "plateauRuns": plateau_runs,
                **{key: distribution(value) for key, value in values.items()},
            }
    isolated: dict[str, Any] = {}
    for backend_id in ("vir", "vir-format"):
        growth: list[float | int | None] = []
        tail_growth: list[float | int | None] = []
        labels: list[str] = []
        plateau_runs = 0
        for report in reports:
            isolated_study = report["repeated"].get("isolated")
            if not isolated_study or backend_id not in isolated_study["reports"]:
                continue
            mode_report = isolated_study["reports"][backend_id]
            series = next(
                item
                for item in mode_report["memoryTrace"]["series"]
                if item["id"] == "vir-runtime"
            )
            summary = series["committed"]
            labels.append(mode_report["summaries"][backend_id]["label"])
            growth.append(summary["growthBytes"])
            tail_growth.append(summary["tailGrowthBytes"])
            if summary["plateau"] is True:
                plateau_runs += 1
        if labels:
            isolated[backend_id] = {
                "label": labels[0],
                "observedRuns": len(labels),
                "plateauRuns": plateau_runs,
                "growthBytes": distribution(growth),
                "tailGrowthBytes": distribution(tail_growth),
            }
    return {
        "retainedGrowthBytes": retained,
        "repeatedCommitted": repeated,
        "isolatedVirModes": isolated,
    }


def baseline_delta(candidate: float | None, baseline: float | None) -> float | None:
    if candidate is None or baseline is None or baseline == 0:
        return None
    return (candidate - baseline) / baseline


def baseline_comparison(
    candidate: dict[str, Any], baseline: float | None
) -> dict[str, Any]:
    median = candidate["median"]
    relation = "unavailable"
    if baseline is not None and candidate["min"] is not None and candidate["max"] is not None:
        if baseline < candidate["min"]:
            relation = "candidate-above-run-range"
        elif baseline > candidate["max"]:
            relation = "candidate-below-run-range"
        else:
            relation = "within-candidate-run-range"
    return {
        "baseline": baseline,
        "candidateMedian": median,
        "delta": baseline_delta(median, baseline),
        "relation": relation,
    }


def compare_baseline(aggregate: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    comparison: dict[str, Any] = {
        "compatible": True,
        "corpus": {},
        "scalingEndpoints": [],
        "interactions": [],
    }
    for backend_id, backend in aggregate["corpus"].items():
        comparison["corpus"][backend_id] = {
            phase: baseline_comparison(
                backend["phases"][phase],
                baseline["summaries"][backend_id]["timing"][phase]["median"],
            )
            for phase in PHASES
        }
    for group in aggregate["scaling"]["dimensions"]:
        point = group["points"][-1]
        baseline_point = point_by_case(baseline["scaling"]["dimensions"], point["caseId"])
        comparison["scalingEndpoints"].append(
            {
                "id": group["id"],
                "label": group["label"],
                "caseId": point["caseId"],
                "backends": {
                    backend_id: {
                        phase: baseline_comparison(
                            point["backends"][backend_id][phase],
                            baseline_point["backends"][backend_id]["summary"][phase][
                                "median"
                            ],
                        )
                        for phase in ("executeMs", "totalMs")
                    }
                    for backend_id in aggregate["backendIds"]
                },
            }
        )
    for group in aggregate["interactions"]["interactions"]:
        point = group["points"][-1]
        baseline_point = point_by_case(
            baseline["interactions"]["interactions"], point["caseId"]
        )
        comparison["interactions"].append(
            {
                "id": group["id"],
                "label": group["label"],
                "caseId": point["caseId"],
                "backends": {
                    backend_id: {
                        phase: baseline_comparison(
                            point["backends"][backend_id][phase],
                            baseline_point["backends"][backend_id]["summary"][phase][
                                "median"
                            ],
                        )
                        for phase in ("executeMs", "totalMs")
                    }
                    for backend_id in aggregate["backendIds"]
                },
            }
        )
    return comparison


def aggregate_reports(
    reports: list[dict[str, Any]],
    report_paths: list[Path],
    baseline: dict[str, Any] | None,
) -> dict[str, Any]:
    aggregate: dict[str, Any] = {
        "schemaVersion": 1,
        "kind": "pretty-benchmark-campaign",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "runCount": len(reports),
        "backendIds": reports[0]["backendIds"],
        "reports": [
            {
                "path": relative(path),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "generatedAt": report["generatedAt"],
            }
            for path, report in zip(report_paths, reports, strict=True)
        ],
        "artifactFingerprint": artifact_fingerprint(reports[0]),
        "protocol": benchmark_protocol(reports[0]),
        "coldStart": {
            backend_id: {
                "label": reports[0]["coldStart"]["backends"][backend_id]["label"],
                "startupMs": distribution(
                    report["coldStart"]["backends"][backend_id]["startupMs"]["median"]
                    for report in reports
                ),
                "resourceLoadMs": distribution(
                    report["coldStart"]["backends"][backend_id]["resourceLoadMs"][
                        "median"
                    ]
                    for report in reports
                ),
            }
            for backend_id in reports[0]["backendIds"]
        },
        "corpus": aggregate_timing_summaries(reports, None),
        "scaling": {
            "summaries": aggregate_timing_summaries(reports, "scaling"),
            "dimensions": aggregate_grouped_points(reports, "scaling", "dimensions"),
        },
        "interactions": {
            "summaries": aggregate_timing_summaries(reports, "interactions"),
            "interactions": aggregate_grouped_points(
                reports, "interactions", "interactions"
            ),
        },
        "repeated": aggregate_timing_summaries(reports, "repeated"),
        "memory": aggregate_memory(reports),
    }
    if baseline is None:
        aggregate["comparison"] = None
    elif benchmark_protocol(baseline) != aggregate["protocol"]:
        aggregate["comparison"] = {
            "compatible": False,
            "reason": "baseline used a different benchmark protocol",
            "baselineProtocol": benchmark_protocol(baseline),
        }
    else:
        aggregate["comparison"] = compare_baseline(aggregate, baseline)
    return aggregate


def ms(value: float | None) -> str:
    return "—" if value is None else f"{value:.3f}"


def percent(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:+.1f}%"


def comparison_signal(value: dict[str, Any] | None) -> str:
    if not value:
        return "—"
    return {
        "within-candidate-run-range": "within run range",
        "candidate-above-run-range": "above run range",
        "candidate-below-run-range": "below run range",
    }.get(value["relation"], "—")


def variability(value: dict[str, Any]) -> str:
    if value["median"] is None:
        return "—"
    cv = "—" if value["cv"] is None else f"{value['cv'] * 100:.1f}%"
    return f"{ms(value['median'])} [{ms(value['min'])}, {ms(value['max'])}] · CV {cv}"


def bytes_value(value: float | None) -> str:
    if value is None:
        return "—"
    if abs(value) < 1024:
        return f"{value:.0f} B"
    if abs(value) < 1024 * 1024:
        return f"{value / 1024:.1f} KiB"
    return f"{value / (1024 * 1024):.2f} MiB"


def byte_variability(value: dict[str, Any]) -> str:
    if value["median"] is None:
        return "—"
    cv = "—" if value["cv"] is None else f"{value['cv'] * 100:.1f}%"
    return (
        f"{bytes_value(value['median'])} "
        f"[{bytes_value(value['min'])}, {bytes_value(value['max'])}] · CV {cv}"
    )


def render_markdown(campaign: dict[str, Any]) -> str:
    comparison = campaign.get("comparison")
    compatible_comparison = comparison if comparison and comparison["compatible"] else None
    lines = [
        "# Pretty-printer benchmark campaign",
        "",
        f"- Generated: `{campaign['generatedAt']}`",
        f"- Fresh browser processes: `{campaign['runCount']}`",
        "- Values below: median across processes [minimum, maximum] · coefficient of variation",
        "- A single-report baseline inside the candidate process range is marked inconclusive",
    ]
    if comparison and not comparison["compatible"]:
        lines.append(f"- Baseline deltas omitted: {comparison['reason']}")
    lines += [
        "",
        "## Cold start",
        "",
        "| Backend | Startup ms | Resource-load wall ms |",
        "| --- | ---: | ---: |",
    ]
    for backend_id in campaign["backendIds"]:
        item = campaign["coldStart"][backend_id]
        lines.append(
            f"| {item['label']} | {variability(item['startupMs'])} | "
            f"{variability(item['resourceLoadMs'])} |"
        )
    lines += [
        "",
        "## Representative corpus",
        "",
        "| Backend | Execute ms | Total ms | Baseline execute | Signal | Baseline total | Signal |",
        "| --- | ---: | ---: | ---: | --- | ---: | --- |",
    ]
    for backend_id in campaign["backendIds"]:
        item = campaign["corpus"][backend_id]
        delta = compatible_comparison["corpus"][backend_id] if compatible_comparison else {}
        lines.append(
            f"| {item['label']} | {variability(item['phases']['executeMs'])} | "
            f"{variability(item['phases']['totalMs'])} | "
            f"{percent(delta.get('executeMs', {}).get('delta'))} | "
            f"{comparison_signal(delta.get('executeMs'))} | "
            f"{percent(delta.get('totalMs', {}).get('delta'))} | "
            f"{comparison_signal(delta.get('totalMs'))} |"
        )
    lines += [
        "",
        "## Scaling endpoints — execute",
        "",
        "| Dimension | Backend | Execute ms | Baseline delta | Signal |",
        "| --- | --- | ---: | ---: | --- |",
    ]
    comparison_scaling = (
        {item["id"]: item for item in compatible_comparison["scalingEndpoints"]}
        if compatible_comparison
        else {}
    )
    for group in campaign["scaling"]["dimensions"]:
        point = group["points"][-1]
        for backend_id in campaign["backendIds"]:
            delta = (
                comparison_scaling[group["id"]]["backends"][backend_id]["executeMs"]
                if compatible_comparison
                else None
            )
            lines.append(
                f"| {group['label']} · {point['sizeLabel']} | "
                f"{campaign['corpus'][backend_id]['label']} | "
                f"{variability(point['backends'][backend_id]['executeMs'])} | "
                f"{percent(delta['delta'] if delta else None)} | "
                f"{comparison_signal(delta)} |"
            )
    lines += [
        "",
        "## Repeated-call committed-memory tails",
        "",
        "| Memory | Observed runs | Plateau runs | Growth bytes | Tail growth bytes |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for item in campaign["memory"]["repeatedCommitted"].values():
        lines.append(
            f"| {item['label']} | {item['observedRuns']} | {item['plateauRuns']} | "
            f"{byte_variability(item['growthBytes'])} | "
            f"{byte_variability(item['tailGrowthBytes'])} |"
        )
    if campaign["memory"]["isolatedVirModes"]:
        lines += [
            "",
            "## Fresh-runtime VIR-mode memory",
            "",
            "| Mode | Observed runs | Plateau runs | Growth bytes | Tail growth bytes |",
            "| --- | ---: | ---: | ---: | ---: |",
        ]
        for item in campaign["memory"]["isolatedVirModes"].values():
            lines.append(
                f"| {item['label']} | {item['observedRuns']} | "
                f"{item['plateauRuns']} | {byte_variability(item['growthBytes'])} | "
                f"{byte_variability(item['tailGrowthBytes'])} |"
            )
    lines += ["", "## Run reports", ""]
    lines.extend(
        f"- `{item['path']}` · `{item['sha256']}`" for item in campaign["reports"]
    )
    return "\n".join(lines).rstrip() + "\n"


def collector_command(args: argparse.Namespace, output: Path) -> list[str]:
    return [
        "node",
        str(COLLECTOR),
        args.url,
        "--warmup",
        str(args.warmup),
        "--samples",
        str(args.samples),
        "--scaling-warmup",
        str(args.scaling_warmup),
        "--scaling-samples",
        str(args.scaling_samples),
        "--interaction-warmup",
        str(args.interaction_warmup),
        "--interaction-samples",
        str(args.interaction_samples),
        "--repeat-cycles",
        str(args.repeat_cycles),
        "--batch-target-ms",
        str(args.batch_target_ms),
        "--max-batch-iterations",
        str(args.max_batch_iterations),
        "--batch-memory-mib",
        str(args.batch_memory_mib),
        "--cold-runs",
        str(args.cold_runs),
        "--skip-isolated-memory",
        "--output",
        relative(output),
    ]


def main() -> int:
    args = parse_args()
    if args.runs < 1 or args.runs > 20:
        raise SystemExit("--runs must be between 1 and 20")
    if len(args.seed_report) > args.runs:
        raise SystemExit("seed report count exceeds --runs")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = workspace_path(
        args.output_dir or Path(f"_results/pretty-campaigns/{timestamp}"), "write"
    )
    if output_dir.exists() and any(output_dir.iterdir()):
        raise SystemExit(f"campaign output directory is not empty: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    report_paths: list[Path] = []
    for seed in args.seed_report:
        source = workspace_path(seed, "read")
        target = output_dir / f"run-{len(report_paths) + 1:03d}.json"
        shutil.copyfile(source, target)
        report_paths.append(target)

    while len(report_paths) < args.runs:
        target = output_dir / f"run-{len(report_paths) + 1:03d}.json"
        print(
            f"campaign process {len(report_paths) + 1}/{args.runs}: {relative(target)}",
            flush=True,
        )
        subprocess.run(collector_command(args, target), cwd=WORKSPACE, check=True)
        report_paths.append(target)

    reports = [json.loads(path.read_text()) for path in report_paths]
    validate_reports(reports)
    baseline = (
        json.loads(workspace_path(args.baseline, "read").read_text())
        if args.baseline
        else None
    )
    campaign = aggregate_reports(reports, report_paths, baseline)
    json_path = output_dir / "campaign.json"
    markdown_path = output_dir / "campaign.md"
    json_path.write_text(json.dumps(campaign, indent=2, ensure_ascii=False) + "\n")
    markdown_path.write_text(render_markdown(campaign))
    print(f"campaign JSON: {relative(json_path)}")
    print(f"campaign summary: {relative(markdown_path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
