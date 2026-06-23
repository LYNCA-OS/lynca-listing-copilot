from __future__ import annotations

import time
from typing import Any

try:
    from fastapi import FastAPI, Header, HTTPException
except ImportError:  # pragma: no cover - local unit tests do not require FastAPI.
    FastAPI = None
    Header = None
    HTTPException = Exception

from .config import load_config
from .contracts import response_for_unavailable, validate_request
from .pipelines.card_rectification import rectification_unavailable, rectify_card_from_array
from .pipelines.candidate_verification import candidate_verification_unavailable
from .pipelines.evidence_fusion import fuse_ocr_evidence
from .pipelines.glare_detection import detect_glare_from_array, glare_unavailable
from .pipelines.image_loader import ImageLoadError, load_signed_image
from .pipelines.image_quality import measure_image_quality_from_array, quality_unavailable
from .pipelines.ocr_pipeline import ocr_unavailable
from .pipelines.region_proposal import propose_regions_for_rectified_card
from .pipelines.visual_embeddings import embeddings_unavailable
from .security import SecurityError, UrlPolicy, validate_image_url, verify_bearer_token


def analyze_payload(payload: dict[str, Any], authorization: str | None = None) -> dict[str, Any]:
    config = load_config()
    verify_bearer_token(authorization, config.token)
    errors = validate_request(payload)
    if errors:
        raise ValueError({"errors": errors})

    for image in payload.get("images", []):
        validate_image_url(image.get("signed_url", ""), UrlPolicy(config.allowed_image_hosts))

    started = time.time()
    asset_id = payload["asset_id"]
    requested_fields = payload.get("requested_fields") or []
    first_image_id = payload["images"][0]["image_id"]
    image_load = None
    image_load_error = None
    if config.enable_image_download:
        try:
            image_load = load_signed_image(
                payload["images"][0],
                allowed_hosts=config.allowed_image_hosts,
                max_bytes=config.max_image_bytes,
                max_total_pixels=config.max_total_pixels,
                timeout_seconds=config.request_timeout_seconds,
            )
        except (ImageLoadError, SecurityError) as error:
            image_load_error = str(error)

    if image_load:
        rectification = rectify_card_from_array(
            image_load.array,
            image_id=first_image_id,
            prefer_opencv=config.enable_opencv_rectification,
        )
        glare = detect_glare_from_array(image_load.array, image_id=first_image_id)
        quality = measure_image_quality_from_array(
            image_load.array,
            image_id=first_image_id,
            rectification=rectification,
            glare=glare,
        )
    else:
        reason = image_load_error or ("image_download_disabled" if not config.enable_image_download else "image_bytes_not_loaded")
        rectification = rectification_unavailable(first_image_id, reason)
        glare = glare_unavailable(first_image_id, reason)
        quality = quality_unavailable(first_image_id, reason)

    ocr_evidence = ocr_unavailable()
    evidence_fusion = fuse_ocr_evidence(ocr_evidence, requested_fields)

    return {
        "asset_id": asset_id,
        "rectification": rectification,
        "image_quality": quality,
        "glare_detection": glare,
        "regions": propose_regions_for_rectified_card(requested_fields, rectification.get("rectified_size", [0, 0]), first_image_id),
        "ocr_evidence": ocr_evidence,
        "evidence_fusion": evidence_fusion,
        "visual_features": embeddings_unavailable(),
        "candidate_verification": candidate_verification_unavailable(),
        "processing": {
            "pipeline_version": config.pipeline_version,
            "model_versions": {
                "paddleocr": "not_enabled",
                "unlimited_ocr": "not_enabled_experimental",
                "opencv": "enabled" if config.enable_opencv_rectification else "disabled",
                "r2_numpy_geometry": "available_for_offline_eval",
            },
            "image_download": image_load.metadata() if image_load else {
                "status": "UNAVAILABLE",
                "reason": image_load_error or ("image_download_disabled" if not config.enable_image_download else "image_bytes_not_loaded"),
            },
            "latency_ms": int((time.time() - started) * 1000),
        },
    }


if FastAPI is not None:
    app = FastAPI(title="LYNCA Recognition Worker", version="0.1.0")

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz() -> dict[str, Any]:
        config = load_config()
        return {
            "status": "ready" if config.token else "not_ready",
            "pipeline_version": config.pipeline_version,
            "paddleocr_enabled": config.enable_paddleocr,
            "opencv_rectification_enabled": config.enable_opencv_rectification,
            "visual_embeddings_enabled": config.enable_visual_embeddings,
            "candidate_verification_enabled": config.enable_candidate_verification,
            "image_download_enabled": config.enable_image_download,
        }

    @app.post("/v1/analyze-card-images")
    def analyze_card_images(payload: dict[str, Any], authorization: str | None = Header(default=None)) -> dict[str, Any]:
        try:
            return analyze_payload(payload, authorization=authorization)
        except SecurityError as error:
            raise HTTPException(status_code=403, detail=str(error))
        except ValueError as error:
            raise HTTPException(status_code=422, detail=error.args[0])
else:
    app = None


def unavailable(asset_id: str, reason: str) -> dict[str, Any]:
    return response_for_unavailable(asset_id, reason, load_config().pipeline_version)
