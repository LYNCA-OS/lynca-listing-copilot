from __future__ import annotations

import csv
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from io import StringIO
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

_PADDLEOCR_ENGINE: Any | None = None
_PADDLEOCR_RECOGNITION_ENGINE: Any | None = None
_PADDLEOCR_LOCK = threading.Lock()
PADDLEOCR_FIELD_MAX_SIDE = 960

_SERIAL_TARGET_PATTERN = re.compile(r"(?:\b\d{1,5}\s*/\s*\d{1,5}\b|\b1\s*/\s*1\b)")


FOCUSED_CROP_TEMPLATES = {
    "serial_number": [
        {
            "role": "serial_crop",
            "template": (0.52, 0.60, 0.99, 0.98),
        },
    ],
    "collector_number": [
        {
            "role": "collector_number_crop",
            "template": (0.00, 0.66, 0.50, 0.99),
        },
    ],
    "checklist_code": [
        {
            "role": "checklist_code_crop",
            "template": (0.00, 0.66, 0.62, 0.99),
        },
    ],
    "grade_label": [
        {
            "role": "grade_label_crop",
            "template": (0.03, 0.00, 0.97, 0.24),
        },
    ],
}


def _paddle_hpi_runtime_options() -> dict[str, Any]:
    enable_hpi = os.getenv("PADDLEOCR_ENABLE_HPI", "false").lower() == "true"
    try:
        requested_threads = int(os.getenv("PADDLEOCR_CPU_THREADS", "2") or "2")
    except ValueError:
        requested_threads = 2
    cpu_threads = max(1, min(8, requested_threads))
    return {
        "device": "cpu",
        "enable_hpi": enable_hpi,
        "cpu_threads": cpu_threads,
        "engine_config": {
            "backend": "openvino",
            "backend_config": {"cpu_num_threads": cpu_threads},
        },
    }


def normalize_ocr_item(item: dict, index: int = 0) -> dict:
    text = str(item.get("text") or item.get("observed_text") or item.get("raw_text") or "").strip()
    return {
        "item_id": item.get("item_id") or f"ocr_{index + 1}",
        "image_id": item.get("image_id"),
        "role": item.get("role") or item.get("capture_role"),
        "text": text,
        "observed_text": text,
        "confidence": float(item.get("confidence", item.get("score", 0.5)) or 0.5),
        "bbox": item.get("bbox"),
        "polygon": item.get("polygon"),
        "source_type": item.get("source_type") or "OCR",
    }


def ocr_evidence_from_items(items: list[dict], model_version: str = "external_ocr_adapter") -> dict:
    normalized = [normalize_ocr_item(item, index) for index, item in enumerate(items)]
    normalized = [item for item in normalized if item["observed_text"]]
    return {
        "status": "OK" if normalized else "NO_TEXT",
        "model_version": model_version,
        "items": normalized,
    }


def ocr_unavailable(model_version: str = "paddleocr_not_configured", reason: str = "paddleocr_adapter_not_enabled") -> dict:
    return {
        "status": "UNAVAILABLE",
        "reason": reason,
        "model_version": model_version,
        "items": [],
    }


def _ocr_unavailable(reason: str, model_version: str = "tesseract_unavailable") -> dict:
    return {
        "status": "UNAVAILABLE",
        "reason": reason,
        "model_version": model_version,
        "items": [],
    }


def _confidence(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return None
    return max(0.0, min(1.0, parsed / 100.0))


def _line_key(row: dict[str, str]) -> tuple[str, str, str, str]:
    return (
        row.get("page_num", "1"),
        row.get("block_num", "0"),
        row.get("par_num", "0"),
        row.get("line_num", "0"),
    )


def _parse_tesseract_tsv(
    tsv: str,
    *,
    image_id: str,
    role: str,
    source_type: str = "OCR",
    item_prefix: str = "tesseract",
    bbox_offset: tuple[int, int] = (0, 0),
    coordinate_scale: float = 1.0,
) -> list[dict[str, Any]]:
    reader = csv.DictReader(StringIO(tsv), delimiter="\t")
    lines: dict[tuple[str, str, str, str], dict[str, Any]] = {}

    for row in reader:
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        confidence = _confidence(row.get("conf"))
        if confidence is None:
            continue

        key = _line_key(row)
        left = int((float(row.get("left") or 0) / coordinate_scale) + bbox_offset[0])
        top = int((float(row.get("top") or 0) / coordinate_scale) + bbox_offset[1])
        width = int(float(row.get("width") or 0) / coordinate_scale)
        height = int(float(row.get("height") or 0) / coordinate_scale)
        right = left + width
        bottom = top + height
        line = lines.setdefault(key, {
            "texts": [],
            "confidences": [],
            "left": left,
            "top": top,
            "right": right,
            "bottom": bottom,
        })
        line["texts"].append(text)
        line["confidences"].append(confidence)
        line["left"] = min(line["left"], left)
        line["top"] = min(line["top"], top)
        line["right"] = max(line["right"], right)
        line["bottom"] = max(line["bottom"], bottom)

    items = []
    for index, line in enumerate(lines.values()):
        text = " ".join(line["texts"]).strip()
        if not text:
            continue
        confidence = sum(line["confidences"]) / max(1, len(line["confidences"]))
        items.append({
            "item_id": f"{item_prefix}_{image_id}_{index + 1}",
            "image_id": image_id,
            "role": role,
            "text": text,
            "observed_text": text,
            "confidence": round(confidence, 4),
            "bbox": [
                int(line["left"]),
                int(line["top"]),
                int(line["right"] - line["left"]),
                int(line["bottom"] - line["top"]),
            ],
            "source_type": source_type,
        })

    return items


def _array_to_temp_png(array: np.ndarray, *, upscale: int = 1) -> Path:
    temp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    temp_path = Path(temp.name)
    temp.close()
    image = Image.fromarray(array.astype("uint8"), mode="RGB")
    if upscale > 1:
        image = image.resize((image.width * upscale, image.height * upscale), Image.Resampling.LANCZOS)
    image.save(temp_path, format="PNG")
    return temp_path


def _resize_array_for_paddleocr(array: np.ndarray, max_side: int = PADDLEOCR_FIELD_MAX_SIDE) -> np.ndarray:
    height, width = array.shape[:2]
    longest = max(height, width)
    if longest <= max_side:
        return array
    scale = max_side / float(longest)
    next_width = max(1, int(round(width * scale)))
    next_height = max(1, int(round(height * scale)))
    image = Image.fromarray(array.astype("uint8"), mode="RGB")
    return np.asarray(image.resize((next_width, next_height), Image.Resampling.LANCZOS), dtype=np.uint8)


def _serial_contrast_variant(array: np.ndarray) -> np.ndarray | None:
    """Make low-contrast foil digits readable without inventing glyphs."""
    try:
        import cv2

        gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(6, 6)).apply(gray)
        blurred = cv2.GaussianBlur(clahe, (0, 0), 1.0)
        sharpened = cv2.addWeighted(clahe, 1.7, blurred, -0.7, 0)
        height, width = sharpened.shape[:2]
        longest = max(height, width)
        if longest < PADDLEOCR_FIELD_MAX_SIDE:
            scale = min(3.0, PADDLEOCR_FIELD_MAX_SIDE / max(1.0, float(longest)))
            sharpened = cv2.resize(
                sharpened,
                (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
                interpolation=cv2.INTER_CUBIC,
            )
        return cv2.cvtColor(sharpened, cv2.COLOR_GRAY2RGB)
    except Exception:  # pragma: no cover - plain OCR remains available.
        return None


def _contains_serial_target(candidates: list[dict[str, Any]]) -> bool:
    return any(
        _SERIAL_TARGET_PATTERN.search(str(candidate.get("text") or ""))
        for candidate in candidates
        if isinstance(candidate, dict)
    )


def _dedupe_ocr_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        key = (
            str(candidate.get("text") or "").strip().upper(),
            repr(candidate.get("box") or candidate.get("bbox") or ""),
        )
        if not key[0] or key in seen:
            continue
        seen.add(key)
        output.append(candidate)
    return output


def _run_serial_paddleocr(array: np.ndarray, *, offset: tuple[int, int] = (0, 0)) -> list[dict[str, Any]]:
    candidates = _run_paddleocr(array, offset=offset)
    if _contains_serial_target(candidates):
        return candidates
    height, width = array.shape[:2]
    # A caller-provided serial crop can already be a tight text line. Running
    # the detector again on low-contrast foil often drops the line entirely;
    # recognition-only preserves that explicit region without scanning or
    # guessing elsewhere in the image.
    if width >= max(1, height) * 2:
        try:
            line_candidates = _run_serial_line_recognition(array, offset=offset)
        except Exception:  # noqa: BLE001 - detector evidence remains valid.
            line_candidates = []
        candidates = _dedupe_ocr_candidates([*candidates, *line_candidates])
        if _contains_serial_target(candidates):
            return candidates
    enhanced = _serial_contrast_variant(array)
    if enhanced is None:
        return candidates
    return _dedupe_ocr_candidates([
        *candidates,
        *_run_paddleocr(enhanced, offset=offset),
    ])


def _run_tesseract(image_path: Path, *, language: str, psm: int, timeout_seconds: int) -> str:
    command = [
        "tesseract",
        str(image_path),
        "stdout",
        "--psm",
        str(psm),
        "-l",
        language,
        "tsv",
    ]
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or "tesseract_failed").strip()[:240])
    return completed.stdout


def _source_type_for_loaded_role(role: str) -> str:
    normalized = str(role or "").lower()
    if "back" in normalized:
        return "CARD_BACK"
    if "front" in normalized:
        return "CARD_FRONT"
    return "OCR"


def _crop_array(array: np.ndarray, template: tuple[float, float, float, float]) -> tuple[np.ndarray, tuple[int, int]] | None:
    height, width = array.shape[:2]
    x1f, y1f, x2f, y2f = template
    x1 = max(0, min(width - 1, int(round(width * x1f))))
    y1 = max(0, min(height - 1, int(round(height * y1f))))
    x2 = max(x1 + 1, min(width, int(round(width * x2f))))
    y2 = max(y1 + 1, min(height, int(round(height * y2f))))
    if x2 - x1 < 16 or y2 - y1 < 16:
        return None
    return array[y1:y2, x1:x2], (x1, y1)


def _crop_array_by_box(array: np.ndarray, crop_box: dict[str, Any] | None) -> tuple[np.ndarray, tuple[int, int]]:
    if not isinstance(crop_box, dict):
        return array, (0, 0)
    height, width = array.shape[:2]
    try:
        x = float(crop_box.get("x", crop_box.get("left", 0)))
        y = float(crop_box.get("y", crop_box.get("top", 0)))
        box_width = float(crop_box.get("width", crop_box.get("w", 0)))
        box_height = float(crop_box.get("height", crop_box.get("h", 0)))
    except (TypeError, ValueError):
        return array, (0, 0)
    if box_width <= 0 or box_height <= 0:
        return array, (0, 0)

    if max(abs(x), abs(y), abs(box_width), abs(box_height)) <= 1.0:
        x *= width
        box_width *= width
        y *= height
        box_height *= height

    x1 = max(0, min(width - 1, int(round(x))))
    y1 = max(0, min(height - 1, int(round(y))))
    x2 = max(x1 + 1, min(width, int(round(x + box_width))))
    y2 = max(y1 + 1, min(height, int(round(y + box_height))))
    if x2 - x1 < 8 or y2 - y1 < 8:
        return array, (0, 0)
    return array[y1:y2, x1:x2], (x1, y1)


def _focused_crop_specs(focused_fields: list[str] | None = None) -> list[dict[str, Any]]:
    requested = set(focused_fields or [])
    if not requested:
        return []

    specs: list[dict[str, Any]] = []
    seen: set[tuple[str, tuple[float, float, float, float]]] = set()
    for field in ("serial_number", "collector_number", "checklist_code", "grade_label"):
        if field not in requested:
            continue
        for spec in FOCUSED_CROP_TEMPLATES[field]:
            key = (spec["role"], spec["template"])
            if key in seen:
                continue
            seen.add(key)
            specs.append(spec)
    return specs


def _get_paddleocr_engine() -> Any:
    global _PADDLEOCR_ENGINE
    with _PADDLEOCR_LOCK:
        if _PADDLEOCR_ENGINE is not None:
            return _PADDLEOCR_ENGINE
        try:
            from paddleocr import PaddleOCR
        except Exception as error:  # noqa: BLE001 - surfaced as worker unavailability.
            raise RuntimeError(f"paddleocr_import_failed: {error}") from error

        last_error: Exception | None = None
        detection_model = os.getenv("PADDLEOCR_DETECTION_MODEL_NAME", "PP-OCRv6_medium_det")
        recognition_model = os.getenv("PADDLEOCR_RECOGNITION_MODEL_NAME", "PP-OCRv6_medium_rec")
        base_flags = {
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
            **_paddle_hpi_runtime_options(),
            "text_detection_model_name": detection_model,
            "text_recognition_model_name": recognition_model,
        }
        constructor_kwargs = [
            {"lang": "en", **base_flags},
            base_flags,
        ]
        for kwargs in constructor_kwargs:
            try:
                _PADDLEOCR_ENGINE = PaddleOCR(**kwargs)
                return _PADDLEOCR_ENGINE
            except Exception as error:  # noqa: BLE001 - try API-compatible constructor variants.
                last_error = error
        raise RuntimeError(f"paddleocr_init_failed: {last_error}") from last_error


def _get_paddleocr_recognition_engine() -> Any:
    global _PADDLEOCR_RECOGNITION_ENGINE
    with _PADDLEOCR_LOCK:
        if _PADDLEOCR_RECOGNITION_ENGINE is not None:
            return _PADDLEOCR_RECOGNITION_ENGINE
        try:
            from paddleocr import TextRecognition
        except Exception as error:  # noqa: BLE001 - surfaced as worker unavailability.
            raise RuntimeError(f"paddleocr_recognition_import_failed: {error}") from error

        last_error: Exception | None = None
        recognition_model = os.getenv("PADDLEOCR_RECOGNITION_MODEL_NAME", "PP-OCRv6_medium_rec")
        constructor_kwargs = [{
            "model_name": recognition_model,
            **_paddle_hpi_runtime_options(),
        }]
        for kwargs in constructor_kwargs:
            try:
                _PADDLEOCR_RECOGNITION_ENGINE = TextRecognition(**kwargs)
                return _PADDLEOCR_RECOGNITION_ENGINE
            except Exception as error:  # noqa: BLE001 - try API-compatible variants.
                last_error = error
        raise RuntimeError(f"paddleocr_recognition_init_failed: {last_error}") from last_error


def preload_paddleocr_engine(*, model_id: str = "paddleocr", model_revision: str = "") -> dict[str, Any]:
    started = time.time()
    try:
        _get_paddleocr_engine()
        _get_paddleocr_recognition_engine()
        return {
            "status": "OK",
            "latency_ms": int((time.time() - started) * 1000),
            "model_id": model_id,
            "model_revision": model_revision,
        }
    except Exception as error:  # noqa: BLE001 - startup should report, not crash the process.
        return {
            "status": "UNAVAILABLE",
            "reason": str(error)[:240],
            "latency_ms": int((time.time() - started) * 1000),
            "model_id": model_id,
            "model_revision": model_revision,
        }


def _box_to_bbox(box: Any, offset: tuple[int, int] = (0, 0)) -> Any:
    if box is None:
        return None
    if isinstance(box, np.ndarray):
        box = box.tolist()
    if not isinstance(box, (list, tuple)):
        return box
    if len(box) == 4 and all(isinstance(point, (int, float, np.integer, np.floating)) for point in box):
        x, y, width, height = [float(value) for value in box]
        return [
            int(round(x + offset[0])),
            int(round(y + offset[1])),
            int(round(width)),
            int(round(height)),
        ]
    points = []
    for point in box:
        if isinstance(point, np.ndarray):
            point = point.tolist()
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            try:
                points.append([
                    int(round(float(point[0]) + offset[0])),
                    int(round(float(point[1]) + offset[1])),
                ])
            except (TypeError, ValueError):
                continue
    return points or box


def _confidence_float(value: Any, fallback: float = 0.5) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    if parsed > 1:
        parsed /= 100.0
    return max(0.0, min(1.0, parsed))


def _candidate(text: Any, confidence: Any = 0.5, box: Any = None, offset: tuple[int, int] = (0, 0)) -> dict[str, Any] | None:
    normalized_text = str(text or "").strip()
    if not normalized_text:
        return None
    return {
        "text": normalized_text,
        "confidence": round(_confidence_float(confidence), 4),
        "box": _box_to_bbox(box, offset),
    }


def _collect_paddle_candidates(value: Any, *, offset: tuple[int, int] = (0, 0)) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, np.ndarray):
        value = value.tolist()
    if isinstance(value, dict):
        if isinstance(value.get("res"), dict):
            nested_result = value["res"]
            direct_text = nested_result.get("rec_text")
            if isinstance(direct_text, str):
                item = _candidate(
                    direct_text,
                    nested_result.get("rec_score", 0.5),
                    nested_result.get("box"),
                    offset,
                )
                return [item] if item else []
        texts = value.get("rec_texts") or value.get("texts") or value.get("text")
        scores = value.get("rec_scores") or value.get("scores") or value.get("confidence")
        boxes = value.get("rec_polys") or value.get("dt_polys") or value.get("boxes") or value.get("points")
        if isinstance(texts, str):
            return [_candidate(texts, scores if not isinstance(scores, list) else scores[0] if scores else 0.5, boxes, offset)].copy()
        if isinstance(texts, list):
            out = []
            for index, text in enumerate(texts):
                score = scores[index] if isinstance(scores, list) and index < len(scores) else 0.5
                box = boxes[index] if isinstance(boxes, list) and index < len(boxes) else None
                item = _candidate(text, score, box, offset)
                if item:
                    out.append(item)
            if out:
                return out
        nested = []
        for key in ("res", "result", "results", "data", "ocr"):
            nested.extend(_collect_paddle_candidates(value.get(key), offset=offset))
        return nested
    if isinstance(value, (list, tuple)):
        if len(value) >= 2:
            first, second = value[0], value[1]
            if isinstance(second, (list, tuple)) and second and isinstance(second[0], str):
                item = _candidate(second[0], second[1] if len(second) > 1 else 0.5, first, offset)
                return [item] if item else []
            if isinstance(first, str):
                item = _candidate(first, second if isinstance(second, (int, float, np.integer, np.floating)) else 0.5, None, offset)
                return [item] if item else []
        out = []
        for item in value:
            out.extend(_collect_paddle_candidates(item, offset=offset))
        return out
    return []


def _run_paddleocr(array: np.ndarray, *, offset: tuple[int, int] = (0, 0)) -> list[dict[str, Any]]:
    engine = _get_paddleocr_engine()
    array = _resize_array_for_paddleocr(array)
    last_error: Exception | None = None
    method_names = ["predict", "ocr"]
    for method_name in method_names:
        method = getattr(engine, method_name, None)
        if method is None:
            continue
        call_variants = [
            ((array,), {
                "use_doc_orientation_classify": False,
                "use_doc_unwarping": False,
                "use_textline_orientation": False,
            }),
            ((array,), {"cls": True}),
            ((array,), {}),
        ]
        for args, kwargs in call_variants:
            try:
                # PaddleOCR predictor instances are not treated as thread-safe; serialize
                # field OCR inside a worker process so concurrent callers cannot race
                # model initialization or reuse.
                with _PADDLEOCR_LOCK:
                    raw = method(*args, **kwargs)
                candidates = _collect_paddle_candidates(raw, offset=offset)
                if candidates:
                    return candidates
                return []
            except TypeError as error:
                last_error = error
                continue
            except Exception as error:  # noqa: BLE001
                last_error = error
                break
    raise RuntimeError(f"paddleocr_run_failed: {last_error}") from last_error


def _run_paddle_text_recognition(
    array: np.ndarray,
    *,
    offset: tuple[int, int] = (0, 0),
) -> list[dict[str, Any]]:
    engine = _get_paddleocr_recognition_engine()
    array = _resize_array_for_paddleocr(array)
    try:
        with _PADDLEOCR_LOCK:
            raw = engine.predict(input=array, batch_size=1)
        candidates: list[dict[str, Any]] = []
        for result in raw or []:
            payload = getattr(result, "json", result)
            candidates.extend(_collect_paddle_candidates(payload, offset=offset))
        height, width = array.shape[:2]
        for candidate in candidates:
            if candidate.get("box") is None:
                candidate["box"] = [offset[0], offset[1], width, height]
            candidate["recognition_mode"] = "text_recognition_only"
        return candidates
    except Exception as error:  # noqa: BLE001 - caller retains detector fallback.
        raise RuntimeError(f"paddleocr_recognition_run_failed: {error}") from error


def _run_serial_line_recognition(
    array: np.ndarray,
    *,
    offset: tuple[int, int] = (0, 0),
) -> list[dict[str, Any]]:
    candidates = _run_paddle_text_recognition(array, offset=offset)
    if _contains_serial_target(candidates):
        return candidates
    enhanced = _serial_contrast_variant(array)
    if enhanced is None:
        return candidates
    return _dedupe_ocr_candidates([
        *candidates,
        *_run_paddle_text_recognition(enhanced, offset=offset),
    ])


def _normalize_field_candidates(candidates: list[dict[str, Any]]) -> tuple[str, float]:
    raw_text = " ".join(candidate["text"] for candidate in candidates if candidate.get("text")).strip()
    confidence_values = [float(candidate.get("confidence", 0.0)) for candidate in candidates if candidate.get("text")]
    confidence = sum(confidence_values) / max(1, len(confidence_values))
    return raw_text, round(confidence, 4)


def ocr_field_from_loaded_image(
    loaded_image: Any,
    *,
    crop_type: str,
    crop_box: dict[str, Any] | None = None,
    request_id: str = "",
    model_id: str = "paddleocr",
    model_revision: str = "",
    ocr_backend: str = "paddle",
    config: Any = None,
) -> dict[str, Any]:
    started = time.time()
    image_id = str(getattr(loaded_image, "image_id", "") or "image")
    role = str(getattr(loaded_image, "role", "") or "")
    array = getattr(loaded_image, "array", None)
    if array is None:
        return {
            "request_id": request_id,
            "crop_type": crop_type,
            "status": "UNAVAILABLE",
            "reason": "image_bytes_not_loaded",
            "raw_text": "",
            "text_candidates": [],
            "boxes": [],
            "confidence": 0,
            "latency_ms": int((time.time() - started) * 1000),
            "model_id": model_id,
            "model_revision": model_revision,
        }
    crop_array, offset = _crop_array_by_box(array, crop_box)
    normalized_crop_type = str(crop_type or "").strip().lower()
    backend = str(ocr_backend or "paddle").strip().lower()
    if backend not in {"paddle", "deepseek", "google_vision", "hybrid"}:
        backend = "paddle"

    candidates: list[dict[str, Any]] = []
    backend_telemetry: dict[str, Any] = {}
    paddle_hard_error: str | None = None

    # PaddleOCR lane (skipped for a pure deepseek run, or when Paddle is
    # disabled in a hybrid run so the deepseek lane still answers).
    paddle_enabled = config is None or bool(getattr(config, "enable_paddleocr", True))
    if backend in {"paddle", "hybrid"} and paddle_enabled:
        try:
            paddle_candidates = _run_serial_paddleocr(crop_array, offset=offset) \
                if normalized_crop_type in {"serial_number", "serial_crop"} \
                else _run_paddleocr(crop_array, offset=offset)
        except Exception as error:  # noqa: BLE001
            paddle_candidates = []
            paddle_hard_error = str(error)[:240]
            backend_telemetry["paddle_error"] = paddle_hard_error
        candidates.extend(paddle_candidates)
        backend_telemetry["paddle_candidate_count"] = len(paddle_candidates)

    # DeepSeek-OCR lane (self-hosted vLLM). Never let a backend fault abort the
    # request when the other lane produced text.
    if backend in {"deepseek", "hybrid"}:
        from .deepseek_ocr import run_deepseek_ocr

        deepseek_result = run_deepseek_ocr(crop_array, crop_type=crop_type, config=config)
        deepseek_candidates = deepseek_result.get("candidates", []) or []
        candidates.extend(deepseek_candidates)
        backend_telemetry["deepseek_status"] = deepseek_result.get("status")
        backend_telemetry["deepseek_candidate_count"] = len(deepseek_candidates)
        backend_telemetry["deepseek_latency_ms"] = deepseek_result.get("latency_ms")
        backend_telemetry["deepseek_cost_estimate"] = deepseek_result.get("cost_estimate")
        if deepseek_result.get("reason"):
            backend_telemetry["deepseek_reason"] = deepseek_result.get("reason")
        if deepseek_result.get("usage"):
            backend_telemetry["deepseek_usage"] = deepseek_result.get("usage")

    # Google Cloud Vision lane (API, no GPU). Reads hard keys PaddleOCR misses.
    if backend in {"google_vision", "hybrid"}:
        from .google_vision_ocr import run_google_vision_ocr

        vision_result = run_google_vision_ocr(crop_array, crop_type=crop_type, config=config)
        vision_candidates = vision_result.get("candidates", []) or []
        candidates.extend(vision_candidates)
        backend_telemetry["vision_status"] = vision_result.get("status")
        backend_telemetry["vision_candidate_count"] = len(vision_candidates)
        backend_telemetry["vision_latency_ms"] = vision_result.get("latency_ms")
        backend_telemetry["vision_cost_estimate"] = vision_result.get("cost_estimate")
        if vision_result.get("reason"):
            backend_telemetry["vision_reason"] = vision_result.get("reason")

    # A hard PaddleOCR fault with no candidates from any lane is still an
    # UNAVAILABLE, matching prior behavior; otherwise OK/NO_TEXT by candidates.
    if candidates:
        status = "OK"
    elif paddle_hard_error and backend not in {"deepseek", "google_vision"}:
        status = "UNAVAILABLE"
    else:
        status = "NO_TEXT"

    raw_text, confidence = _normalize_field_candidates(candidates)
    result = {
        "request_id": request_id,
        "crop_type": crop_type,
        "status": status,
        "raw_text": raw_text,
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
        "confidence": confidence,
        "latency_ms": int((time.time() - started) * 1000),
        "model_id": model_id,
        "model_revision": model_revision,
        "image_id": image_id,
        "image_role": role,
        "ocr_backend": backend,
        "backend_telemetry": backend_telemetry,
    }
    if status == "UNAVAILABLE" and paddle_hard_error:
        result["reason"] = paddle_hard_error
    return result


def _ocr_array_with_tesseract(
    array: np.ndarray,
    *,
    image_id: str,
    role: str,
    source_type: str,
    language: str,
    psm: int,
    timeout_seconds: int,
    item_prefix: str,
    bbox_offset: tuple[int, int] = (0, 0),
    coordinate_scale: float = 1.0,
    upscale: int = 1,
) -> list[dict[str, Any]]:
    temp_path: Path | None = None
    try:
        temp_path = _array_to_temp_png(array, upscale=upscale)
        tsv = _run_tesseract(
            temp_path,
            language=language,
            psm=psm,
            timeout_seconds=timeout_seconds,
        )
        return _parse_tesseract_tsv(
            tsv,
            image_id=image_id,
            role=role,
            source_type=source_type,
            item_prefix=item_prefix,
            bbox_offset=bbox_offset,
            coordinate_scale=coordinate_scale,
        )
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def ocr_evidence_from_loaded_images(
    loaded_images: list[Any],
    *,
    language: str = "eng",
    psm: int = 11,
    timeout_seconds: int = 20,
    focused_fields: list[str] | None = None,
    image_concurrency: int = 2,
) -> dict:
    if not loaded_images:
        return _ocr_unavailable("no_loaded_images", "tesseract_not_run")
    if shutil.which("tesseract") is None:
        return _ocr_unavailable("tesseract_binary_not_found", "tesseract_not_installed")

    focused_specs = _focused_crop_specs(focused_fields)

    def process_loaded_image(loaded: Any) -> tuple[list[dict[str, Any]], dict[str, str] | None]:
        image_items: list[dict[str, Any]] = []
        image_id = str(getattr(loaded, "image_id", "") or "image")
        role = str(getattr(loaded, "role", "") or "")
        array = getattr(loaded, "array")
        try:
            image_items.extend(_ocr_array_with_tesseract(
                array,
                image_id=image_id,
                role=role,
                source_type="OCR",
                language=language,
                psm=psm,
                timeout_seconds=timeout_seconds,
                item_prefix="tesseract_full",
            ))
            for spec in focused_specs:
                cropped = _crop_array(array, spec["template"])
                if cropped is None:
                    continue
                crop_array, offset = cropped
                image_items.extend(_ocr_array_with_tesseract(
                    crop_array,
                    image_id=image_id,
                    role=spec["role"],
                    source_type=_source_type_for_loaded_role(role),
                    language=language,
                    psm=6,
                    timeout_seconds=timeout_seconds,
                    item_prefix=f"tesseract_{spec['role']}",
                    bbox_offset=offset,
                    coordinate_scale=2.0,
                    upscale=2,
                ))
        except Exception as error:  # noqa: BLE001 - errors are reported as unavailable OCR evidence.
            return image_items, {
                "image_id": image_id,
                "role": role,
                "reason": str(error)[:240],
            }
        return image_items, None

    try:
        requested_concurrency = int(image_concurrency or 1)
    except (TypeError, ValueError):
        requested_concurrency = 1
    bounded_concurrency = max(1, min(2, requested_concurrency, len(loaded_images)))
    if bounded_concurrency == 1:
        results = [process_loaded_image(loaded) for loaded in loaded_images]
    else:
        # A card normally has two source images and the Cloud Run worker has two
        # CPUs. Parallelize at image granularity so each image remains ordered
        # and isolated without spawning an unbounded subprocess fan-out.
        with ThreadPoolExecutor(max_workers=bounded_concurrency, thread_name_prefix="tesseract-image") as executor:
            results = list(executor.map(process_loaded_image, loaded_images))

    items = [item for image_items, _error in results for item in image_items]
    errors = [error for _image_items, error in results if error is not None]

    if items:
        return {
            "status": "OK",
            "model_version": f"tesseract_cli_{language}_psm_{psm}",
            "image_concurrency": bounded_concurrency,
            "items": [normalize_ocr_item(item, index) for index, item in enumerate(items)],
            **({"errors": errors} if errors else {}),
        }

    return {
        "status": "NO_TEXT" if not errors else "UNAVAILABLE",
        "reason": "tesseract_no_text" if not errors else "tesseract_failed",
        "model_version": f"tesseract_cli_{language}_psm_{psm}",
        "image_concurrency": bounded_concurrency,
        "items": [],
        **({"errors": errors} if errors else {}),
    }


def copyright_year_evidence_from_confirmed_grid(
    loaded_images: list[Any],
    multi_card_detection: dict[str, Any],
    *,
    language: str = "eng",
    timeout_seconds: int = 20,
) -> dict[str, Any] | None:
    """Confirm an issue year from repeated publisher copyright lines in a 2x2 lot.

    Statistics years are common and unsafe. This extractor only admits a year
    when the geometry detector has confirmed four physical cards and the same
    four-digit year appears beside TOPPS on at least two independent card backs.
    """
    if (
        multi_card_detection.get("status") != "OK"
        or multi_card_detection.get("card_count_confirmed") is not True
        or int(multi_card_detection.get("card_count_estimate") or 0) != 4
    ):
        return None
    image_id = str(multi_card_detection.get("image_id") or "")
    loaded = next((item for item in loaded_images if "back" in str(getattr(item, "role", "")).lower()), None)
    if loaded is None:
        loaded = next((item for item in loaded_images if str(getattr(item, "image_id", "")) == image_id), None)
    if loaded is None:
        return None
    image_id = str(getattr(loaded, "image_id", "") or image_id)
    array = np.asarray(getattr(loaded, "array"))
    height, width = array.shape[:2]
    year_cells: dict[str, set[int]] = {}
    observed_lines: dict[str, list[str]] = {}
    for cell_index, (x1, y1, x2, y2) in enumerate([
        (0, 0, width // 2, height // 2),
        (width // 2, 0, width, height // 2),
        (0, height // 2, width // 2, height),
        (width // 2, height // 2, width, height),
    ]):
        legal_top = y1 + int((y2 - y1) * 0.76)
        legal_crop = array[legal_top:y2, x1:x2]
        if legal_crop.size == 0:
            continue
        try:
            lines = _ocr_array_with_tesseract(
                legal_crop,
                image_id=image_id,
                role="card_back_copyright",
                source_type="CARD_BACK_PRINTED_TEXT",
                language=language,
                psm=6,
                timeout_seconds=timeout_seconds,
                item_prefix=f"copyright_cell_{cell_index + 1}",
                bbox_offset=(x1, legal_top),
                coordinate_scale=4.0,
                upscale=4,
            )
        except Exception:  # noqa: BLE001 - optional corroboration must fail closed.
            continue
        for line in lines:
            text = str(line.get("observed_text") or line.get("text") or "")
            if "TOPPS" not in text.upper():
                continue
            for year in re.findall(r"\b(?:19|20)\d{2}\b", text):
                year_cells.setdefault(year, set()).add(cell_index)
                observed_lines.setdefault(year, []).append(text)
    confirmed = [year for year, cells in year_cells.items() if len(cells) >= 2]
    if len(confirmed) != 1:
        return None
    year = confirmed[0]
    return {
        "item_id": f"copyright_year_consensus_{image_id}",
        "image_id": image_id,
        "role": "card_back_copyright",
        "field": "year",
        "value": year,
        "text": f"copyright year {year} repeated on {len(year_cells[year])} card backs",
        "observed_text": " | ".join(observed_lines[year][:2]),
        "confidence": 0.92,
        "source_type": "CARD_BACK_PRINTED_TEXT",
        "directly_observed": True,
        "region": {
            "algorithm": "confirmed_2x2_grid_copyright_consensus_v1",
            "independent_card_count": len(year_cells[year]),
        },
    }
