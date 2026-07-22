from __future__ import annotations

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
from .pipelines.serial_region_ocr import (
    TOP_RIGHT_SERIAL_BOX as _TOP_RIGHT_SERIAL_BOX,
    crop_array as _crop,
    expanded_crop as _expanded_crop,
    merge_serial_region_consensus as _merge_serial_region_consensus,
    serial_consensus as _serial_consensus,
)
from .security import SecurityError, UrlPolicy, validate_image_url, verify_bearer_token

_MAX_FIELD_REQUESTS = 8


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
    result_slots: list[tuple[int, int | None, int | None, int | None]] = []
    for request in requests:
        loaded = loaded_by_url[str(request.get("image_url") or "")]
        exact_index = len(arrays)
        arrays.append(_crop(loaded.array, request.get("crop_box")))
        crop_types.append(str(request.get("crop_type") or ""))
        expanded_index = None
        top_right_index = None
        top_right_expanded_index = None
        if str(request.get("crop_type") or "").lower() in {"serial_number", "serial_crop"}:
            expanded_index = len(arrays)
            arrays.append(_expanded_crop(loaded.array, request.get("crop_box")))
            crop_types.append("serial_number_planned_expanded")
            # Serial placement varies by manufacturer. Keep the persisted crop
            # and add a fixed upper-right pair in the same Vision batch, where
            # modern numbered cards commonly print the current-card serial.
            top_right_index = len(arrays)
            arrays.append(_crop(loaded.array, _TOP_RIGHT_SERIAL_BOX))
            crop_types.append("serial_number_top_right")
            top_right_expanded_index = len(arrays)
            arrays.append(_expanded_crop(loaded.array, _TOP_RIGHT_SERIAL_BOX))
            crop_types.append("serial_number_top_right_expanded")
        result_slots.append((exact_index, expanded_index, top_right_index, top_right_expanded_index))
    if len(arrays) > MAX_SYNC_IMAGES:
        raise ValueError({"errors": [{"path": "requests", "message": "expanded Vision batch exceeds 16 image units"}]})

    batch = run_google_vision_ocr_batch(arrays, crop_types=crop_types, config=config, client=vision_client)
    raw_results = batch.get("results") or []
    output = []
    for request, (exact_index, expanded_index, top_right_index, top_right_expanded_index) in zip(requests, result_slots, strict=False):
        primary = raw_results[exact_index] if exact_index < len(raw_results) else {"status": "UNAVAILABLE", "reason": batch.get("reason")}
        unit_count = 1
        if expanded_index is not None:
            expanded = raw_results[expanded_index] if expanded_index < len(raw_results) else {"status": "UNAVAILABLE"}
            planned_consensus = _serial_consensus(primary, expanded)
            top_right_primary = raw_results[top_right_index] if top_right_index is not None and top_right_index < len(raw_results) else {"status": "UNAVAILABLE"}
            top_right_expanded = raw_results[top_right_expanded_index] if top_right_expanded_index is not None and top_right_expanded_index < len(raw_results) else {"status": "UNAVAILABLE"}
            top_right_consensus = _serial_consensus(top_right_primary, top_right_expanded)
            primary = {**primary, **_merge_serial_region_consensus(planned_consensus, top_right_consensus)}
            unit_count = 4
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
