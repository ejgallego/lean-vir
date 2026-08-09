#!/usr/bin/env python3
"""Stage, build, benchmark, aggregate fresh processes, and refresh cards."""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


WORKSPACE = Path(__file__).resolve().parent.parent
COLLECTOR = WORKSPACE / "scripts/collect-report.mjs"
CAMPAIGN = WORKSPACE / "scripts/run-campaign.py"
CARDS = WORKSPACE / "scripts/generate-observation-cards.py"
SERVER = WORKSPACE / "scripts/serve.mjs"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("_results/pretty-benchmark.json"),
    )
    parser.add_argument(
        "--run-dir",
        type=Path,
        help="workspace output directory (default: timestamped under _results)",
    )
    parser.add_argument("--campaign-runs", type=int, default=3)
    parser.add_argument("--port", type=int, default=18336)
    parser.add_argument(
        "--skip-stage",
        action="store_true",
        help="reuse the current staged artifacts before rebuilding the app",
    )
    parser.add_argument("--skip-campaign", action="store_true")
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


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command: list[str]) -> None:
    print("+ " + " ".join(command), flush=True)
    subprocess.run(command, cwd=WORKSPACE, check=True)


def wait_for_server(process: subprocess.Popen[str], url: str) -> None:
    deadline = time.monotonic() + 30
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise SystemExit(f"benchmark server exited with {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception as error:  # retain the final connection error
            last_error = error
        time.sleep(0.1)
    raise SystemExit(f"benchmark server did not become ready: {last_error}")


def core_report_passed(report: dict[str, Any]) -> bool:
    return report["passed"] and all(
        report[study]["passed"]
        for study in ("scaling", "memory", "interactions", "repeated")
    )


def render_summary(manifest: dict[str, Any]) -> str:
    lines = [
        "# Pretty-printer artifact refresh",
        "",
        f"- Generated: `{manifest['generatedAt']}`",
        f"- Core benchmark passed: `{str(manifest['corePassed']).lower()}`",
        f"- Full isolated suite passed: `{str(manifest['isolatedPassed']).lower()}`",
        f"- Report: `{manifest['report']['path']}`",
        f"- Report SHA-256: `{manifest['report']['sha256']}`",
        f"- Cards: `{manifest['cards']}`",
    ]
    if manifest.get("baseline"):
        lines += [
            f"- Baseline: `{manifest['baseline']['path']}`",
            f"- Baseline SHA-256: `{manifest['baseline']['sha256']}`",
        ]
    if manifest.get("campaign"):
        lines += [
            f"- Campaign JSON: `{manifest['campaign']['json']}`",
            f"- Campaign summary: `{manifest['campaign']['markdown']}`",
        ]
    lines += [
        "",
        "This command never publishes. Review the report, campaign deltas, cards, ",
        "and artifact provenance before copying or publishing any output.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    if not 1 <= args.campaign_runs <= 20:
        raise SystemExit("--campaign-runs must be between 1 and 20")
    if not 1 <= args.port <= 65535:
        raise SystemExit("--port must be between 1 and 65535")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = workspace_path(
        args.run_dir or Path(f"_results/pretty-refresh/{timestamp}"), "write"
    )
    if run_dir.exists() and any(run_dir.iterdir()):
        raise SystemExit(f"refresh output directory is not empty: {run_dir}")
    run_dir.mkdir(parents=True, exist_ok=True)
    report_path = workspace_path(args.report, "write")

    baseline_path = None
    if report_path.is_file():
        baseline_path = run_dir / "baseline.json"
        shutil.copyfile(report_path, baseline_path)

    if not args.skip_stage:
        run(["npm", "run", "stage"])
    run(["npm", "run", "build"])

    server_log = run_dir / "server.log"
    url = f"http://127.0.0.1:{args.port}/"
    with server_log.open("w") as log:
        server = subprocess.Popen(
            ["node", str(SERVER), "--port", str(args.port)],
            cwd=WORKSPACE,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            wait_for_server(server, url)
            run(
                [
                    "node",
                    str(COLLECTOR),
                    url,
                    "--allow-isolated-failures",
                    "--output",
                    relative(report_path),
                ]
            )
            report = json.loads(report_path.read_text())
            if not core_report_passed(report):
                raise SystemExit("refreshed artifact failed a core benchmark study")
            run([sys.executable, str(CARDS), relative(report_path)])

            campaign_dir = run_dir / "campaign"
            if not args.skip_campaign:
                command = [
                    sys.executable,
                    str(CAMPAIGN),
                    url,
                    "--runs",
                    str(args.campaign_runs),
                    "--seed-report",
                    relative(report_path),
                    "--output-dir",
                    relative(campaign_dir),
                ]
                if baseline_path:
                    command += ["--baseline", relative(baseline_path)]
                run(command)
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)

    isolated_memory = report["memory"].get("isolated")
    isolated_repeats = report["repeated"].get("isolated")
    isolated_passed = (
        (isolated_memory is None or isolated_memory["passed"])
        and (isolated_repeats is None or isolated_repeats["passed"])
    )
    cards_dir = WORKSPACE / "_results/performance-cards"
    cards_snapshot = run_dir / "cards"
    shutil.copytree(cards_dir, cards_snapshot)
    manifest: dict[str, Any] = {
        "schemaVersion": 1,
        "kind": "pretty-benchmark-refresh",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "corePassed": True,
        "isolatedPassed": isolated_passed,
        "report": {"path": relative(report_path), "sha256": sha256(report_path)},
        "baseline": (
            {"path": relative(baseline_path), "sha256": sha256(baseline_path)}
            if baseline_path
            else None
        ),
        "cards": relative(cards_snapshot),
        "campaign": (
            {
                "json": relative(campaign_dir / "campaign.json"),
                "markdown": relative(campaign_dir / "campaign.md"),
            }
            if not args.skip_campaign
            else None
        ),
        "serverLog": relative(server_log),
    }
    (run_dir / "refresh.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (run_dir / "README.md").write_text(render_summary(manifest))
    print(f"refresh manifest: {relative(run_dir / 'refresh.json')}")
    print(f"refresh summary: {relative(run_dir / 'README.md')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
