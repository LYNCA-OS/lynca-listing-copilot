from __future__ import annotations

from typing import Any


def _model_metadata(config: Any | None = None) -> dict:
    return {
        "primary": {
            "model_id": getattr(config, "visual_embedding_model_id", "google/siglip2-base-patch16-384"),
            "model_revision": getattr(config, "visual_embedding_model_revision", "main"),
            "preprocessing_version": getattr(config, "visual_embedding_preprocessing_version", "card-rectification-v1"),
            "dimensions": getattr(config, "visual_embedding_dimensions", 768),
        }
    }


def embedding_role_for_image_role(role: str) -> str:
    role_text = str(role or "").lower()
    if "back" in role_text:
        return "back_global"
    if "front" in role_text:
        return "front_global"
    if "surface" in role_text:
        return "parallel_surface"
    if "subject" in role_text:
        return "subject_layout"
    return "full_card_global"


def embeddings_unavailable(reason: str = "visual_embeddings_disabled", config: Any | None = None) -> dict:
    return {
        "status": "DISABLED",
        "reason": reason,
        "models": _model_metadata(config),
        "features": [],
    }


def extract_visual_embeddings(image_loads: list[Any], config: Any) -> dict:
    if not getattr(config, "enable_visual_embeddings", False):
        return embeddings_unavailable("visual_embeddings_disabled", config)

    if not image_loads:
        return {
            "status": "UNAVAILABLE",
            "reason": "image_bytes_not_loaded",
            "models": _model_metadata(config),
            "features": [],
        }

    # The production embedding backend is intentionally not bundled into the
    # worker yet. This keeps recognition latency stable while fixing the output
    # contract and model-version metadata for Supabase pgvector ingestion.
    return {
        "status": "UNAVAILABLE",
        "reason": "embedding_backend_not_installed",
        "models": _model_metadata(config),
        "features": [
            {
                "image_id": getattr(image_load, "image_id", ""),
                "role": getattr(image_load, "role", ""),
                "embedding_role": embedding_role_for_image_role(getattr(image_load, "role", "")),
                "model_id": getattr(config, "visual_embedding_model_id", "google/siglip2-base-patch16-384"),
                "model_revision": getattr(config, "visual_embedding_model_revision", "main"),
                "preprocessing_version": getattr(config, "visual_embedding_preprocessing_version", "card-rectification-v1"),
                "dimensions": getattr(config, "visual_embedding_dimensions", 768),
                "status": "UNAVAILABLE",
                "reason": "embedding_backend_not_installed",
            }
            for image_load in image_loads
        ],
    }
