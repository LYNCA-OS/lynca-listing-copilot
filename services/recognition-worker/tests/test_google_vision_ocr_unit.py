import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.pipelines.google_vision_ocr import (
    google_vision_configured,
    run_google_vision_ocr,
    run_google_vision_ocr_batch,
)
from app.vision_main import _serial_consensus


def _config(**overrides):
    base = dict(
        vision_use_adc=True,
        vision_endpoint="",
        vision_feature_type="DOCUMENT_TEXT_DETECTION",
        vision_timeout_seconds=30,
        vision_cost_per_image=0.0015,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class _FakeClient:
    def __init__(self, payload=None, error=None):
        self.payload = payload or {"responses": []}
        self.error = error
        self.calls = []

    def batch_annotate_images(self, *, request, timeout):
        self.calls.append({"request": request, "timeout": timeout})
        if self.error:
            raise self.error
        return self.payload


def _word(text, confidence, end_line=False):
    symbols = [{"text": char} for char in text]
    if end_line and symbols:
        symbols[-1]["property"] = {"detectedBreak": {"type": "LINE_BREAK"}}
    return {"symbols": symbols, "confidence": confidence}


class GoogleVisionOcrUnitTests(unittest.TestCase):
    def test_adc_is_the_only_production_configuration(self):
        self.assertTrue(google_vision_configured(_config()))
        self.assertFalse(google_vision_configured(_config(vision_use_adc=False)))

    def test_unavailable_when_adc_is_disabled(self):
        result = run_google_vision_ocr("ARRAY", crop_type="serial_crop", config=_config(vision_use_adc=False))
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["reason"], "vision_adc_disabled")

    def test_official_client_shapes_batch_and_counts_units(self):
        client = _FakeClient({"responses": [
            {"textAnnotations": [{"description": "7/10"}]},
            {"textAnnotations": [{"description": "PSA 10"}]},
        ]})
        with patch("app.pipelines.google_vision_ocr._array_to_png_bytes", return_value=b"png"):
            result = run_google_vision_ocr_batch(
                ["A", "B"],
                crop_types=["serial_crop", "grade_label_crop"],
                config=_config(),
                client=client,
            )
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["vision_unit_count"], 2)
        self.assertEqual(result["cost_estimate"], 0.003)
        self.assertEqual(len(client.calls), 1)
        requests = client.calls[0]["request"]["requests"]
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0]["features"][0]["type"], "DOCUMENT_TEXT_DETECTION")
        self.assertNotIn("type_", requests[0]["features"][0])

    def test_word_confidence_survives_low_page_average(self):
        payload = {"responses": [{"fullTextAnnotation": {
            "text": "SP 05/10",
            "pages": [{
                "confidence": 0.85,
                "blocks": [{"paragraphs": [{"words": [
                    _word("SP", 0.80),
                    _word("05/10", 0.99, end_line=True),
                ]}]}],
            }],
        }}]}
        with patch("app.pipelines.google_vision_ocr._array_to_png_bytes", return_value=b"png"):
            result = run_google_vision_ocr("ARRAY", crop_type="serial_crop", config=_config(), client=_FakeClient(payload))
        serial = next((candidate for candidate in result["candidates"] if candidate["text"] == "05/10"), None)
        self.assertIsNotNone(serial)
        self.assertAlmostEqual(serial["confidence"], 0.99, places=4)
        self.assertEqual(result["vision_unit_count"], 1)

    def test_client_error_is_fail_safe_and_bills_zero_units(self):
        with patch("app.pipelines.google_vision_ocr._array_to_png_bytes", return_value=b"png"):
            result = run_google_vision_ocr_batch(
                ["A"], crop_types=["serial_crop"], config=_config(), client=_FakeClient(error=TimeoutError("late"))
            )
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["vision_unit_count"], 0)
        self.assertTrue(result["reason"].startswith("request_failed"))

    def test_serial_requires_exact_and_expanded_crop_agreement(self):
        wrong_primary = {"candidates": [{"text": "4/25", "confidence": 0.99}]}
        correct_expanded = {"candidates": [{"text": "24/25", "confidence": 0.96}]}
        conflict = _serial_consensus(wrong_primary, correct_expanded)
        self.assertFalse(conflict["serial_consensus"]["verified"])
        self.assertEqual(conflict["raw_text"], "#/25")
        self.assertEqual(conflict["candidates"][0]["text"], "#/25")

        agreed = _serial_consensus(correct_expanded, {"candidates": [{"text": "24 / 25", "confidence": 0.94}]})
        self.assertTrue(agreed["serial_consensus"]["verified"])
        self.assertEqual(agreed["raw_text"], "24/25")
        self.assertEqual(agreed["confidence"], 0.94)

        billed = _serial_consensus(
            {**correct_expanded, "cost_estimate": 0.0015},
            {"candidates": [{"text": "24/25", "confidence": 0.94}], "cost_estimate": 0.0015},
        )
        self.assertEqual(billed["cost_estimate"], 0.003)


if __name__ == "__main__":
    unittest.main()
