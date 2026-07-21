"""DeepSeek OCR 2 adapter unit tests — stdlib only (no numpy/PIL/network).

The heavy image/model stack is only touched inside _array_to_base64_png, which
is patched here, so these run in a bare Python environment and validate the
request shaping, response parsing, cost/latency accounting, and fail-safe paths.
"""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

from app.pipelines.deepseek_ocr import (
    _chat_completions_url,
    _extract_text,
    _prompt_for_crop,
    deepseek_ocr_configured,
    run_deepseek_ocr,
)


def _config(**overrides):
    base = dict(
        deepseek_ocr_endpoint="http://ocr-gpu:8000",
        deepseek_ocr_model="deepseek-ai/DeepSeek-OCR2",
        deepseek_ocr_api_key="",
        deepseek_ocr_timeout_seconds=30,
        deepseek_ocr_max_tokens=512,
        deepseek_ocr_gpu_cost_per_second=0.0004,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class _FakeResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body


class DeepSeekOcrUnitTests(unittest.TestCase):
    def test_chat_completions_url_forms(self):
        self.assertEqual(_chat_completions_url("http://x:8000"), "http://x:8000/v1/chat/completions")
        self.assertEqual(_chat_completions_url("http://x:8000/"), "http://x:8000/v1/chat/completions")
        self.assertEqual(_chat_completions_url("http://x:8000/v1"), "http://x:8000/v1/chat/completions")
        self.assertEqual(
            _chat_completions_url("http://x:8000/v1/chat/completions"),
            "http://x:8000/v1/chat/completions",
        )

    def test_extract_text_variants(self):
        self.assertEqual(_extract_text({"choices": [{"message": {"content": "  25/99 "}}]}), "25/99")
        self.assertEqual(
            _extract_text({"choices": [{"message": {"content": [{"type": "text", "text": "PSA 10"}]}}]}),
            "PSA 10",
        )
        self.assertEqual(_extract_text({"choices": []}), "")
        self.assertEqual(_extract_text({}), "")

    def test_prompt_for_crop(self):
        self.assertIn("serial", _prompt_for_crop("serial_crop").lower())
        self.assertIn("serial", _prompt_for_crop("serial_number").lower())
        self.assertIn("free ocr", _prompt_for_crop("mystery_crop").lower())

    def test_configured(self):
        self.assertTrue(deepseek_ocr_configured(_config()))
        self.assertFalse(deepseek_ocr_configured(_config(deepseek_ocr_endpoint="")))

    def test_unavailable_when_unconfigured(self):
        result = run_deepseek_ocr(object(), crop_type="serial_crop", config=_config(deepseek_ocr_endpoint=""))
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["reason"], "deepseek_ocr_endpoint_not_configured")
        self.assertEqual(result["candidates"], [])

    def test_unavailable_when_array_missing(self):
        result = run_deepseek_ocr(None, crop_type="serial_crop", config=_config())
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["reason"], "image_bytes_not_loaded")

    def test_success_shapes_candidates_and_cost(self):
        payload = {"choices": [{"message": {"content": "25/99"}}], "usage": {"total_tokens": 42}}
        captured = {}

        def fake_open(request, timeout):
            captured["url"] = request.full_url
            captured["body"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return _FakeResponse(payload)

        with patch("app.pipelines.deepseek_ocr._array_to_base64_png", return_value="ZmFrZQ=="):
            result = run_deepseek_ocr("ARRAY", crop_type="serial_crop", config=_config(), urlopen_impl=fake_open)

        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["raw_text"], "25/99")
        self.assertEqual(result["candidates"], [{"text": "25/99", "confidence": 0.9, "box": None}])
        self.assertEqual(result["backend"], "deepseek")
        self.assertGreaterEqual(result["cost_estimate"], 0.0)
        self.assertEqual(result["usage"], {"total_tokens": 42})
        # request shaping: vLLM chat completions with image_url + model + timeout
        self.assertEqual(captured["url"], "http://ocr-gpu:8000/v1/chat/completions")
        self.assertEqual(captured["body"]["model"], "deepseek-ai/DeepSeek-OCR2")
        self.assertEqual(captured["body"]["messages"][0]["content"][0]["type"], "image_url")
        self.assertEqual(captured["timeout"], 30)

    def test_api_key_sets_bearer_header(self):
        captured = {}

        def fake_open(request, timeout):
            captured["auth"] = request.headers.get("Authorization")
            return _FakeResponse({"choices": [{"message": {"content": "x"}}]})

        with patch("app.pipelines.deepseek_ocr._array_to_base64_png", return_value="ZmFrZQ=="):
            run_deepseek_ocr("ARRAY", crop_type="serial_crop", config=_config(deepseek_ocr_api_key="secret"), urlopen_impl=fake_open)
        self.assertEqual(captured["auth"], "Bearer secret")

    def test_http_error_is_fail_safe(self):
        def fake_open(request, timeout):
            raise HTTPError("u", 500, "err", {}, None)

        with patch("app.pipelines.deepseek_ocr._array_to_base64_png", return_value="ZmFrZQ=="):
            result = run_deepseek_ocr("ARRAY", crop_type="serial_crop", config=_config(), urlopen_impl=fake_open)
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertTrue(result["reason"].startswith("http_500"))
        self.assertEqual(result["candidates"], [])

    def test_no_text_status(self):
        with patch("app.pipelines.deepseek_ocr._array_to_base64_png", return_value="ZmFrZQ=="):
            result = run_deepseek_ocr(
                "ARRAY",
                crop_type="serial_crop",
                config=_config(),
                urlopen_impl=lambda request, timeout: _FakeResponse({"choices": [{"message": {"content": ""}}]}),
            )
        self.assertEqual(result["status"], "NO_TEXT")
        self.assertEqual(result["candidates"], [])


if __name__ == "__main__":
    unittest.main()
