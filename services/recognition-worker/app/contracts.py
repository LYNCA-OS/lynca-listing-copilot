from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


IMAGE_ROLES = {
    "image_1_original",
    "image_2_original",
    "front_original",
    "back_original",
    "front_global",
    "back_global",
    "front_alternate",
    "back_alternate",
    "serial_crop",
    "subject_crop",
    "checklist_code_crop",
    "collector_number_crop",
    "card_code_crop",
    "grade_label_crop",
    "year_product_crop",
    "card_type_crop",
    "autograph_crop",
    "patch_relic_crop",
    "parallel_crop",
    "surface_view",
    "additional",
}

OCR_FIELD_CROP_TYPES = {
    "serial_number",
    "serial_denominator",
    "collector_number",
    "checklist_code",
    "slab_cert",
    "grade_label",
    "tcg_code",
    "product_text",
    "player_name",
}

EMBED_IMAGE_ROLES = {
    "front_global",
    "back_global",
}


REQUESTED_FIELDS = {
    "subject",
    "subject_name",
    "subject_slot_1",
    "subject_slot_2",
    "subject_slot_3",
    "year_product",
    "serial_number",
    "collector_number",
    "checklist_code",
    "grade_label",
    "back_text",
    "parallel",
    "parallel_surface",
    "card_type",
    "autograph",
    "patch_relic",
    "multi_card",
    "card_count",
}


@dataclass
class ImageInput:
    image_id: str
    role: str
    signed_url: str


@dataclass
class AnalyzeCardImagesRequest:
    asset_id: str
    capture_profile_id: str = ""
    images: list[ImageInput] = field(default_factory=list)
    requested_fields: list[str] = field(default_factory=list)
    options: dict[str, Any] = field(default_factory=dict)


@dataclass
class EmbedImagesRequest:
    request_id: str
    images: list[ImageInput] = field(default_factory=list)
    model_id: str = ""
    model_revision: str = ""
    preprocessing_version: str = ""


def _text(value: Any) -> str:
    return str(value or "").strip()


def validate_request(payload: dict[str, Any]) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if not isinstance(payload, dict):
        return [{"path": "payload", "message": "payload must be an object"}]

    if not _text(payload.get("asset_id")):
        errors.append({"path": "asset_id", "message": "asset_id is required"})

    images = payload.get("images")
    if not isinstance(images, list) or not images:
        errors.append({"path": "images", "message": "at least one image is required"})
    else:
        for index, image in enumerate(images):
            if not isinstance(image, dict):
                errors.append({"path": f"images[{index}]", "message": "image must be an object"})
                continue
            if not _text(image.get("image_id")):
                errors.append({"path": f"images[{index}].image_id", "message": "image_id is required"})
            if image.get("role") not in IMAGE_ROLES:
                errors.append({"path": f"images[{index}].role", "message": "invalid image role"})
            if not _text(image.get("signed_url")):
                errors.append({"path": f"images[{index}].signed_url", "message": "signed_url is required"})

    requested_fields = payload.get("requested_fields", [])
    if not isinstance(requested_fields, list):
        errors.append({"path": "requested_fields", "message": "requested_fields must be a list"})
    else:
        for index, field_name in enumerate(requested_fields):
            if field_name not in REQUESTED_FIELDS:
                errors.append({"path": f"requested_fields[{index}]", "message": "unknown requested field"})

    options = payload.get("options", {})
    if options is not None and not isinstance(options, dict):
        errors.append({"path": "options", "message": "options must be an object"})

    return errors


def validate_embed_request(payload: dict[str, Any], config: Any | None = None) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if not isinstance(payload, dict):
        return [{"path": "payload", "message": "payload must be an object"}]

    if not _text(payload.get("request_id")):
        errors.append({"path": "request_id", "message": "request_id is required"})

    images = payload.get("images")
    if not isinstance(images, list) or not images:
        errors.append({"path": "images", "message": "at least one image is required"})
    elif len(images) > 2:
        errors.append({"path": "images", "message": "at most front/back global images are accepted"})
    else:
        seen_roles: set[str] = set()
        for index, image in enumerate(images):
            if not isinstance(image, dict):
                errors.append({"path": f"images[{index}]", "message": "image must be an object"})
                continue
            role = image.get("role")
            if not _text(image.get("image_id")):
                errors.append({"path": f"images[{index}].image_id", "message": "image_id is required"})
            if role not in EMBED_IMAGE_ROLES:
                errors.append({"path": f"images[{index}].role", "message": "invalid embed image role"})
            elif role in seen_roles:
                errors.append({"path": f"images[{index}].role", "message": "duplicate embed image role"})
            else:
                seen_roles.add(role)
            if not _text(image.get("signed_url")):
                errors.append({"path": f"images[{index}].signed_url", "message": "signed_url is required"})

    if config is not None:
        expected = {
            "model_id": getattr(config, "visual_embedding_model_id", ""),
            "model_revision": getattr(config, "visual_embedding_model_revision", ""),
            "preprocessing_version": getattr(config, "visual_embedding_preprocessing_version", ""),
        }
        for key, expected_value in expected.items():
            requested = _text(payload.get(key))
            if not requested:
                errors.append({"path": key, "message": f"{key} is required"})
            elif requested != _text(expected_value):
                errors.append({"path": key, "message": f"{key} does not match configured embedding pipeline"})

    return errors


def validate_ocr_field_request(payload: dict[str, Any]) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if not isinstance(payload, dict):
        return [{"path": "payload", "message": "payload must be an object"}]

    if not _text(payload.get("request_id")):
        errors.append({"path": "request_id", "message": "request_id is required"})
    if not _text(payload.get("image_url")):
        errors.append({"path": "image_url", "message": "image_url is required"})

    crop_type = _text(payload.get("crop_type"))
    if crop_type not in OCR_FIELD_CROP_TYPES:
        errors.append({"path": "crop_type", "message": "invalid OCR field crop type"})

    crop_box = payload.get("crop_box")
    if crop_box is not None:
        if not isinstance(crop_box, dict) or isinstance(crop_box, list):
            errors.append({"path": "crop_box", "message": "crop_box must be an object"})
        else:
            for key in ("x", "y", "width", "height"):
                try:
                    value = float(crop_box.get(key))
                except (TypeError, ValueError):
                    errors.append({"path": f"crop_box.{key}", "message": "crop_box value must be a number"})
                    continue
                if value < 0:
                    errors.append({"path": f"crop_box.{key}", "message": "crop_box value must be non-negative"})

    metadata = payload.get("metadata", {})
    if metadata is not None and not isinstance(metadata, dict):
        errors.append({"path": "metadata", "message": "metadata must be an object"})

    return errors


def response_for_unavailable(asset_id: str, reason: str, pipeline_version: str) -> dict[str, Any]:
    return {
        "asset_id": asset_id,
        "unavailable": True,
        "reason": reason,
        "rectification": {},
        "image_quality": {},
        "multi_card_detection": {},
        "regions": [],
        "ocr_evidence": {},
        "visual_features": {},
        "processing": {
            "pipeline_version": pipeline_version,
            "model_versions": {},
            "latency_ms": 0,
        },
    }
