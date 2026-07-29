#!/usr/bin/env python3
"""Retrospective, Provider-free audit of frozen official product-mark templates.

This is an evaluation sensor audit, not a production recognizer. It consumes a
previously used Development/Validation diagnostic cohort and reports the frozen
threshold separately from any setting selected after observing that cohort.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np


SENSOR_VERSION = "official-product-mark-sift-audit-v1"
DEFAULT_THRESHOLD = 5
RETROSPECTIVE_SAFE_THRESHOLDS = {
    "PANINI_PRIZM": 7,
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def percentile(values: list[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * probability) - 1))
    return round(ordered[index], 3)


def canonical_product(value: str) -> str:
    lowered = str(value or "").lower()
    if "phoenix" in lowered:
        return "PANINI_PHOENIX"
    if "prizm" in lowered:
        return "PANINI_PRIZM"
    return "UNKNOWN_PRODUCT"


def read_labels(path: Path) -> dict[str, dict[str, Any]]:
    labels: dict[str, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            labels[str(row["key"])] = row
    return labels


def load_references(manifest_path: Path, sift: cv2.SIFT) -> list[dict[str, Any]]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    references: list[dict[str, Any]] = []
    for row in manifest.get("references", []):
        image_path = manifest_path.parent / str(row["crop_artifact"])
        if sha256(image_path) != row["crop_artifact_sha256"]:
            raise RuntimeError(f"REFERENCE_HASH_MISMATCH:{image_path}")
        image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise RuntimeError(f"REFERENCE_DECODE_FAILED:{image_path}")
        keypoints, descriptors = sift.detectAndCompute(image, None)
        if descriptors is None or len(keypoints) < 5:
            raise RuntimeError(f"REFERENCE_DESCRIPTOR_MISSING:{image_path}")
        references.append(
            {
                "product_key": str(row["product_key"]),
                "path": str(image_path),
                "keypoints": keypoints,
                "descriptors": descriptors,
            }
        )
    if not references:
        raise RuntimeError("NO_REFERENCES")
    return references


def geometric_inliers(
    reference: dict[str, Any],
    target_keypoints: list[cv2.KeyPoint],
    target_descriptors: np.ndarray | None,
) -> int:
    if target_descriptors is None or len(target_keypoints) < 4:
        return 0
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    pairs = matcher.knnMatch(reference["descriptors"], target_descriptors, k=2)
    good = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < 0.72 * pair[1].distance]
    if len(good) < 4:
        return 0
    source_points = np.float32(
        [reference["keypoints"][match.queryIdx].pt for match in good]
    ).reshape(-1, 1, 2)
    target_points = np.float32(
        [target_keypoints[match.trainIdx].pt for match in good]
    ).reshape(-1, 1, 2)
    _, mask = cv2.findHomography(source_points, target_points, cv2.RANSAC, 5.0)
    return int(mask.sum()) if mask is not None else 0


def decide(scores: dict[str, int], thresholds: dict[str, int]) -> tuple[str, str]:
    eligible = [
        (score, product)
        for product, score in scores.items()
        if score >= thresholds.get(product, DEFAULT_THRESHOLD)
    ]
    if not eligible:
        return "UNKNOWN", "BELOW_THRESHOLD"
    eligible.sort(key=lambda item: (-item[0], item[1]))
    if len(eligible) > 1 and eligible[0][0] == eligible[1][0]:
        return "AMBIGUOUS", "TOP_SCORE_TIE"
    return eligible[0][1], "UNIQUE_TOP_SCORE"


def metrics(rows: list[dict[str, Any]], profile: str) -> dict[str, Any]:
    predictions = [row[profile]["prediction"] for row in rows]
    correct = sum(
        prediction == row["ground_truth_product"]
        for row, prediction in zip(rows, predictions, strict=True)
    )
    wrong = sum(
        prediction not in {"UNKNOWN", "AMBIGUOUS", row["ground_truth_product"]}
        for row, prediction in zip(rows, predictions, strict=True)
    )
    unknown = predictions.count("UNKNOWN")
    ambiguous = predictions.count("AMBIGUOUS")
    emitted = len(rows) - unknown - ambiguous
    return {
        "denominator": len(rows),
        "correct": correct,
        "critical_wrong": wrong,
        "unknown": unknown,
        "ambiguous": ambiguous,
        "emitted": emitted,
        "joint_correct_rate": round(correct / len(rows), 6) if rows else None,
        "precision_when_emitted": round(correct / emitted, 6) if emitted else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--labels", required=True)
    parser.add_argument("--images", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--target-max-dimension", type=int, default=0)
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    labels_path = Path(args.labels).resolve()
    images_path = Path(args.images).resolve()
    output_path = Path(args.output).resolve()

    cv2.setNumThreads(1)
    sift = cv2.SIFT_create(nfeatures=4000, contrastThreshold=0.015, edgeThreshold=12)
    references = load_references(manifest_path, sift)
    labels = read_labels(labels_path)
    rows: list[dict[str, Any]] = []
    latencies: list[float] = []

    for image_path in sorted(images_path.glob("*.jpg")):
        key = image_path.stem
        if key not in labels:
            continue
        image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise RuntimeError(f"EVALUATION_DECODE_FAILED:{image_path}")
        original_height, original_width = image.shape[:2]
        if args.target_max_dimension > 0 and max(image.shape[:2]) > args.target_max_dimension:
            scale = args.target_max_dimension / max(image.shape[:2])
            image = cv2.resize(
                image,
                (max(1, round(original_width * scale)), max(1, round(original_height * scale))),
                interpolation=cv2.INTER_AREA,
            )
        started = time.perf_counter()
        target_keypoints, target_descriptors = sift.detectAndCompute(image, None)
        scores = {
            reference["product_key"]: geometric_inliers(
                reference, target_keypoints, target_descriptors
            )
            for reference in references
        }
        latency_ms = (time.perf_counter() - started) * 1000
        latencies.append(latency_ms)
        baseline_thresholds = {
            reference["product_key"]: DEFAULT_THRESHOLD for reference in references
        }
        safe_thresholds = {
            product: RETROSPECTIVE_SAFE_THRESHOLDS.get(product, DEFAULT_THRESHOLD)
            for product in baseline_thresholds
        }
        baseline_prediction, baseline_reason = decide(scores, baseline_thresholds)
        safe_prediction, safe_reason = decide(scores, safe_thresholds)
        rows.append(
            {
                "item_id": key,
                "image_sha256": sha256(image_path),
                "ground_truth_product": canonical_product(
                    labels[key].get("identity_ground_truth", {}).get("product", "")
                ),
                "scores": dict(sorted(scores.items())),
                "baseline_frozen": {
                    "prediction": baseline_prediction,
                    "reason": baseline_reason,
                },
                "retrospective_precision_candidate": {
                    "prediction": safe_prediction,
                    "reason": safe_reason,
                },
                "latency_ms": round(latency_ms, 3),
                "original_dimensions": [original_width, original_height],
                "sensor_dimensions": [image.shape[1], image.shape[0]],
            }
        )

    report = {
        "schema_version": SENSOR_VERSION,
        "generated_at": "2026-07-30",
        "scope": "RETROSPECTIVE_DEVVAL_DIAGNOSTIC",
        "holdout_consumed": False,
        "provider_calls": 0,
        "network_calls": 0,
        "production_effect": False,
        "warning": (
            "The target resize and the Prizm threshold candidate were selected after observing "
            "this previously used dev/validation cohort. All 17 rows are retrospective diagnostics; "
            "both settings require a new untouched validation cohort."
        ),
        "sensor": {
            "algorithm": "SIFT_RATIO_RANSAC",
            "sift": {
                "nfeatures": 4000,
                "contrast_threshold": 0.015,
                "edge_threshold": 12,
            },
            "ratio_threshold": 0.72,
            "ransac_reprojection_threshold_px": 5.0,
            "target_max_dimension": args.target_max_dimension or None,
            "latency_scope": (
                "SIFT_FEATURE_EXTRACTION_AND_SIX_REFERENCE_MATCHES_"
                "EXCLUDES_DECODE_AND_RESIZE"
            ),
            "baseline_thresholds": {
                reference["product_key"]: DEFAULT_THRESHOLD for reference in references
            },
            "retrospective_candidate_thresholds": {
                product: RETROSPECTIVE_SAFE_THRESHOLDS.get(product, DEFAULT_THRESHOLD)
                for product in sorted(reference["product_key"] for reference in references)
            },
        },
        "inputs": {
            "reference_manifest": str(manifest_path),
            "reference_manifest_sha256": sha256(manifest_path),
            "labels": str(labels_path),
            "labels_sha256": sha256(labels_path),
            "images": str(images_path),
            "image_set_sha256": hashlib.sha256(
                json.dumps(
                    [[row["item_id"], row["image_sha256"]] for row in rows],
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest(),
        },
        "code_contract": {
            "script": str(Path(__file__).resolve()),
            "script_sha256": sha256(Path(__file__).resolve()),
        },
        "metrics": {
            "frozen_threshold_on_retrospective_scale": metrics(rows, "baseline_frozen"),
            "retrospective_precision_candidate": metrics(
                rows, "retrospective_precision_candidate"
            ),
            "latency_ms": {
                "p50": round(statistics.median(latencies), 3) if latencies else None,
                "p95": percentile(latencies, 0.95),
                "max": round(max(latencies), 3) if latencies else None,
            },
        },
        "gate": {
            "operational_joint_target": 0.85,
            "required_addressable_coverage_at_precision_0_99_deadline_0_95": 0.903775,
            "minimum_correct_on_17_for_operational_target": 15,
            "minimum_addressable_on_17_for_joint_gate": 16,
            "status": "NO_GO",
        },
        "rows": rows,
    }
    report["report_sha256"] = hashlib.sha256(
        json.dumps(report, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output_path), **report["metrics"], "gate": report["gate"]}, indent=2))


if __name__ == "__main__":
    main()
