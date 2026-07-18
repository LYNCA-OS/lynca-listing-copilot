from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_VISUAL_EMBEDDING_REVISION = "f775b65a79762255128c981547af89addcfe0f88"


def _int_env(name: str, fallback: int) -> int:
    value = os.getenv(name, "")
    try:
        parsed = int(value)
        return parsed if parsed > 0 else fallback
    except ValueError:
        return fallback


def _bounded_int_env(name: str, fallback: int, maximum: int) -> int:
    return min(_int_env(name, fallback), maximum)


def _immutable_revision_env(name: str, fallback: str) -> str:
    value = os.getenv(name, "").strip()
    if not value or value.lower() == "main":
        return fallback
    return value


def _csv_env(name: str, fallback: list[str]) -> list[str]:
    value = os.getenv(name, "")
    if not value:
        return fallback
    return [part.strip().lower() for part in value.split(",") if part.strip()]


@dataclass(frozen=True)
class WorkerConfig:
    token: str
    allowed_image_hosts: list[str]
    max_image_bytes: int
    max_total_pixels: int
    request_timeout_seconds: int
    enable_image_download: bool
    enable_paddleocr: bool
    paddleocr_preload: bool
    paddleocr_model_id: str
    paddleocr_model_revision: str
    enable_tesseract_ocr: bool
    enable_opencv_rectification: bool
    enable_visual_embeddings: bool
    visual_embedding_preload: bool
    visual_embedding_model_id: str
    visual_embedding_model_revision: str
    visual_embedding_preprocessing_version: str
    visual_embedding_dimensions: int
    enable_candidate_verification: bool
    tesseract_language: str
    tesseract_psm: int
    tesseract_timeout_seconds: int
    tesseract_image_concurrency: int = 2
    pipeline_version: str = "recognition-worker-contract-v1"


def load_config() -> WorkerConfig:
    return WorkerConfig(
        token=os.getenv("RECOGNITION_WORKER_TOKEN", ""),
        allowed_image_hosts=_csv_env("RECOGNITION_ALLOWED_IMAGE_HOSTS", ["localhost"]),
        max_image_bytes=_bounded_int_env("RECOGNITION_MAX_IMAGE_BYTES", 25 * 1024 * 1024, 100 * 1024 * 1024),
        max_total_pixels=_bounded_int_env("RECOGNITION_MAX_TOTAL_PIXELS", 50_000_000, 100_000_000),
        request_timeout_seconds=_int_env("RECOGNITION_REQUEST_TIMEOUT_SECONDS", 30),
        enable_image_download=os.getenv("ENABLE_IMAGE_DOWNLOAD", "false").lower() == "true",
        enable_paddleocr=os.getenv("ENABLE_PADDLEOCR", "false").lower() == "true",
        paddleocr_preload=os.getenv("PADDLEOCR_PRELOAD", "false").lower() == "true",
        paddleocr_model_id=os.getenv("PADDLEOCR_MODEL_ID", os.getenv("PADDLE_OCR_MODEL_ID", "paddleocr")) or "paddleocr",
        paddleocr_model_revision=os.getenv("PADDLEOCR_MODEL_REVISION", os.getenv("PADDLE_OCR_MODEL_REVISION", "")) or "",
        enable_tesseract_ocr=os.getenv("ENABLE_TESSERACT_OCR", "false").lower() == "true",
        enable_opencv_rectification=os.getenv("ENABLE_OPENCV_RECTIFICATION", "false").lower() == "true",
        enable_visual_embeddings=os.getenv("ENABLE_VISUAL_EMBEDDINGS", "false").lower() == "true",
        visual_embedding_preload=os.getenv("VISUAL_EMBEDDING_PRELOAD", "false").lower() == "true",
        visual_embedding_model_id=os.getenv("VISUAL_EMBEDDING_MODEL_ID", "google/siglip2-base-patch16-384") or "google/siglip2-base-patch16-384",
        visual_embedding_model_revision=_immutable_revision_env(
            "VISUAL_EMBEDDING_MODEL_REVISION",
            DEFAULT_VISUAL_EMBEDDING_REVISION,
        ),
        visual_embedding_preprocessing_version=os.getenv("VISUAL_EMBEDDING_PREPROCESSING_VERSION", "card-rectification-v1") or "card-rectification-v1",
        visual_embedding_dimensions=_int_env("VISUAL_EMBEDDING_DIMENSIONS", 768),
        enable_candidate_verification=os.getenv("ENABLE_CANDIDATE_VERIFICATION", "false").lower() == "true",
        tesseract_language=os.getenv("TESSERACT_LANGUAGE", "eng") or "eng",
        tesseract_psm=_int_env("TESSERACT_PSM", 11),
        tesseract_timeout_seconds=_int_env("TESSERACT_TIMEOUT_SECONDS", 20),
        tesseract_image_concurrency=_bounded_int_env("TESSERACT_IMAGE_CONCURRENCY", 2, 2),
    )
