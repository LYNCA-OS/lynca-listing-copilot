"""Google Vision OCR adapter unit tests — stdlib only (no numpy/PIL/network).

_array_to_base64_png is patched so these run in a bare Python environment and
validate request shaping, fullTextAnnotation parsing, cost accounting, and
fail-safe paths.
"""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

from app.pipelines.google_vision_ocr import (
    google_vision_configured,
    run_google_vision_ocr,
)


def _config(**overrides):
    base = dict(
        vision_api_key="test-key",
        vision_endpoint="",
        vision_feature_type="DOCUMENT_TEXT_DETECTION",
        vision_timeout_seconds=30,
        vision_cost_per_image=0.0015,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class _FakeResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body


class GoogleVisionOcrUnitTests(unittest.TestCase):
    def test_configured(self):
        self.assertTrue(google_vision_configured(_config()))
        self.assertFalse(google_vision_configured(_config(vision_api_key="")))

    def test_unavailable_when_unconfigured(self):
        result = run_google_vision_ocr(object(), crop_type="serial_crop", config=_config(vision_api_key=""))
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["reason"], "vision_api_key_not_configured")

    def test_unavailable_when_array_missing(self):
        result = run_google_vision_ocr(None, crop_type="serial_crop", config=_config())
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["reason"], "image_bytes_not_loaded")

    def test_reads_serial_and_shapes_candidate(self):
        payload = {"responses": [{"fullTextAnnotation": {"text": "CPA-VG 7/10", "pages": [{"confidence": 0.94}]}}]}
        captured = {}

        def fake_open(request, timeout):
            captured["url"] = request.full_url
            captured["body"] = json.loads(request.data.decode("utf-8"))
            return _FakeResponse(payload)

        with patch("app.pipelines.google_vision_ocr._array_to_base64_png", return_value="ZmFrZQ=="):
            result = run_google_vision_ocr("ARRAY", crop_type="serial_crop", config=_config(), urlopen_impl=fake_open)

        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["raw_text"], "CPA-VG 7/10")
        self.assertEqual(result["candidates"][0]["text"], "CPA-VG 7/10")
        self.assertEqual(result["candidates"][0]["confidence"], 0.94)
        self.assertEqual(result["backend"], "google_vision")
        self.assertGreaterEqual(result["cost_estimate"], 0.0)
        # request shaping: images:annotate with key + DOCUMENT_TEXT_DETECTION
        self.assertIn("key=test-key", captured["url"])
        self.assertEqual(captured["body"]["requests"][0]["features"][0]["type"], "DOCUMENT_TEXT_DETECTION")

    def test_text_annotations_fallback(self):
        payload = {"responses": [{"textAnnotations": [{"description": "25/99"}]}]}
        with patch("app.pipelines.google_vision_ocr._array_to_base64_png", return_value="ZmFrZQ=="):
            result = run_google_vision_ocr(
                "ARRAY", crop_type="serial_crop", config=_config(),
                urlopen_impl=lambda request, timeout: _FakeResponse(payload),
            )
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["raw_text"], "25/99")

    def test_vision_error_is_fail_safe(self):
        payload = {"responses": [{"error": {"message": "bad image"}}]}
        with patch("app.pipelines.google_vision_ocr._array_to_base64_png", return_value="ZmFrZQ=="):
            result = run_google_vision_ocr(
                "ARRAY", crop_type="serial_crop", config=_config(),
                urlopen_impl=lambda request, timeout: _FakeResponse(payload),
            )
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertTrue(result["reason"].startswith("vision_error"))

    def test_http_error_is_fail_safe(self):
        def fake_open(request, timeout):
            raise HTTPError("u", 429, "rate", {}, None)

        with patch("app.pipelines.google_vision_ocr._array_to_base64_png", return_value="ZmFrZQ=="):
            result = run_google_vision_ocr("ARRAY", crop_type="serial_crop", config=_config(), urlopen_impl=fake_open)
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertTrue(result["reason"].startswith("http_429"))

    def test_no_text_status(self):
        payload = {"responses": [{"fullTextAnnotation": {"text": ""}}]}
        with patch("app.pipelines.google_vision_ocr._array_to_base64_png", return_value="ZmFrZQ=="):
            result = run_google_vision_ocr(
                "ARRAY", crop_type="serial_crop", config=_config(),
                urlopen_impl=lambda request, timeout: _FakeResponse(payload),
            )
        self.assertEqual(result["status"], "NO_TEXT")
        self.assertEqual(result["candidates"], [])


if __name__ == "__main__":
    unittest.main()
