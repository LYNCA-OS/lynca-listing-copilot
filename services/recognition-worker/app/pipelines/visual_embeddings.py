from __future__ import annotations

import os
import logging
import time
from types import SimpleNamespace
from typing import Any

import numpy as np
from PIL import Image
from app.config import DEFAULT_VISUAL_EMBEDDING_REVISION


class VisualEmbeddingBackendUnavailable(RuntimeError):
    pass


_BACKEND: dict[str, Any] = {}


def _model_metadata(config: Any | None = None) -> dict:
    return {
        "primary": {
            "model_id": getattr(config, "visual_embedding_model_id", "google/siglip2-base-patch16-384"),
            "model_revision": getattr(config, "visual_embedding_model_revision", DEFAULT_VISUAL_EMBEDDING_REVISION),
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


def _device_for_torch(torch_module: Any) -> str:
    configured = os.getenv("VISUAL_EMBEDDING_DEVICE", "").strip().lower()
    if configured:
        return configured
    if torch_module.cuda.is_available():
        return "cuda"
    if hasattr(torch_module.backends, "mps") and torch_module.backends.mps.is_available():
        return "mps"
    return "cpu"


def _image_from_array(array: np.ndarray) -> Image.Image:
    if not isinstance(array, np.ndarray) or array.size == 0:
        raise ValueError("image array is empty")
    if array.dtype != np.uint8:
        array = np.clip(array, 0, 255).astype(np.uint8)
    return Image.fromarray(array, mode="RGB")


def _l2_normalize(vector: np.ndarray) -> list[float]:
    values = vector.astype(np.float32).reshape(-1)
    norm = float(np.linalg.norm(values))
    if not np.isfinite(norm) or norm <= 0:
        raise ValueError("embedding vector has invalid norm")
    return (values / norm).astype(np.float32).tolist()


def _pooled_image_embeddings(model_output: Any, model: Any) -> Any:
    if hasattr(model_output, "image_embeds") and model_output.image_embeds is not None:
        return model_output.image_embeds
    if hasattr(model_output, "pooler_output") and model_output.pooler_output is not None:
        return model_output.pooler_output
    if isinstance(model_output, dict):
        if model_output.get("image_embeds") is not None:
            return model_output["image_embeds"]
        if model_output.get("pooler_output") is not None:
            return model_output["pooler_output"]
    if hasattr(model, "get_image_features"):
        return None
    raise VisualEmbeddingBackendUnavailable("visual_embedding_model_output_missing")


def _load_siglip_backend(config: Any) -> dict[str, Any]:
    model_id = getattr(config, "visual_embedding_model_id", "google/siglip2-base-patch16-384")
    revision = getattr(config, "visual_embedding_model_revision", DEFAULT_VISUAL_EMBEDDING_REVISION)
    cache_key = f"{model_id}@{revision}"
    if cache_key in _BACKEND:
        return _BACKEND[cache_key]

    try:
        import torch
        from transformers import AutoModel, AutoProcessor
    except Exception as error:  # pragma: no cover - exercised in lean local environments.
        raise VisualEmbeddingBackendUnavailable("embedding_backend_not_installed") from error

    device = _device_for_torch(torch)
    dtype = torch.float16 if device == "cuda" else torch.float32
    processor = AutoProcessor.from_pretrained(model_id, revision=revision)
    model = AutoModel.from_pretrained(model_id, revision=revision, torch_dtype=dtype)
    model.to(device)
    model.eval()

    _BACKEND[cache_key] = {
        "torch": torch,
        "processor": processor,
        "model": model,
        "device": device,
        "model_id": model_id,
        "model_revision": revision,
    }
    return _BACKEND[cache_key]


def embed_images_with_siglip(image_loads: list[Any], config: Any) -> list[list[float]]:
    backend = _load_siglip_backend(config)
    torch = backend["torch"]
    processor = backend["processor"]
    model = backend["model"]
    device = backend["device"]
    images = [_image_from_array(getattr(image_load, "array", None)) for image_load in image_loads]

    inputs = processor(images=images, return_tensors="pt")
    inputs = {key: value.to(device) for key, value in inputs.items()}
    with torch.inference_mode():
        if hasattr(model, "get_image_features"):
            pooled = model.get_image_features(**inputs)
        else:
            output = model(**inputs)
            pooled = _pooled_image_embeddings(output, model)
            if pooled is None:
                pooled = model.get_image_features(**inputs)
    vectors = pooled.detach().float().cpu().numpy()
    return [_l2_normalize(vector) for vector in vectors]


def preload_visual_embedding_backend(config: Any) -> dict[str, Any]:
    """Load the pinned model and run one inference before serving traffic."""
    if not getattr(config, "enable_visual_embeddings", False):
        return {"status": "DISABLED", "reason": "visual_embeddings_disabled"}

    started = time.time()
    try:
        probe = SimpleNamespace(
            array=np.zeros((384, 384, 3), dtype=np.uint8),
            image_id="startup_probe",
            role="front_global",
        )
        vectors = embed_images_with_siglip([probe], config)
        dimensions = int(getattr(config, "visual_embedding_dimensions", 768))
        if len(vectors) != 1 or len(vectors[0]) != dimensions:
            raise VisualEmbeddingBackendUnavailable("visual_embedding_preload_dimension_mismatch")
        return {
            "status": "READY",
            "model_id": getattr(config, "visual_embedding_model_id", ""),
            "model_revision": getattr(config, "visual_embedding_model_revision", ""),
            "latency_ms": int((time.time() - started) * 1000),
        }
    except Exception as error:  # pragma: no cover - depends on runtime model files.
        logging.exception("visual embedding preload failed: %s", type(error).__name__)
        return {
            "status": "FAILED",
            "reason": f"visual_embedding_preload_error:{type(error).__name__}",
            "latency_ms": int((time.time() - started) * 1000),
        }


def extract_visual_embeddings(image_loads: list[Any], config: Any, embedder: Any | None = None) -> dict:
    if not getattr(config, "enable_visual_embeddings", False):
        return embeddings_unavailable("visual_embeddings_disabled", config)

    if not image_loads:
        return {
            "status": "UNAVAILABLE",
            "reason": "image_bytes_not_loaded",
            "models": _model_metadata(config),
            "features": [],
        }

    embedding_fn = embedder or embed_images_with_siglip
    try:
        embeddings = embedding_fn(image_loads, config)
    except VisualEmbeddingBackendUnavailable as error:
        return _features_unavailable_for_images(image_loads, config, str(error) or "embedding_backend_unavailable")
    except Exception as error:
        logging.exception("visual embedding generation failed: %s", type(error).__name__)
        return _features_unavailable_for_images(image_loads, config, f"embedding_generation_error:{type(error).__name__}")

    features = []
    expected_dimensions = int(getattr(config, "visual_embedding_dimensions", 768))
    if len(embeddings) != len(image_loads):
        return _features_unavailable_for_images(image_loads, config, "embedding_count_mismatch")
    for image_load, embedding in zip(image_loads, embeddings, strict=False):
        if not isinstance(embedding, list) or len(embedding) != expected_dimensions:
            return _features_unavailable_for_images(image_loads, config, "embedding_dimensions_mismatch")
        if not all(np.isfinite(float(value)) for value in embedding):
            return _features_unavailable_for_images(image_loads, config, "embedding_non_finite")
        features.append({
            "image_id": getattr(image_load, "image_id", ""),
            "role": getattr(image_load, "role", ""),
            "embedding_role": embedding_role_for_image_role(getattr(image_load, "role", "")),
            "model_id": getattr(config, "visual_embedding_model_id", "google/siglip2-base-patch16-384"),
            "model_revision": getattr(config, "visual_embedding_model_revision", DEFAULT_VISUAL_EMBEDDING_REVISION),
            "preprocessing_version": getattr(config, "visual_embedding_preprocessing_version", "card-rectification-v1"),
            "dimensions": expected_dimensions,
            "status": "OK",
            "embedding": embedding,
        })

    return {
        "status": "OK",
        "models": _model_metadata(config),
        "features": features,
    }


def _features_unavailable_for_images(image_loads: list[Any], config: Any, reason: str) -> dict:
    return {
        "status": "UNAVAILABLE",
        "reason": reason,
        "models": _model_metadata(config),
        "features": [
            {
                "image_id": getattr(image_load, "image_id", ""),
                "role": getattr(image_load, "role", ""),
                "embedding_role": embedding_role_for_image_role(getattr(image_load, "role", "")),
                "model_id": getattr(config, "visual_embedding_model_id", "google/siglip2-base-patch16-384"),
                "model_revision": getattr(config, "visual_embedding_model_revision", DEFAULT_VISUAL_EMBEDDING_REVISION),
                "preprocessing_version": getattr(config, "visual_embedding_preprocessing_version", "card-rectification-v1"),
                "dimensions": getattr(config, "visual_embedding_dimensions", 768),
                "status": "UNAVAILABLE",
                "reason": reason,
            }
            for image_load in image_loads
        ],
    }
