"""DeepSeek OCR 2 vLLM backend adapter.

A self-hosted DeepSeek OCR 2 model is served behind a vLLM OpenAI-compatible
`/v1/chat/completions` endpoint. This adapter renders a crop to a base64 PNG,
sends it with a crop-specific OCR prompt, and returns candidates in the exact
shape the PaddleOCR path produces ({"text", "confidence", "box"}), so the rest
of the OCR pipeline, evidence fusion, and contract are reused unchanged.

Only stdlib networking (urllib) is used to avoid a new worker dependency, and
`urlopen_impl` is injectable so contract tests never touch the network.
"""

from __future__ import annotations

import base64
import io
import json
import time
from typing import TYPE_CHECKING, Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

if TYPE_CHECKING:  # numpy is a worker runtime dep; kept lazy so the pure request/
    import numpy as np  # parsing logic imports without the heavy image stack.

# DeepSeek OCR 2 returns free text, not per-word confidences. Until logprob-based
# scoring is wired, a strong-model prior is used so fused readings rank sensibly
# against PaddleOCR's calibrated scores. Kept conservative to avoid overriding a
# high-confidence Paddle serial read during hybrid fusion.
_DEFAULT_CONFIDENCE = 0.9

# Crop-scoped prompts keep the model focused on the atomic field. A bare "Free
# OCR." is the DeepSeek OCR 2 default; the targeted variants reduce hallucinated
# surrounding text on tight foil serial / grade crops.
_PROMPT_BY_CROP_TYPE = {
    "serial_crop": "Read only the print-run serial number on this card crop (formats like 25/99, 1/1, #/50). Output just the number, nothing else.",
    "serial_number": "Read only the print-run serial number on this card crop (formats like 25/99, 1/1, #/50). Output just the number, nothing else.",
    "grade_label_crop": "Read the grading label text (company and grade, e.g. PSA 10, BGS 9.5). Output only that text.",
    "card_code_crop": "Read the printed card number / set code on this crop. Output only that code.",
    "year_product_crop": "Read the printed year or season and product name on this crop. Output only that text.",
    "subject_crop": "Read the player or subject name printed on this crop. Output only the name.",
}
_DEFAULT_PROMPT = "Free OCR. Output only the text visible in this image."


def deepseek_ocr_configured(config: Any) -> bool:
    return bool(getattr(config, "deepseek_ocr_endpoint", "").strip())


def deepseek_unavailable(reason: str, *, latency_ms: int = 0) -> dict[str, Any]:
    return {
        "status": "UNAVAILABLE",
        "reason": reason,
        "candidates": [],
        "raw_text": "",
        "confidence": 0,
        "latency_ms": latency_ms,
        "cost_estimate": 0.0,
        "backend": "deepseek",
    }


def _array_to_base64_png(array: "np.ndarray") -> str:
    # Pillow is already a worker dependency (image handling). Arrays flow through
    # the pipeline in RGB order; encode directly.
    import numpy as np
    from PIL import Image

    prepared = array
    if prepared.dtype != np.uint8:
        prepared = np.clip(prepared, 0, 255).astype(np.uint8)
    if prepared.ndim == 2:
        image = Image.fromarray(prepared, mode="L")
    else:
        image = Image.fromarray(prepared[:, :, :3], mode="RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _prompt_for_crop(crop_type: str) -> str:
    return _PROMPT_BY_CROP_TYPE.get(str(crop_type or "").strip().lower(), _DEFAULT_PROMPT)


def _chat_completions_url(endpoint: str) -> str:
    base = endpoint.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _extract_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    message = (choices[0] or {}).get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    # Some servers return content as a list of parts.
    if isinstance(content, list):
        parts = [str(part.get("text", "")) for part in content if isinstance(part, dict)]
        return " ".join(part for part in parts if part).strip()
    return ""


def run_deepseek_ocr(
    array: np.ndarray,
    *,
    crop_type: str,
    config: Any,
    urlopen_impl: Callable[[Request, int], Any] | None = None,
) -> dict[str, Any]:
    """Return {status, candidates, raw_text, confidence, latency_ms, cost_estimate, backend}.

    candidates match the PaddleOCR shape: [{"text", "confidence", "box"}].
    """
    started = time.time()
    if not deepseek_ocr_configured(config):
        return deepseek_unavailable("deepseek_ocr_endpoint_not_configured")
    if array is None:
        return deepseek_unavailable("image_bytes_not_loaded")

    try:
        image_b64 = _array_to_base64_png(array)
    except Exception as error:  # noqa: BLE001
        return deepseek_unavailable(f"image_encode_failed:{str(error)[:120]}")

    body = json.dumps({
        "model": config.deepseek_ocr_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
                    {"type": "text", "text": _prompt_for_crop(crop_type)},
                ],
            }
        ],
        "max_tokens": int(getattr(config, "deepseek_ocr_max_tokens", 512)),
        "temperature": 0.0,
    }).encode("utf-8")

    headers = {"content-type": "application/json"}
    api_key = getattr(config, "deepseek_ocr_api_key", "")
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"

    request = Request(
        _chat_completions_url(config.deepseek_ocr_endpoint),
        data=body,
        headers=headers,
        method="POST",
    )
    opener = urlopen_impl or (lambda req, timeout: urlopen(req, timeout=timeout))
    timeout_seconds = int(getattr(config, "deepseek_ocr_timeout_seconds", 30))

    try:
        response = opener(request, timeout_seconds)
        raw = response.read()
        payload = json.loads(raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw)
    except HTTPError as error:  # noqa: PERF203
        return deepseek_unavailable(f"http_{error.code}", latency_ms=int((time.time() - started) * 1000))
    except (URLError, TimeoutError) as error:
        return deepseek_unavailable(f"request_failed:{str(error)[:120]}", latency_ms=int((time.time() - started) * 1000))
    except (ValueError, json.JSONDecodeError) as error:
        return deepseek_unavailable(f"invalid_response:{str(error)[:120]}", latency_ms=int((time.time() - started) * 1000))

    latency_ms = int((time.time() - started) * 1000)
    text = _extract_text(payload)
    usage = payload.get("usage") if isinstance(payload, dict) else None
    cost_estimate = round(
        (latency_ms / 1000.0) * float(getattr(config, "deepseek_ocr_gpu_cost_per_second", 0.0)),
        6,
    )

    candidates = (
        [{"text": text, "confidence": _DEFAULT_CONFIDENCE, "box": None}]
        if text
        else []
    )
    return {
        "status": "OK" if candidates else "NO_TEXT",
        "candidates": candidates,
        "raw_text": text,
        "confidence": _DEFAULT_CONFIDENCE if candidates else 0,
        "latency_ms": latency_ms,
        "cost_estimate": cost_estimate,
        "backend": "deepseek",
        "usage": usage if isinstance(usage, dict) else None,
    }
