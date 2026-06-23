from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .pipelines.field_parsers import parse_checklist_code, parse_collector_number, parse_grade, parse_serial


FIELDS = [
    "serial_number",
    "collector_number",
    "checklist_code",
    "grade_company",
    "card_grade",
    "auto_grade",
    "grade_type",
]


def _load_items(path: str | None) -> list[dict[str, Any]]:
    if not path:
        return []
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("items"), list):
        return payload["items"]
    raise ValueError("worker eval input must be an array or { items: [] }")


def _normalize(field: str, value: Any) -> Any:
    if value is None:
        return None
    text = str(value).strip()
    if field == "serial_number":
        return parse_serial(text).normalized
    if field == "collector_number":
        return parse_collector_number(text).normalized
    if field == "checklist_code":
        return parse_checklist_code(text).normalized
    if field == "grade_company":
        return text.upper() or None
    if field in {"card_grade", "auto_grade"}:
        normalized = text.upper().replace("AUTHENTIC", "Auth").replace("AUTH", "Auth").replace("ALTERED", "Altered")
        return normalized or None
    if field == "grade_type":
        normalized = text.upper()
        if normalized in {"CARD_ONLY", "AUTO_ONLY", "CARD_AND_AUTO", "AUTHENTIC", "ALTERED", "UNKNOWN"}:
            return normalized
        return parse_grade(text).get(field)
    return text


def _prediction_fields(item: dict[str, Any]) -> dict[str, Any]:
    prediction = item.get("prediction") or item.get("worker_output") or {}
    if isinstance(prediction.get("resolved_fields"), dict):
        return prediction["resolved_fields"]
    if isinstance(prediction.get("fields"), dict):
        return prediction["fields"]
    if isinstance(prediction.get("field_candidates"), dict):
        fields = {}
        for field, candidates in prediction["field_candidates"].items():
            if isinstance(candidates, list) and candidates:
                first = candidates[0]
                fields[field] = first.get("normalized") or first.get("normalized_value") or first.get("value")
        return fields
    return {}


def evaluate_worker_items(items: list[dict[str, Any]]) -> dict[str, Any]:
    counts = {field: {"correct": 0, "total": 0} for field in FIELDS}
    technical_failures = 0

    for item in items:
        ground_truth = item.get("ground_truth") or {}
        prediction = _prediction_fields(item)
        if item.get("prediction", {}).get("technical_failure") is True:
            technical_failures += 1

        for field in FIELDS:
            truth = ground_truth.get(field)
            if truth in (None, "", []):
                continue
            counts[field]["total"] += 1
            expected = _normalize(field, truth)
            actual = _normalize(field, prediction.get(field))
            if expected is not None and expected == actual:
                counts[field]["correct"] += 1

    field_accuracy = {
        field: {
            **count,
            "accuracy": (count["correct"] / count["total"]) if count["total"] else None,
        }
        for field, count in counts.items()
    }
    total = sum(count["total"] for count in counts.values())
    correct = sum(count["correct"] for count in counts.values())

    return {
        "evaluation_version": "recognition-worker-eval-v1",
        "total_items": len(items),
        "field_level_accuracy": (correct / total) if total else None,
        "field_accuracy": field_accuracy,
        "technical_failure_count": technical_failures,
        "notes": [
            "This evaluates worker field candidates only.",
            "It does not claim commercial card-level accuracy.",
            "Failed and missing predictions remain in denominators when ground truth exists.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Recognition Worker field outputs.")
    parser.add_argument("--input", "-i", help="JSON array or { items: [] } file", default=None)
    parser.add_argument("--output", "-o", help="Optional output JSON path", default=None)
    args = parser.parse_args()

    result = evaluate_worker_items(_load_items(args.input))
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
