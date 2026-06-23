from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class FieldCandidate:
    raw: str
    normalized: str | None
    display: str | None
    valid: bool
    reason: str


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_serial(value: str) -> FieldCandidate:
    raw = normalize_text(value)
    compact = raw.replace(" ", "").replace("#", "")
    match = re.fullmatch(r"(\d{1,5})/(\d{1,5})", compact)
    if not match:
        return FieldCandidate(raw, None, None, False, "not_serial_format")
    numerator_raw, denominator_raw = match.groups()
    numerator = int(numerator_raw)
    denominator = int(denominator_raw)
    if denominator <= 0 or numerator > denominator:
        return FieldCandidate(raw, None, None, False, "serial_numerator_gt_denominator")
    normalized = f"{numerator}/{denominator}"
    return FieldCandidate(raw, normalized, f"{numerator_raw}/{denominator_raw}", True, "valid_serial")


def parse_collector_number(value: str, category: str = "sports_card") -> FieldCandidate:
    raw = normalize_text(value).replace("#", "")
    if not raw:
        return FieldCandidate(raw, None, None, False, "missing_collector_number")
    if re.fullmatch(r"\d{1,4}[A-Z]?", raw, re.I):
        return FieldCandidate(raw, raw.upper(), raw.upper(), True, "valid_collector_number")
    if category != "sports_card" and re.fullmatch(r"\d{1,4}/\d{1,4}", raw):
        return FieldCandidate(raw, raw, raw, True, "valid_tcg_fractional_collector_number")
    return FieldCandidate(raw, None, None, False, "invalid_collector_number")


def parse_checklist_code(value: str) -> FieldCandidate:
    raw = normalize_text(value)
    normalized = raw.replace(" ", "-").upper()
    if re.fullmatch(r"[A-Z0-9]{1,12}(?:-[A-Z0-9]{1,16}){0,3}", normalized):
        return FieldCandidate(raw, normalized, normalized, True, "valid_checklist_code")
    return FieldCandidate(raw, None, None, False, "invalid_checklist_code")


def parse_grade(value: str) -> dict[str, str | None]:
    text = normalize_text(value).upper()
    company_match = re.search(r"\b(PSA|BGS|CGC|SGC|TAG)\b", text)
    company = company_match.group(1) if company_match else None
    auto_match = re.search(r"\b(?:AUTO|AUTOGRAPH)\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b", text)
    slash_match = re.search(r"\b(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\b", text)
    card_match = re.search(r"\b(AUTH|AUTHENTIC|ALTERED|\d+(?:\.\d+)?)\b", text)

    if slash_match:
        return {
            "grade_company": company,
            "card_grade": slash_match.group(1),
            "auto_grade": slash_match.group(2),
            "grade_type": "CARD_AND_AUTO",
        }
    if auto_match and not re.search(r"\b(PSA|BGS|CGC|SGC|TAG)\s+\d", text):
        return {
            "grade_company": company,
            "card_grade": None,
            "auto_grade": auto_match.group(1).replace("AUTHENTIC", "Auth").replace("AUTH", "Auth"),
            "grade_type": "AUTO_ONLY",
        }
    if card_match:
        grade = card_match.group(1).replace("AUTHENTIC", "Auth").replace("AUTH", "Auth").replace("ALTERED", "Altered")
        return {
            "grade_company": company,
            "card_grade": grade,
            "auto_grade": auto_match.group(1) if auto_match else None,
            "grade_type": "CARD_AND_AUTO" if auto_match else ("AUTHENTIC" if grade == "Auth" else "ALTERED" if grade == "Altered" else "CARD_ONLY"),
        }
    return {
        "grade_company": company,
        "card_grade": None,
        "auto_grade": None,
        "grade_type": "UNKNOWN",
    }
