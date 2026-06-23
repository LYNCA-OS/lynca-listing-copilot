from __future__ import annotations


def normalize_ocr_item(item: dict, index: int = 0) -> dict:
    text = str(item.get("text") or item.get("observed_text") or item.get("raw_text") or "").strip()
    return {
        "item_id": item.get("item_id") or f"ocr_{index + 1}",
        "image_id": item.get("image_id"),
        "role": item.get("role") or item.get("capture_role"),
        "text": text,
        "observed_text": text,
        "confidence": float(item.get("confidence", item.get("score", 0.5)) or 0.5),
        "bbox": item.get("bbox"),
        "polygon": item.get("polygon"),
        "source_type": item.get("source_type") or "OCR",
    }


def ocr_evidence_from_items(items: list[dict], model_version: str = "external_ocr_adapter") -> dict:
    normalized = [normalize_ocr_item(item, index) for index, item in enumerate(items)]
    normalized = [item for item in normalized if item["observed_text"]]
    return {
        "status": "OK" if normalized else "NO_TEXT",
        "model_version": model_version,
        "items": normalized,
    }


def ocr_unavailable(model_version: str = "paddleocr_not_configured") -> dict:
    return {
        "status": "UNAVAILABLE",
        "reason": "paddleocr_adapter_not_enabled",
        "model_version": model_version,
        "items": [],
    }
