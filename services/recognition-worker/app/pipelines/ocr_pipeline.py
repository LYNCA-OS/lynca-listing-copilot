from __future__ import annotations

import csv
import re
import shutil
import subprocess
import tempfile
import threading
import time
from io import StringIO
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

_PADDLEOCR_ENGINE: Any | None = None
_PADDLEOCR_LOCK = threading.Lock()
PADDLEOCR_FIELD_MAX_SIDE = 960


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
        # Prefer the mobile PP-OCRv5 det/rec models with oneDNN (mkldnn) disabled.
        # The default server models take the FusedConv2DKernel<OneDNNContext>
        # inference path, which raised a SIGFPE ("Erroneous arithmetic
        # operation") and crashed the uvicorn worker process on every field OCR
        # call on this Cloud Run CPU. The mobile models are smaller, faster, and
        # accurate enough for the short printed field crops we verify (serials,
        # card codes, grades); disabling mkldnn keeps inference off the crashing
        # kernel. Each entry falls back to the next if a kwarg is unsupported by
        # the installed PaddleOCR build.
        base_flags = {
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        }
        mobile_models = {
            "text_detection_model_name": "PP-OCRv5_mobile_det",
            "text_recognition_model_name": "PP-OCRv5_mobile_rec",
        }
        constructor_kwargs = [
            {"lang": "en", "enable_mkldnn": False, **mobile_models, **base_flags},
            {"lang": "en", "enable_mkldnn": False, **base_flags},
            {"lang": "en", **mobile_models, **base_flags},
            {"lang": "en", **base_flags},
            {"lang": "en"},
            {},
        ]
        for kwargs in constructor_kwargs:
            try:
                _PADDLEOCR_ENGINE = PaddleOCR(**kwargs)
                return _PADDLEOCR_ENGINE
            except Exception as error:  # noqa: BLE001 - try API-compatible constructor variants.
                last_error = error
        raise RuntimeError(f"paddleocr_init_failed: {last_error}") from last_error


def preload_paddleocr_engine(*, model_id: str = "paddleocr", model_revision: str = "") -> dict[str, Any]:
    started = time.time()
    try:
        _get_paddleocr_engine()
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
    try:
        candidates = _run_paddleocr(crop_array, offset=offset)
    except Exception as error:  # noqa: BLE001
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
            "model_id": model_id,
            "model_revision": model_revision,
            "image_id": image_id,
            "image_role": role,
        }

    raw_text, confidence = _normalize_field_candidates(candidates)
    return {
        "request_id": request_id,
        "crop_type": crop_type,
        "status": "OK" if candidates else "NO_TEXT",
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
    }


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
) -> dict:
    if not loaded_images:
        return _ocr_unavailable("no_loaded_images", "tesseract_not_run")
    if shutil.which("tesseract") is None:
        return _ocr_unavailable("tesseract_binary_not_found", "tesseract_not_installed")

    items: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    focused_specs = _focused_crop_specs(focused_fields)
    for loaded in loaded_images:
        image_id = str(getattr(loaded, "image_id", "") or "image")
        role = str(getattr(loaded, "role", "") or "")
        array = getattr(loaded, "array")
        try:
            items.extend(_ocr_array_with_tesseract(
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
                items.extend(_ocr_array_with_tesseract(
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
            errors.append({
                "image_id": image_id,
                "role": role,
                "reason": str(error)[:240],
            })

    if items:
        return {
            "status": "OK",
            "model_version": f"tesseract_cli_{language}_psm_{psm}",
            "items": [normalize_ocr_item(item, index) for index, item in enumerate(items)],
            **({"errors": errors} if errors else {}),
        }

    return {
        "status": "NO_TEXT" if not errors else "UNAVAILABLE",
        "reason": "tesseract_no_text" if not errors else "tesseract_failed",
        "model_version": f"tesseract_cli_{language}_psm_{psm}",
        "items": [],
        **({"errors": errors} if errors else {}),
    }
