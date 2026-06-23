from __future__ import annotations

import csv
import shutil
import subprocess
import tempfile
from io import StringIO
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


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


def _parse_tesseract_tsv(tsv: str, *, image_id: str, role: str) -> list[dict[str, Any]]:
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
        left = int(float(row.get("left") or 0))
        top = int(float(row.get("top") or 0))
        width = int(float(row.get("width") or 0))
        height = int(float(row.get("height") or 0))
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
            "item_id": f"tesseract_{image_id}_{index + 1}",
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
            "source_type": "OCR",
        })

    return items


def _array_to_temp_png(array: np.ndarray) -> Path:
    temp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    temp_path = Path(temp.name)
    temp.close()
    image = Image.fromarray(array.astype("uint8"), mode="RGB")
    image.save(temp_path, format="PNG")
    return temp_path


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


def ocr_evidence_from_loaded_images(
    loaded_images: list[Any],
    *,
    language: str = "eng",
    psm: int = 11,
    timeout_seconds: int = 20,
) -> dict:
    if not loaded_images:
        return _ocr_unavailable("no_loaded_images", "tesseract_not_run")
    if shutil.which("tesseract") is None:
        return _ocr_unavailable("tesseract_binary_not_found", "tesseract_not_installed")

    items: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for loaded in loaded_images:
        temp_path: Path | None = None
        image_id = str(getattr(loaded, "image_id", "") or "image")
        role = str(getattr(loaded, "role", "") or "")
        try:
            temp_path = _array_to_temp_png(getattr(loaded, "array"))
            tsv = _run_tesseract(
                temp_path,
                language=language,
                psm=psm,
                timeout_seconds=timeout_seconds,
            )
            items.extend(_parse_tesseract_tsv(tsv, image_id=image_id, role=role))
        except Exception as error:  # noqa: BLE001 - errors are reported as unavailable OCR evidence.
            errors.append({
                "image_id": image_id,
                "role": role,
                "reason": str(error)[:240],
            })
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

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
