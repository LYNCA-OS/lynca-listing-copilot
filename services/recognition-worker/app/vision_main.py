from __future__ import annotations

import re
import time
from typing import Any

try:
    from fastapi import FastAPI, Header, HTTPException
except ImportError:  # pragma: no cover
    FastAPI = None
    Header = None
    HTTPException = Exception

from .config import load_config
from .contracts import validate_ocr_field_request
from .pipelines.google_vision_ocr import MAX_SYNC_IMAGES, run_google_vision_ocr_batch
from .pipelines.image_loader import ImageLoadError, load_signed_image
from .security import SecurityError, UrlPolicy, validate_image_url, verify_bearer_token

_SERIAL_PATTERN = re.compile(r"(?<![A-Z0-9])#?0*(\d{1,6})\s*[/|-]\s*0*(\d{1,6})\b", re.IGNORECASE)
_MAX_FIELD_REQUESTS = 8


def _crop(array: Any, box: dict[str, Any] | None) -> Any:
    if not box:
        return array
    height, width = array.shape[:2]
    x = float(box.get("x", box.get("left", 0)))
    y = float(box.get("y", box.get("top", 0)))
    crop_width = float(box.get("width", box.get("w", 0)))
    crop_height = float(box.get("height", box.get("h", 0)))
    # Normalized boxes remain supported for older persisted crop plans.
    if 0 <= x <= 1 and 0 <= y <= 1 and 0 < crop_width <= 1 and 0 < crop_height <= 1:
        x, y, crop_width, crop_height = x * width, y * height, crop_width * width, crop_height * height
    x1 = max(0, min(width - 1, int(round(x))))
    y1 = max(0, min(height - 1, int(round(y))))
    x2 = max(x1 + 1, min(width, int(round(x + crop_width))))
    y2 = max(y1 + 1, min(height, int(round(y + crop_height))))
    return array[y1:y2, x1:x2]


def _expanded_crop(array: Any, box: dict[str, Any] | None, padding: float = 0.18) -> Any:
    if not box:
        return array
    height, width = array.shape[:2]
    x = float(box.get("x", box.get("left", 0)))
    y = float(box.get("y", box.get("top", 0)))
    crop_width = float(box.get("width", box.get("w", 0)))
    crop_height = float(box.get("height", box.get("h", 0)))
    if 0 <= x <= 1 and 0 <= y <= 1 and 0 < crop_width <= 1 and 0 < crop_height <= 1:
        x, y, crop_width, crop_height = x * width, y * height, crop_width * width, crop_height * height
    return _crop(array, {
        "x": max(0, x - crop_width * padding),
        "y": max(0, y - crop_height * padding),
        "width": min(width, crop_width * (1 + 2 * padding)),
        "height": min(height, crop_height * (1 + 2 * padding)),
    })


def _serial_readings(result: dict[str, Any]) -> dict[str, float]:
    readings: dict[str, float] = {}
    candidates = list(result.get("candidates") or [])
    if result.get("raw_text"):
        candidates.append({"text": result["raw_text"], "confidence": result.get("confidence") or 0})
    for candidate in candidates:
        confidence = float(candidate.get("confidence") or 0)
        for match in _SERIAL_PATTERN.finditer(str(candidate.get("text") or "")):
            numerator, denominator = int(match.group(1)), int(match.group(2))
            if numerator < 1 or denominator < 1 or numerator > denominator:
                continue
            value = f"{match.group(1)}/{denominator}"
            readings[value] = max(readings.get(value, 0), confidence)
    return readings


def _serial_consensus(primary: dict[str, Any], expanded: dict[str, Any]) -> dict[str, Any]:
    primary_values = _serial_readings(primary)
    expanded_values = _serial_readings(expanded)
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


def _public_result(request: dict[str, Any], result: dict[str, Any], *, batch_latency_ms: int, unit_count: int) -> dict[str, Any]:
    candidates = list(result.get("candidates") or [])
    return {
        "request_id": request.get("request_id"),
        "crop_type": request.get("crop_type"),
        "status": result.get("status") or "UNAVAILABLE",
        "raw_text": result.get("raw_text") or "",
        "text_candidates": candidates,
        "boxes": [
            {"text": item.get("text"), "confidence": item.get("confidence"), "box": item.get("box")}
            for item in candidates if item.get("box") is not None
        ],
        "confidence": float(result.get("confidence") or 0),
        "latency_ms": batch_latency_ms,
        "model_id": "google-cloud-vision",
        "model_revision": "document-text-detection",
        "ocr_backend": "google_vision",
        "vision_unit_count": unit_count,
        "vision_cost_estimate": result.get("cost_estimate"),
        **({"reason": result.get("reason")} if result.get("reason") else {}),
        **({"serial_consensus": result.get("serial_consensus")} if result.get("serial_consensus") else {}),
    }


def ocr_fields_batch_payload(payload: dict[str, Any], authorization: str | None = None, *, vision_client: Any | None = None) -> dict[str, Any]:
    started = time.time()
    config = load_config()
    verify_bearer_token(authorization, config.token)
    requests = payload.get("requests") if isinstance(payload, dict) else None
    if not isinstance(requests, list) or not requests or len(requests) > _MAX_FIELD_REQUESTS:
        raise ValueError({"errors": [{"path": "requests", "message": "1 to 8 OCR requests are required"}]})
    errors = []
    for index, request in enumerate(requests):
        errors.extend({"path": f"requests[{index}].{item['path']}", "message": item["message"]} for item in validate_ocr_field_request(request))
    if errors:
        raise ValueError({"errors": errors})

    loaded_by_url: dict[str, Any] = {}
    for request in requests:
        image_url = str(request.get("image_url") or "")
        validate_image_url(image_url, UrlPolicy(config.allowed_image_hosts))
        if image_url in loaded_by_url:
            continue
        metadata = request.get("metadata") or {}
        loaded_by_url[image_url] = load_signed_image(
            {"image_id": metadata.get("image_id") or request.get("request_id"), "role": request.get("crop_type"), "signed_url": image_url},
            allowed_hosts=config.allowed_image_hosts,
            max_bytes=config.max_image_bytes,
            max_total_pixels=config.max_total_pixels,
            timeout_seconds=config.request_timeout_seconds,
        )

    arrays = []
    crop_types = []
    result_slots: list[tuple[int, int | None]] = []
    for request in requests:
        loaded = loaded_by_url[str(request.get("image_url") or "")]
        exact_index = len(arrays)
        arrays.append(_crop(loaded.array, request.get("crop_box")))
        crop_types.append(str(request.get("crop_type") or ""))
        expanded_index = None
        if str(request.get("crop_type") or "").lower() in {"serial_number", "serial_crop"}:
            expanded_index = len(arrays)
            arrays.append(_expanded_crop(loaded.array, request.get("crop_box")))
            crop_types.append("serial_number_consensus")
        result_slots.append((exact_index, expanded_index))
    if len(arrays) > MAX_SYNC_IMAGES:
        raise ValueError({"errors": [{"path": "requests", "message": "expanded Vision batch exceeds 16 image units"}]})

    batch = run_google_vision_ocr_batch(arrays, crop_types=crop_types, config=config, client=vision_client)
    raw_results = batch.get("results") or []
    output = []
    for request, (exact_index, expanded_index) in zip(requests, result_slots, strict=False):
        primary = raw_results[exact_index] if exact_index < len(raw_results) else {"status": "UNAVAILABLE", "reason": batch.get("reason")}
        unit_count = 1
        if expanded_index is not None:
            expanded = raw_results[expanded_index] if expanded_index < len(raw_results) else {"status": "UNAVAILABLE"}
            primary = {**primary, **_serial_consensus(primary, expanded)}
            unit_count = 2
        output.append(_public_result(request, primary, batch_latency_ms=int(batch.get("latency_ms") or 0), unit_count=unit_count))
    return {
        "status": "OK" if any(item.get("status") == "OK" for item in output) else batch.get("status", "UNAVAILABLE"),
        "results": output,
        "request_count": len(requests),
        "unique_image_download_count": len(loaded_by_url),
        "vision_unit_count": int(batch.get("vision_unit_count") or 0),
        "vision_cost_estimate": batch.get("cost_estimate") or 0,
        "latency_ms": int((time.time() - started) * 1000),
        "backend": "google_vision",
        "auth_mode": "adc",
    }


def ocr_field_payload(payload: dict[str, Any], authorization: str | None = None, *, vision_client: Any | None = None) -> dict[str, Any]:
    result = ocr_fields_batch_payload({"requests": [payload]}, authorization, vision_client=vision_client)
    return result["results"][0]


if FastAPI is not None:
    app = FastAPI(title="LYNCA Vision OCR Worker", version="vision-ocr-v2")

    @app.get("/healthz")
    def healthz() -> dict[str, Any]:
        return {"status": "ok", "service": "vision-ocr"}

    @app.get("/readyz")
    def readyz() -> dict[str, Any]:
        config = load_config()
        return {
            "status": "ready" if config.vision_use_adc and bool(config.token) else "not_ready",
            "service": "vision-ocr",
            "backend": "google_vision",
            "auth_mode": "adc",
            "max_sync_images": MAX_SYNC_IMAGES,
            "paddle_loaded": False,
            "tesseract_loaded": False,
            "opencv_loaded": False,
        }

    @app.post("/v1/ocr-field")
    def ocr_field(payload: dict[str, Any], authorization: str | None = Header(default=None)) -> dict[str, Any]:
        try:
            return ocr_field_payload(payload, authorization)
        except (ValueError, ImageLoadError, SecurityError) as error:
            raise HTTPException(status_code=400, detail=str(error)[:500]) from error

    @app.post("/v1/ocr-fields-batch")
    def ocr_fields_batch(payload: dict[str, Any], authorization: str | None = Header(default=None)) -> dict[str, Any]:
        try:
            return ocr_fields_batch_payload(payload, authorization)
        except (ValueError, ImageLoadError, SecurityError) as error:
            raise HTTPException(status_code=400, detail=str(error)[:500]) from error
else:  # pragma: no cover
    app = None
