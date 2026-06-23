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
from .pipelines.card_rectification import rectification_unavailable
from .pipelines.candidate_verification import candidate_verification_unavailable
from .pipelines.evidence_fusion import fuse_evidence_placeholder
from .pipelines.glare_detection import glare_unavailable
from .pipelines.image_quality import quality_unavailable
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
    rectification = rectification_unavailable(first_image_id)
    glare = glare_unavailable(first_image_id)

    return {
        "asset_id": asset_id,
        "rectification": rectification,
        "image_quality": quality_unavailable(first_image_id),
        "glare_detection": glare,
        "regions": propose_regions_for_rectified_card(requested_fields, rectification.get("rectified_size", [0, 0]), first_image_id),
        "ocr_evidence": ocr_unavailable(),
        "evidence_fusion": fuse_evidence_placeholder(),
        "visual_features": embeddings_unavailable(),
        "candidate_verification": candidate_verification_unavailable(),
        "processing": {
            "pipeline_version": config.pipeline_version,
            "model_versions": {
                "paddleocr": "not_enabled",
                "unlimited_ocr": "not_enabled_experimental",
                "opencv": "not_used_until_safe_image_loader_enabled",
                "r2_numpy_geometry": "available_for_offline_eval",
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
