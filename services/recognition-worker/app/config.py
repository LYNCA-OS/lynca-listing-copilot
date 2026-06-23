from __future__ import annotations

import os
from dataclasses import dataclass


def _int_env(name: str, fallback: int) -> int:
    value = os.getenv(name, "")
    try:
        parsed = int(value)
        return parsed if parsed > 0 else fallback
    except ValueError:
        return fallback


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
    enable_paddleocr: bool
    enable_opencv_rectification: bool
    enable_visual_embeddings: bool
    enable_candidate_verification: bool
    pipeline_version: str = "recognition-worker-contract-v1"


def load_config() -> WorkerConfig:
    return WorkerConfig(
        token=os.getenv("RECOGNITION_WORKER_TOKEN", ""),
        allowed_image_hosts=_csv_env("RECOGNITION_ALLOWED_IMAGE_HOSTS", ["localhost"]),
        max_image_bytes=_int_env("RECOGNITION_MAX_IMAGE_BYTES", 25 * 1024 * 1024),
        max_total_pixels=_int_env("RECOGNITION_MAX_TOTAL_PIXELS", 50_000_000),
        request_timeout_seconds=_int_env("RECOGNITION_REQUEST_TIMEOUT_SECONDS", 30),
        enable_paddleocr=os.getenv("ENABLE_PADDLEOCR", "false").lower() == "true",
        enable_opencv_rectification=os.getenv("ENABLE_OPENCV_RECTIFICATION", "false").lower() == "true",
        enable_visual_embeddings=os.getenv("ENABLE_VISUAL_EMBEDDINGS", "false").lower() == "true",
        enable_candidate_verification=os.getenv("ENABLE_CANDIDATE_VERIFICATION", "false").lower() == "true",
    )
