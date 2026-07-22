"""Fail-closed serial OCR across the persisted and upper-right card regions."""

from __future__ import annotations

import re
from typing import Any

from .google_vision_ocr import run_google_vision_ocr_batch

SERIAL_PATTERN = re.compile(r"(?<![A-Z0-9])#?0*(\d{1,6})\s*[/|-]\s*0*(\d{1,6})\b", re.IGNORECASE)
TOP_RIGHT_SERIAL_BOX = {"x": 0.60, "y": 0.02, "width": 0.38, "height": 0.28}


def crop_array(array: Any, box: dict[str, Any] | None) -> Any:
    if not box:
        return array
    height, width = array.shape[:2]
    x = float(box.get("x", box.get("left", 0)))
    y = float(box.get("y", box.get("top", 0)))
    crop_width = float(box.get("width", box.get("w", 0)))
    crop_height = float(box.get("height", box.get("h", 0)))
    if 0 <= x <= 1 and 0 <= y <= 1 and 0 < crop_width <= 1 and 0 < crop_height <= 1:
        x, y, crop_width, crop_height = x * width, y * height, crop_width * width, crop_height * height
    x1 = max(0, min(width - 1, int(round(x))))
    y1 = max(0, min(height - 1, int(round(y))))
    x2 = max(x1 + 1, min(width, int(round(x + crop_width))))
    y2 = max(y1 + 1, min(height, int(round(y + crop_height))))
    return array[y1:y2, x1:x2]


def expanded_crop(array: Any, box: dict[str, Any] | None, padding: float = 0.18) -> Any:
    if not box:
        return array
    height, width = array.shape[:2]
    x = float(box.get("x", box.get("left", 0)))
    y = float(box.get("y", box.get("top", 0)))
    crop_width = float(box.get("width", box.get("w", 0)))
    crop_height = float(box.get("height", box.get("h", 0)))
    if 0 <= x <= 1 and 0 <= y <= 1 and 0 < crop_width <= 1 and 0 < crop_height <= 1:
        x, y, crop_width, crop_height = x * width, y * height, crop_width * width, crop_height * height
    return crop_array(array, {
        "x": max(0, x - crop_width * padding),
        "y": max(0, y - crop_height * padding),
        "width": min(width, crop_width * (1 + 2 * padding)),
        "height": min(height, crop_height * (1 + 2 * padding)),
    })


def serial_readings(result: dict[str, Any]) -> dict[str, float]:
    readings: dict[str, float] = {}
    candidates = list(result.get("candidates") or [])
    if result.get("raw_text"):
        candidates.append({"text": result["raw_text"], "confidence": result.get("confidence") or 0})
    for candidate in candidates:
        confidence = float(candidate.get("confidence") or 0)
        for match in SERIAL_PATTERN.finditer(str(candidate.get("text") or "")):
            numerator, denominator = int(match.group(1)), int(match.group(2))
            if numerator < 1 or denominator < 1 or numerator > denominator:
                continue
            value = f"{match.group(1)}/{denominator}"
            readings[value] = max(readings.get(value, 0), confidence)
    return readings


def serial_consensus(primary: dict[str, Any], expanded: dict[str, Any]) -> dict[str, Any]:
    primary_values = serial_readings(primary)
    expanded_values = serial_readings(expanded)
    agreed = sorted(set(primary_values).intersection(expanded_values))
    chosen = agreed[0] if len(agreed) == 1 else ""
    primary_denominators = {value.split("/", 1)[1] for value in primary_values}
    expanded_denominators = {value.split("/", 1)[1] for value in expanded_values}
    denominator_agreement = sorted(primary_denominators.intersection(expanded_denominators))
    denominator = denominator_agreement[0] if len(denominator_agreement) == 1 else ""
    if chosen:
        confidence = min(primary_values[chosen], expanded_values[chosen])
        candidates = [{"text": chosen, "confidence": round(confidence, 4), "box": None}]
        raw_text = chosen
    elif denominator:
        candidates = [{"text": f"#/{denominator}", "confidence": 0.75, "box": None}]
        raw_text = f"#/{denominator}"
        confidence = 0.75
    else:
        candidates = []
        raw_text = ""
        confidence = 0.0
    return {
        "status": "OK" if candidates else "NO_TEXT",
        "candidates": candidates,
        "raw_text": raw_text,
        "confidence": confidence,
        "cost_estimate": round(
            float(primary.get("cost_estimate") or 0) + float(expanded.get("cost_estimate") or 0),
            6,
        ),
        "serial_consensus": {
            "verified": bool(chosen),
            "chosen": chosen or None,
            "denominator_only": denominator if not chosen else None,
            "primary_readings": sorted(primary_values),
            "expanded_readings": sorted(expanded_values),
            "conflict": bool(primary_values and expanded_values and not chosen),
        },
    }


def merge_serial_region_consensus(planned: dict[str, Any], top_right: dict[str, Any]) -> dict[str, Any]:
    planned_consensus = planned.get("serial_consensus") or {}
    top_right_consensus = top_right.get("serial_consensus") or {}
    verified_values = [
        str(consensus.get("chosen") or "")
        for consensus in (planned_consensus, top_right_consensus)
        if consensus.get("verified") is True and consensus.get("chosen")
    ]
    unique_verified = sorted(set(verified_values))
    chosen = unique_verified[0] if len(unique_verified) == 1 else ""
    selected = next(
        (result for result in (planned, top_right) if (result.get("serial_consensus") or {}).get("chosen") == chosen),
        None,
    ) if chosen else None
    denominator_hints = {
        str(consensus.get("denominator_only") or "")
        for consensus in (planned_consensus, top_right_consensus)
        if consensus.get("denominator_only")
    }
    if chosen:
        candidates = list((selected or {}).get("candidates") or [])
        raw_text = chosen
        confidence = float((selected or {}).get("confidence") or 0)
        denominator_only = None
    elif len(denominator_hints) == 1 and not verified_values:
        denominator_only = next(iter(denominator_hints))
        candidates = [{"text": f"#/{denominator_only}", "confidence": 0.75, "box": None}]
        raw_text = f"#/{denominator_only}"
        confidence = 0.75
    else:
        denominator_only = None
        candidates = []
        raw_text = ""
        confidence = 0.0
    return {
        "status": "OK" if candidates else "NO_TEXT",
        "candidates": candidates,
        "raw_text": raw_text,
        "confidence": confidence,
        "cost_estimate": round(float(planned.get("cost_estimate") or 0) + float(top_right.get("cost_estimate") or 0), 6),
        "serial_consensus": {
            "verified": bool(chosen),
            "chosen": chosen or None,
            "denominator_only": denominator_only,
            "planned_region": planned_consensus,
            "top_right_region": top_right_consensus,
            "conflict": len(unique_verified) > 1,
        },
    }


def run_google_vision_serial_regions(
    array: Any,
    planned_box: dict[str, Any] | None,
    *,
    config: Any,
    client: Any | None = None,
) -> dict[str, Any]:
    arrays = [
        crop_array(array, planned_box),
        expanded_crop(array, planned_box),
        crop_array(array, TOP_RIGHT_SERIAL_BOX),
        expanded_crop(array, TOP_RIGHT_SERIAL_BOX),
    ]
    batch = run_google_vision_ocr_batch(
        arrays,
        crop_types=[
            "serial_number",
            "serial_number_planned_expanded",
            "serial_number_top_right",
            "serial_number_top_right_expanded",
        ],
        config=config,
        client=client,
    )
    results = list(batch.get("results") or [])
    if len(results) != 4:
        return {
            "status": "UNAVAILABLE",
            "reason": batch.get("reason") or "serial_region_response_count_mismatch",
            "candidates": [],
            "raw_text": "",
            "confidence": 0.0,
            "cost_estimate": float(batch.get("cost_estimate") or 0),
            "vision_unit_count": int(batch.get("vision_unit_count") or 0),
            "latency_ms": int(batch.get("latency_ms") or 0),
        }
    merged = merge_serial_region_consensus(
        serial_consensus(results[0], results[1]),
        serial_consensus(results[2], results[3]),
    )
    return {
        **merged,
        "vision_unit_count": int(batch.get("vision_unit_count") or 0),
        "latency_ms": int(batch.get("latency_ms") or 0),
    }
