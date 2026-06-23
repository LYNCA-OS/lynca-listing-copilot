from __future__ import annotations

import re
from typing import Any

from .field_parsers import parse_checklist_code, parse_collector_number, parse_grade, parse_serial


def _text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _confidence(item: dict[str, Any], multiplier: float = 1.0) -> float:
    try:
        value = float(item.get("confidence", item.get("score", 0.5)))
    except (TypeError, ValueError):
        value = 0.5
    return max(0.0, min(1.0, round(value * multiplier, 4)))


def _role(item: dict[str, Any]) -> str:
    return _text(item.get("role") or item.get("capture_role") or "").lower()


def _source_type(item: dict[str, Any], field: str = "") -> str:
    explicit = _text(item.get("source_type")).upper()
    if explicit in {"SLAB_LABEL", "CARD_FRONT", "CARD_BACK", "OCR"}:
        return explicit
    role = _role(item)
    text = _text(item.get("observed_text") or item.get("text")).upper()
    if "grade_label" in role or "slab" in role or field in {"grade_company", "card_grade", "auto_grade", "grade_type"}:
        return "SLAB_LABEL"
    if re.search(r"\b(PSA|BGS|CGC|SGC|TAG)\b", text):
        return "SLAB_LABEL"
    if "back" in role:
        return "CARD_BACK"
    if "front" in role:
        return "CARD_FRONT"
    return "OCR"


def _requested(requested_fields: list[str] | None, field: str) -> bool:
    if not requested_fields:
        return True
    requested = set(requested_fields)
    if field in requested:
        return True
    if field in {"year"} and "year_product" in requested:
        return True
    if field in {"grade_company", "card_grade", "auto_grade", "grade_type"} and "grade_label" in requested:
        return True
    return False


def _candidate(item: dict[str, Any], field: str, value: str, *, confidence_multiplier: float = 1.0, reason: str = "") -> dict[str, Any]:
    return {
        "field": field,
        "value": value,
        "confidence": _confidence(item, confidence_multiplier),
        "image_id": item.get("image_id"),
        "role": item.get("role") or item.get("capture_role"),
        "source_type": _source_type(item, field),
        "observed_text": _text(item.get("observed_text") or item.get("text")),
        "bbox": item.get("bbox"),
        "polygon": item.get("polygon"),
        "parser_reason": reason,
    }


def _field_candidate(item: dict[str, Any], field: str, value: str, *, confidence_multiplier: float = 1.0, reason: str = "") -> dict[str, Any]:
    return {
        "value": value,
        "confidence": _confidence(item, confidence_multiplier),
        "image_id": item.get("image_id"),
        "role": item.get("role") or item.get("capture_role"),
        "source_type": _source_type(item, field),
        "observed_text": _text(item.get("observed_text") or item.get("text")),
        "reason": reason,
    }


def _extract_serial_texts(text: str) -> list[str]:
    return [match.group(0) for match in re.finditer(r"#?\b\d{1,5}\s*/\s*\d{1,5}\b", text)]


def _extract_year_texts(text: str) -> list[str]:
    return [match.group(0) for match in re.finditer(r"\b(?:19|20)\d{2}\b", text)]


def _extract_checklist_texts(text: str) -> list[str]:
    values = [
        match.group(0)
        for match in re.finditer(r"\b[A-Z0-9]{1,12}(?:-[A-Z0-9]{1,16}){1,3}\b", text, flags=re.I)
    ]
    values.extend(
        match.group(0)
        for match in re.finditer(r"\b[A-Z]{1,8}\s+\d{1,4}[A-Z]?\b", text)
    )
    return values


def _extract_collector_texts(text: str) -> list[str]:
    values = []
    for match in re.finditer(r"(?:#|NO\.?\s*)\s*([A-Z]?\d{1,4}[A-Z]?)\b", text, flags=re.I):
        values.append(match.group(1))
    if re.fullmatch(r"\d{1,4}[A-Z]?", text, flags=re.I):
        values.append(text)
    return values


def _add_candidate(field_candidates: dict[str, list[dict[str, Any]]], item: dict[str, Any], field: str, value: str, *, reason: str = "", confidence_multiplier: float = 1.0) -> None:
    field_candidates.setdefault(field, []).append(
        _field_candidate(item, field, value, reason=reason, confidence_multiplier=confidence_multiplier)
    )


def _parse_item(item: dict[str, Any], requested_fields: list[str] | None = None) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    text = _text(item.get("observed_text") or item.get("text"))
    role = _role(item)
    candidates: list[dict[str, Any]] = []
    field_candidates: dict[str, list[dict[str, Any]]] = {}
    if not text:
        return candidates, field_candidates

    grade_like_line = "grade_label" in role or re.search(r"\b(PSA|BGS|CGC|SGC|TAG)\b", text, flags=re.I)
    if grade_like_line:
        grade = parse_grade(text)
        if any(grade.get(field) for field in ("grade_company", "card_grade", "auto_grade")):
            parsed_fields = {field: value for field, value in grade.items() if value}
            if any(_requested(requested_fields, field) for field in parsed_fields):
                candidates.append({
                    "field": "grade_label",
                    "value": text,
                    "confidence": _confidence(item),
                    "image_id": item.get("image_id"),
                    "role": item.get("role") or item.get("capture_role"),
                    "source_type": _source_type(item, "grade_company"),
                    "observed_text": text,
                    "parsed_fields": parsed_fields,
                })
                for field, value in parsed_fields.items():
                    if _requested(requested_fields, field):
                        _add_candidate(field_candidates, item, field, value, reason="parsed_grade_label")

    if _requested(requested_fields, "serial_number") and not grade_like_line:
        for raw in _extract_serial_texts(text):
            parsed = parse_serial(raw)
            if parsed.valid and parsed.normalized:
                candidates.append(_candidate(item, "serial_number", parsed.normalized, reason=parsed.reason))
                _add_candidate(field_candidates, item, "serial_number", parsed.normalized, reason=parsed.reason)

    if _requested(requested_fields, "collector_number"):
        for raw in _extract_collector_texts(text):
            parsed = parse_collector_number(raw)
            if parsed.valid and parsed.normalized:
                candidates.append(_candidate(item, "collector_number", parsed.normalized, confidence_multiplier=0.88, reason=parsed.reason))
                _add_candidate(field_candidates, item, "collector_number", parsed.normalized, confidence_multiplier=0.88, reason=parsed.reason)

    if _requested(requested_fields, "checklist_code"):
        for raw in _extract_checklist_texts(text):
            parsed = parse_checklist_code(raw)
            if parsed.valid and parsed.normalized and not re.fullmatch(r"\d{1,4}", parsed.normalized):
                candidates.append(_candidate(item, "checklist_code", parsed.normalized, confidence_multiplier=0.86, reason=parsed.reason))
                _add_candidate(field_candidates, item, "checklist_code", parsed.normalized, confidence_multiplier=0.86, reason=parsed.reason)

    if _requested(requested_fields, "year"):
        for raw in _extract_year_texts(text):
            candidates.append(_candidate(item, "year", raw, confidence_multiplier=0.84, reason="parsed_printed_year"))
            _add_candidate(field_candidates, item, "year", raw, confidence_multiplier=0.84, reason="parsed_printed_year")

    return candidates, field_candidates


def _canonical(value: Any) -> str:
    return _text(value).lower()


def _merge_field_candidates(field_candidates: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    merged: dict[str, list[dict[str, Any]]] = {}
    for field, candidates in field_candidates.items():
        by_value: dict[str, dict[str, Any]] = {}
        for candidate in candidates:
            key = _canonical(candidate.get("value"))
            existing = by_value.get(key)
            if existing is None or candidate["confidence"] > existing["confidence"]:
                by_value[key] = candidate
        merged[field] = sorted(by_value.values(), key=lambda candidate: candidate["confidence"], reverse=True)
    return merged


def _conflicts(field_candidates: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    conflicts: list[dict[str, Any]] = []
    for field, candidates in field_candidates.items():
        values = sorted({_canonical(candidate.get("value")) for candidate in candidates if candidate.get("value")})
        if len(values) <= 1:
            continue
        conflicts.append({
            "field": field,
            "conflict_type": "OCR_VALUE_CONFLICT",
            "conflicting_values": [candidate["value"] for candidate in candidates],
            "severity": "MEDIUM" if field not in {"serial_number", "grade_company", "card_grade", "auto_grade"} else "HIGH",
            "reason": "OCR text produced multiple normalized candidates for the same field.",
        })
    return conflicts


def _resolved_fields(field_candidates: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    resolved: dict[str, Any] = {}
    for field, candidates in field_candidates.items():
        if not candidates:
            continue
        resolved[field] = candidates[0]["value"]
    return resolved


def fuse_ocr_evidence(ocr_evidence: dict[str, Any] | None = None, requested_fields: list[str] | None = None) -> dict[str, Any]:
    items = []
    field_candidates: dict[str, list[dict[str, Any]]] = {}
    for item in (ocr_evidence or {}).get("items", []) or []:
        parsed_items, parsed_field_candidates = _parse_item(item, requested_fields)
        items.extend(parsed_items)
        for field, candidates in parsed_field_candidates.items():
            field_candidates.setdefault(field, []).extend(candidates)

    merged_candidates = _merge_field_candidates(field_candidates)
    conflicts = _conflicts(merged_candidates)
    status = "NO_EVIDENCE"
    if items:
        status = "CONFLICT" if conflicts else "OK"

    return {
        "status": status,
        "items": items,
        "field_candidates": merged_candidates,
        "resolved_fields": _resolved_fields(merged_candidates),
        "conflicts": conflicts,
        "trace": [
            {
                "step": "parse_ocr_text_items",
                "input_item_count": len((ocr_evidence or {}).get("items", []) or []),
                "output_item_count": len(items),
                "status": status,
            }
        ],
    }


def fuse_evidence_placeholder() -> dict:
    return {
        "status": "NO_EVIDENCE",
        "items": [],
        "field_candidates": {},
        "resolved_fields": {},
        "conflicts": [],
        "trace": [],
        "note": "Fusion waits for OCR, Agnes, and retrieval evidence. No generated facts are fabricated.",
    }
