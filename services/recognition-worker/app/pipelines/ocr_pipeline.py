from __future__ import annotations


def ocr_unavailable(model_version: str = "paddleocr_not_configured") -> dict:
    return {
        "status": "UNAVAILABLE",
        "reason": "paddleocr_adapter_not_enabled",
        "model_version": model_version,
        "items": [],
    }
