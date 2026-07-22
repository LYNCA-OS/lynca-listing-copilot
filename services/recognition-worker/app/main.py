from __future__ import annotations

import hashlib
import re
import time
from typing import Any

try:
    from fastapi import FastAPI, Header, HTTPException
except ImportError:  # pragma: no cover - local unit tests do not require FastAPI.
    FastAPI = None
    Header = None
    HTTPException = Exception

from .config import load_config
from .contracts import response_for_unavailable, validate_embed_request, validate_ocr_field_request, validate_request
from .pipelines.card_rectification import rectification_unavailable, rectify_card_from_array
from .pipelines.candidate_verification import candidate_verification_unavailable
from .pipelines.evidence_fusion import fuse_ocr_evidence
from .pipelines.field_parsers import parse_grade
from .pipelines.glare_detection import detect_glare_from_array, glare_unavailable
from .pipelines.image_loader import ImageLoadError, load_signed_image
from .pipelines.image_quality import measure_image_quality_from_array, quality_unavailable
from .pipelines.multi_card_detection import detect_multi_card_from_loaded_images, multi_card_detection_unavailable
from .pipelines.ocr_pipeline import (
    copyright_year_evidence_from_confirmed_grid,
    ocr_evidence_from_loaded_images,
    ocr_field_from_loaded_image,
    ocr_unavailable,
    preload_paddleocr_engine,
)
from .pipelines.region_proposal import propose_regions_for_rectified_card
from .pipelines.visual_embeddings import extract_visual_embeddings, preload_visual_embedding_backend
from .security import SecurityError, UrlPolicy, validate_image_url, verify_bearer_token

_EMBEDDING_CACHE: dict[str, list[float]] = {}
_PADDLEOCR_PRELOAD_STATUS: dict[str, Any] = {"status": "NOT_RUN"}
_VISUAL_EMBEDDING_PRELOAD_STATUS: dict[str, Any] = {"status": "NOT_RUN"}

_SERIAL_TEXT_PATTERN = re.compile(r"(?:\b\d{1,5}\s*/\s*\d{1,5}\b|\b1\s*/\s*1\b)")
_GRADE_COMPANY_PATTERN = re.compile(r"\b(?:PSA(?:\s*/\s*DNA)?|BGS|BECKETT|CGC|CSG|SGC|TAG)\b", re.IGNORECASE)


def _ocr_response_text(response: dict[str, Any]) -> str:
    values = [str(response.get("raw_text") or "")]
    values.extend(
        str(candidate.get("text") or candidate.get("value") or "")
        for candidate in response.get("text_candidates", [])
        if isinstance(candidate, dict)
    )
    return "\n".join(value.strip() for value in values if value.strip())


def _trusted_ocr_response_text(response: dict[str, Any], minimum_confidence: float = 0.55) -> str:
    trusted = [
        str(candidate.get("text") or candidate.get("value") or "").strip()
        for candidate in response.get("text_candidates", [])
        if isinstance(candidate, dict)
        and float(candidate.get("confidence") or 0) >= minimum_confidence
        and str(candidate.get("text") or candidate.get("value") or "").strip()
    ]
    return "\n".join(trusted) if trusted else str(response.get("raw_text") or "").strip()


def _ocr_grade_components(response: dict[str, Any]) -> tuple[bool, bool]:
    parsed = parse_grade(_trusted_ocr_response_text(response))
    return bool(parsed.get("grade_company")), bool(parsed.get("card_grade") or parsed.get("auto_grade"))


def _ocr_response_has_target(response: dict[str, Any], crop_type: str) -> bool:
    text = _ocr_response_text(response)
    normalized_crop_type = str(crop_type or "").strip().lower()
    if normalized_crop_type in {"serial_number", "serial_crop"}:
        return bool(_SERIAL_TEXT_PATTERN.search(text))
    if normalized_crop_type in {"grade_label", "grade_label_crop"}:
        has_company, has_score = _ocr_grade_components(response)
        return has_company and has_score
    return bool(text)


def _grade_component_crop_box(crop_box: dict[str, Any], component: str) -> dict[str, Any] | None:
    if not isinstance(crop_box, dict):
        return None
    try:
        x = float(crop_box.get("x", crop_box.get("left", 0)))
        y = float(crop_box.get("y", crop_box.get("top", 0)))
        width = float(crop_box.get("width", crop_box.get("w", 0)))
        height = float(crop_box.get("height", crop_box.get("h", 0)))
    except (TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    if component == "company":
        return {"x": x, "y": y, "width": width * 0.70, "height": height}
    if component == "score":
        return {"x": x + width * 0.52, "y": y, "width": width * 0.48, "height": height}
    return None


def _merge_inline_ocr_results(
    primary: dict[str, Any],
    fallback: dict[str, Any],
    *,
    request_id: str,
    crop_type: str,
    total_latency_ms: int,
) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for response in (primary, fallback):
        for candidate in response.get("text_candidates", []):
            if not isinstance(candidate, dict):
                continue
            key = "|".join([
                str(candidate.get("text") or candidate.get("value") or "").strip().upper(),
                repr(candidate.get("box") or candidate.get("bbox") or ""),
            ])
            if not key.strip("|") or key in seen:
                continue
            seen.add(key)
            candidates.append(candidate)

    raw_parts: list[str] = []
    for response in (primary, fallback):
        raw = str(response.get("raw_text") or "").strip()
        if raw and raw not in raw_parts:
            raw_parts.append(raw)

    confidence = max(float(primary.get("confidence") or 0), float(fallback.get("confidence") or 0))
    output = {
        **primary,
        "request_id": request_id,
        "crop_type": crop_type,
        "status": "OK" if candidates else (
            "UNAVAILABLE"
            if primary.get("status") == "UNAVAILABLE" and fallback.get("status") == "UNAVAILABLE"
            else "NO_TEXT"
        ),
        "raw_text": "\n".join(raw_parts),
        "text_candidates": candidates,
        "boxes": [
            {
                "text": candidate.get("text"),
                "confidence": candidate.get("confidence"),
                "box": candidate.get("box"),
            }
            for candidate in candidates
            if candidate.get("box") is not None
        ],
        "confidence": round(confidence, 4),
        "latency_ms": total_latency_ms,
        "primary_ocr_latency_ms": primary.get("latency_ms"),
        "fallback_ocr_latency_ms": fallback.get("latency_ms"),
        "inline_full_image_fallback_evaluated": True,
        "inline_full_image_fallback_used": True,
        "inline_full_image_fallback_target_found": _ocr_response_has_target(fallback, crop_type),
        "inline_full_image_fallback_status": fallback.get("status"),
    }
    if output["status"] != "UNAVAILABLE":
        output.pop("reason", None)
    return output


def _image_cache_hash(image: dict[str, Any], loaded: Any) -> str:
    explicit = str(image.get("content_sha256") or image.get("content_hash") or "").strip().lower()
    if explicit:
        return explicit
    array = getattr(loaded, "array", None)
    if array is None:
        return hashlib.sha256(str(getattr(loaded, "image_id", "")).encode("utf-8")).hexdigest()
    return hashlib.sha256(array.tobytes()).hexdigest()


def _embedding_cache_key(hash_value: str, role: str, config: Any) -> str:
    return "|".join([
        hash_value,
        str(getattr(config, "visual_embedding_model_id", "")),
        str(getattr(config, "visual_embedding_model_revision", "")),
        str(getattr(config, "visual_embedding_preprocessing_version", "")),
        str(role or ""),
    ])


def _embedding_response_unavailable(payload: dict[str, Any], config: Any, reason: str, started: float, errors: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "request_id": str(payload.get("request_id") or ""),
        "status": "unavailable",
        "reason": reason,
        "embeddings": [],
        "model_id": config.visual_embedding_model_id,
        "model_revision": config.visual_embedding_model_revision,
        "preprocessing_version": config.visual_embedding_preprocessing_version,
        "embedding_dimensions": config.visual_embedding_dimensions,
        "latency_ms": int((time.time() - started) * 1000),
        **({"errors": errors} if errors else {}),
    }


def embed_images_payload(payload: dict[str, Any], authorization: str | None = None) -> dict[str, Any]:
    started = time.time()
    config = load_config()
    verify_bearer_token(authorization, config.token)
    errors = validate_embed_request(payload, config)
    if errors:
        raise ValueError({"errors": errors})

    for image in payload.get("images", []):
        validate_image_url(image.get("signed_url", ""), UrlPolicy(config.allowed_image_hosts))

    if not config.enable_image_download:
        return _embedding_response_unavailable(payload, config, "image_download_disabled", started)
    if not config.enable_visual_embeddings:
        return _embedding_response_unavailable(payload, config, "visual_embeddings_disabled", started)

    image_loads = []
    image_load_errors = []
    for image in payload["images"]:
        try:
            image_loads.append(load_signed_image(
                image,
                allowed_hosts=config.allowed_image_hosts,
                max_bytes=config.max_image_bytes,
                max_total_pixels=config.max_total_pixels,
                timeout_seconds=config.request_timeout_seconds,
            ))
        except (ImageLoadError, SecurityError) as error:
            image_load_errors.append({
                "image_id": image.get("image_id"),
                "role": image.get("role"),
                "reason": str(error),
            })

    if image_load_errors or len(image_loads) != len(payload["images"]):
        return _embedding_response_unavailable(payload, config, "image_bytes_not_loaded", started, image_load_errors)

    cached_features: dict[str, dict[str, Any]] = {}
    missing_images: list[dict[str, Any]] = []
    missing_loads = []
    cache_metadata: dict[str, dict[str, Any]] = {}
    for image, loaded in zip(payload["images"], image_loads, strict=False):
        hash_value = _image_cache_hash(image, loaded)
        key = _embedding_cache_key(hash_value, image.get("role"), config)
        cache_metadata[getattr(loaded, "image_id", "")] = {
            "key": key,
            "content_sha256": hash_value,
        }
        cached = _EMBEDDING_CACHE.get(key)
        if cached:
            cached_features[getattr(loaded, "image_id", "")] = {
                "image_id": getattr(loaded, "image_id", ""),
                "role": image.get("role"),
                "embedding": cached,
                "dimensions": len(cached),
                "normalized": True,
                "cache_hit": True,
                "content_sha256": hash_value,
            }
        else:
            missing_images.append(image)
            missing_loads.append(loaded)

    generated_features: dict[str, dict[str, Any]] = {}
    if missing_loads:
        extracted = extract_visual_embeddings(missing_loads, config)
        if extracted.get("status") != "OK":
            return _embedding_response_unavailable(
                payload,
                config,
                extracted.get("reason") or "embedding_generation_unavailable",
                started,
            )
        for image, feature in zip(missing_images, extracted.get("features", []), strict=False):
            if feature.get("status") != "OK":
                return _embedding_response_unavailable(
                    payload,
                    config,
                    feature.get("reason") or "embedding_generation_unavailable",
                    started,
                )
            embedding = feature.get("embedding") or []
            loaded_id = feature.get("image_id") or image.get("image_id")
            metadata = cache_metadata.get(loaded_id, {})
            if metadata.get("key"):
                _EMBEDDING_CACHE[metadata["key"]] = embedding
            generated_features[loaded_id] = {
                "image_id": loaded_id,
                "role": image.get("role") or feature.get("embedding_role") or feature.get("role"),
                "embedding": embedding,
                "dimensions": int(feature.get("dimensions") or len(embedding)),
                "normalized": True,
                "cache_hit": False,
                "content_sha256": metadata.get("content_sha256"),
            }

    ordered = []
    for image in payload["images"]:
        image_id = str(image.get("image_id") or "")
        feature = cached_features.get(image_id) or generated_features.get(image_id)
        if feature:
            ordered.append(feature)

    if len(ordered) != len(payload["images"]):
        return _embedding_response_unavailable(payload, config, "embedding_count_mismatch", started)

    return {
        "request_id": str(payload.get("request_id") or ""),
        "status": "completed",
        "embeddings": ordered,
        "model_id": config.visual_embedding_model_id,
        "model_revision": config.visual_embedding_model_revision,
        "preprocessing_version": config.visual_embedding_preprocessing_version,
        "embedding_dimensions": config.visual_embedding_dimensions,
        "latency_ms": int((time.time() - started) * 1000),
    }


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
    image_loads = []
    image_load_errors = []
    if config.enable_image_download:
        for image in payload["images"]:
            try:
                image_loads.append(load_signed_image(
                    image,
                    allowed_hosts=config.allowed_image_hosts,
                    max_bytes=config.max_image_bytes,
                    max_total_pixels=config.max_total_pixels,
                    timeout_seconds=config.request_timeout_seconds,
                ))
            except (ImageLoadError, SecurityError) as error:
                image_load_errors.append({
                    "image_id": image.get("image_id"),
                    "role": image.get("role"),
                    "reason": str(error),
                })

    image_load = image_loads[0] if image_loads else None
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
        reason = (
            image_load_errors[0]["reason"]
            if image_load_errors
            else ("image_download_disabled" if not config.enable_image_download else "image_bytes_not_loaded")
        )
        rectification = rectification_unavailable(first_image_id, reason)
        glare = glare_unavailable(first_image_id, reason)
        quality = quality_unavailable(first_image_id, reason)

    if config.enable_tesseract_ocr and image_loads:
        ocr_evidence = ocr_evidence_from_loaded_images(
            image_loads,
            language=config.tesseract_language,
            psm=config.tesseract_psm,
            timeout_seconds=config.tesseract_timeout_seconds,
            focused_fields=requested_fields,
            image_concurrency=config.tesseract_image_concurrency,
        )
    else:
        ocr_evidence = ocr_unavailable(
            "tesseract_not_run",
            "tesseract_disabled" if not config.enable_tesseract_ocr else "image_bytes_not_loaded",
        )
    multi_card_detection = (
        detect_multi_card_from_loaded_images(image_loads)
        if image_loads
        else multi_card_detection_unavailable(
            image_load_errors[0]["reason"]
            if image_load_errors
            else ("image_download_disabled" if not config.enable_image_download else "image_bytes_not_loaded")
        )
    )
    # The narrow grid copyright pass is independent from broad OCR. It only
    # invokes Tesseract after geometry has confirmed an exact four-card grid,
    # so ordinary cards keep the fast no-OCR path while repeated publisher
    # copyright lines can still correct an unsafe statistics-year guess.
    if image_loads:
        copyright_year = copyright_year_evidence_from_confirmed_grid(
            image_loads,
            multi_card_detection,
            language=config.tesseract_language,
            timeout_seconds=config.tesseract_timeout_seconds,
        )
        if copyright_year is not None:
            ocr_evidence = {
                **ocr_evidence,
                "status": "OK",
                "items": [*(ocr_evidence.get("items") or []), copyright_year],
            }
    evidence_fusion = fuse_ocr_evidence(ocr_evidence, requested_fields)

    return {
        "asset_id": asset_id,
        "rectification": rectification,
        "image_quality": quality,
        "glare_detection": glare,
        "multi_card_detection": multi_card_detection,
        "regions": propose_regions_for_rectified_card(requested_fields, rectification.get("rectified_size", [0, 0]), first_image_id),
        "ocr_evidence": ocr_evidence,
        "evidence_fusion": evidence_fusion,
        "visual_features": extract_visual_embeddings(image_loads, config),
        "candidate_verification": candidate_verification_unavailable(),
        "processing": {
            "pipeline_version": config.pipeline_version,
            "model_versions": {
                "paddleocr": "not_enabled",
                "tesseract": "enabled" if config.enable_tesseract_ocr else "disabled",
                "unlimited_ocr": "not_enabled_experimental",
                "opencv": "enabled" if config.enable_opencv_rectification else "disabled",
                "r2_numpy_geometry": "available_for_offline_eval",
                "multi_card_detector": multi_card_detection.get("algorithm", "unavailable"),
                "visual_embeddings": (
                    config.visual_embedding_model_id
                    if config.enable_visual_embeddings
                    else "disabled"
                ),
            },
            "ocr_scheduler": {
                "image_concurrency": ocr_evidence.get("image_concurrency"),
                "policy": "bounded_per_image",
            },
            "image_download": {
                "status": "OK" if image_loads else "UNAVAILABLE",
                "images": [loaded.metadata() for loaded in image_loads],
                **({"errors": image_load_errors} if image_load_errors else {}),
                **({} if image_loads else {
                    "reason": (
                        image_load_errors[0]["reason"]
                        if image_load_errors
                        else ("image_download_disabled" if not config.enable_image_download else "image_bytes_not_loaded")
                    ),
                }),
            },
            "latency_ms": int((time.time() - started) * 1000),
        },
    }


def ocr_field_payload(payload: dict[str, Any], authorization: str | None = None) -> dict[str, Any]:
    started = time.time()
    config = load_config()
    verify_bearer_token(authorization, config.token)
    errors = validate_ocr_field_request(payload)
    if errors:
        raise ValueError({"errors": errors})

    image_url = str(payload.get("image_url") or "")
    validate_image_url(image_url, UrlPolicy(config.allowed_image_hosts))
    request_id = str(payload.get("request_id") or "")
    crop_type = str(payload.get("crop_type") or "")

    if not config.enable_image_download:
        return {
            "request_id": request_id,
            "crop_type": crop_type,
            "status": "UNAVAILABLE",
            "reason": "image_download_disabled",
            "raw_text": "",
            "text_candidates": [],
            "boxes": [],
            "confidence": 0,
            "latency_ms": int((time.time() - started) * 1000),
            "model_id": config.paddleocr_model_id,
            "model_revision": config.paddleocr_model_revision,
        }
    # Backend can be overridden per request (payload.ocr_backend) so the
    # accuracy/cost A/B/A+B runs need no redeploy; otherwise the configured
    # OCR_BACKEND applies. Only a pure single-backend run whose sole engine is
    # unavailable short-circuits; hybrid proceeds if either lane can answer.
    requested_backend = str(payload.get("ocr_backend") or config.ocr_backend or "paddle").strip().lower()
    if requested_backend not in {"paddle", "deepseek", "google_vision", "hybrid"}:
        requested_backend = "paddle"
    deepseek_available = bool(config.deepseek_ocr_endpoint)
    if requested_backend == "paddle" and not config.enable_paddleocr:
        return {
            "request_id": request_id,
            "crop_type": crop_type,
            "status": "UNAVAILABLE",
            "reason": "paddleocr_disabled",
            "raw_text": "",
            "text_candidates": [],
            "boxes": [],
            "confidence": 0,
            "latency_ms": int((time.time() - started) * 1000),
            "model_id": config.paddleocr_model_id,
            "model_revision": config.paddleocr_model_revision,
            "ocr_backend": requested_backend,
        }
    if requested_backend == "deepseek" and not deepseek_available:
        return {
            "request_id": request_id,
            "crop_type": crop_type,
            "status": "UNAVAILABLE",
            "reason": "deepseek_ocr_endpoint_not_configured",
            "raw_text": "",
            "text_candidates": [],
            "boxes": [],
            "confidence": 0,
            "latency_ms": int((time.time() - started) * 1000),
            "model_id": config.deepseek_ocr_model,
            "model_revision": "",
            "ocr_backend": requested_backend,
        }
    if requested_backend == "google_vision" and not config.vision_api_key:
        return {
            "request_id": request_id,
            "crop_type": crop_type,
            "status": "UNAVAILABLE",
            "reason": "vision_api_key_not_configured",
            "raw_text": "",
            "text_candidates": [],
            "boxes": [],
            "confidence": 0,
            "latency_ms": int((time.time() - started) * 1000),
            "model_id": "google-vision",
            "model_revision": config.vision_feature_type,
            "ocr_backend": requested_backend,
        }

    try:
        loaded = load_signed_image(
            {
                "image_id": payload.get("metadata", {}).get("image_id") or request_id or "ocr_field_image",
                "role": crop_type,
                "signed_url": image_url,
            },
            allowed_hosts=config.allowed_image_hosts,
            max_bytes=config.max_image_bytes,
            max_total_pixels=config.max_total_pixels,
            timeout_seconds=config.request_timeout_seconds,
        )
    except (ImageLoadError, SecurityError) as error:
        return {
            "request_id": request_id,
            "crop_type": crop_type,
            "status": "UNAVAILABLE",
            "reason": str(error)[:240],
            "raw_text": "",
            "text_candidates": [],
            "boxes": [],
            "confidence": 0,
            "latency_ms": int((time.time() - started) * 1000),
            "model_id": config.paddleocr_model_id,
            "model_revision": config.paddleocr_model_revision,
        }

    primary = ocr_field_from_loaded_image(
        loaded,
        crop_type=crop_type,
        crop_box=payload.get("crop_box"),
        request_id=request_id,
        model_id=config.paddleocr_model_id,
        model_revision=config.paddleocr_model_revision,
        ocr_backend=requested_backend,
        config=config,
    )
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    normalized_crop_type = str(crop_type).lower()
    inline_fallback_requested = metadata.get("inline_full_image_fallback") is True
    primary_text = _ocr_response_text(primary)
    grade_component_fallback: dict[str, Any] | None = None
    if (
        inline_fallback_requested
        and payload.get("crop_box") is not None
        and primary.get("status") != "UNAVAILABLE"
        and normalized_crop_type in {"grade_label", "grade_label_crop"}
    ):
        has_company, has_score = _ocr_grade_components(primary)
        missing_component = "company" if has_score and not has_company else "score" if has_company and not has_score else ""
        component_box = _grade_component_crop_box(payload.get("crop_box"), missing_component)
        if component_box is not None:
            component = ocr_field_from_loaded_image(
                loaded,
                crop_type=crop_type,
                crop_box=component_box,
                request_id=f"{request_id}:grade-{missing_component}",
                model_id=config.paddleocr_model_id,
                model_revision=config.paddleocr_model_revision,
                ocr_backend=requested_backend,
                config=config,
            )
            primary = _merge_inline_ocr_results(
                primary,
                component,
                request_id=request_id,
                crop_type=crop_type,
                total_latency_ms=int((time.time() - started) * 1000),
            )
            grade_component_fallback = {
                "inline_grade_component_fallback_used": True,
                "inline_grade_component_fallback_kind": missing_component,
                "inline_grade_component_fallback_target_found": _ocr_response_has_target(primary, crop_type),
                "inline_grade_component_fallback_latency_ms": component.get("latency_ms"),
            }
            primary_text = _ocr_response_text(primary)

    grade_context = (
        metadata.get("grade_source_looks_like_slab") is True
        or bool(_GRADE_COMPANY_PATTERN.search(primary_text))
    )
    should_fallback = (
        inline_fallback_requested
        and payload.get("crop_box") is not None
        and primary.get("status") != "UNAVAILABLE"
        and not _ocr_response_has_target(primary, crop_type)
        and normalized_crop_type in {"grade_label", "grade_label_crop"}
        and grade_context
    )
    if not should_fallback:
        return {
            **primary,
            "latency_ms": int((time.time() - started) * 1000),
            "primary_ocr_latency_ms": primary.get("latency_ms"),
            "inline_full_image_fallback_evaluated": False,
            "inline_full_image_fallback_used": False,
            "inline_full_image_fallback_target_found": False,
            **(grade_component_fallback or {}),
        }

    fallback = ocr_field_from_loaded_image(
        loaded,
        crop_type=crop_type,
        crop_box=None,
        request_id=f"{request_id}:full-image",
        model_id=config.paddleocr_model_id,
        model_revision=config.paddleocr_model_revision,
        ocr_backend=requested_backend,
        config=config,
    )
    merged = _merge_inline_ocr_results(
        primary,
        fallback,
        request_id=request_id,
        crop_type=crop_type,
        total_latency_ms=int((time.time() - started) * 1000),
    )
    return {**merged, **(grade_component_fallback or {})}


if FastAPI is not None:
    app = FastAPI(title="LYNCA Recognition Worker", version="0.1.0")

    @app.on_event("startup")
    def preload_models_on_startup() -> None:
        global _PADDLEOCR_PRELOAD_STATUS, _VISUAL_EMBEDDING_PRELOAD_STATUS
        config = load_config()
        if config.enable_paddleocr and config.paddleocr_preload:
            _PADDLEOCR_PRELOAD_STATUS = preload_paddleocr_engine(
                model_id=config.paddleocr_model_id,
                model_revision=config.paddleocr_model_revision,
            )
        if config.enable_visual_embeddings and config.visual_embedding_preload:
            _VISUAL_EMBEDDING_PRELOAD_STATUS = preload_visual_embedding_backend(config)

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
            "paddleocr_preload_enabled": config.paddleocr_preload,
            "paddleocr_preload_status": _PADDLEOCR_PRELOAD_STATUS,
            "paddleocr_model_id": config.paddleocr_model_id,
            "paddleocr_model_revision": config.paddleocr_model_revision,
            "tesseract_ocr_enabled": config.enable_tesseract_ocr,
            "opencv_rectification_enabled": config.enable_opencv_rectification,
            "visual_embeddings_enabled": config.enable_visual_embeddings,
            "visual_embedding_preload_enabled": config.visual_embedding_preload,
            "visual_embedding_preload_status": _VISUAL_EMBEDDING_PRELOAD_STATUS,
            "candidate_verification_enabled": config.enable_candidate_verification,
            "image_download_enabled": config.enable_image_download,
            "visual_embedding_model_id": config.visual_embedding_model_id,
            "visual_embedding_model_revision": config.visual_embedding_model_revision,
            "visual_embedding_preprocessing_version": config.visual_embedding_preprocessing_version,
            "visual_embedding_dimensions": config.visual_embedding_dimensions,
        }

    @app.post("/v1/analyze-card-images")
    def analyze_card_images(payload: dict[str, Any], authorization: str | None = Header(default=None)) -> dict[str, Any]:
        try:
            return analyze_payload(payload, authorization=authorization)
        except SecurityError as error:
            raise HTTPException(status_code=403, detail=str(error))
        except ValueError as error:
            raise HTTPException(status_code=422, detail=error.args[0])

    @app.post("/v1/embed-images")
    def embed_images(payload: dict[str, Any], authorization: str | None = Header(default=None)) -> dict[str, Any]:
        try:
            return embed_images_payload(payload, authorization=authorization)
        except SecurityError as error:
            raise HTTPException(status_code=403, detail=str(error))
        except ValueError as error:
            raise HTTPException(status_code=422, detail=error.args[0])

    @app.post("/v1/ocr-field")
    def ocr_field(payload: dict[str, Any], authorization: str | None = Header(default=None)) -> dict[str, Any]:
        try:
            return ocr_field_payload(payload, authorization=authorization)
        except SecurityError as error:
            raise HTTPException(status_code=403, detail=str(error))
        except ValueError as error:
            raise HTTPException(status_code=422, detail=error.args[0])
else:
    app = None


def unavailable(asset_id: str, reason: str) -> dict[str, Any]:
    return response_for_unavailable(asset_id, reason, load_config().pipeline_version)
