import unittest
import json
from types import SimpleNamespace
from unittest.mock import patch

from app.pipelines.google_vision_ocr import (
    google_vision_configured,
    run_google_vision_ocr,
    run_google_vision_ocr_batch,
)
from app.vision_main import _merge_serial_region_consensus, _serial_consensus, ocr_fields_batch_payload


def _config(**overrides):
    base = dict(
        vision_use_adc=True,
        vision_api_key="test-key",
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
    def test_api_key_is_the_production_configuration(self):
        self.assertTrue(google_vision_configured(_config()))
        self.assertFalse(google_vision_configured(_config(vision_api_key="")))

    def test_unavailable_when_api_key_is_missing(self):
        result = run_google_vision_ocr("ARRAY", crop_type="serial_crop", config=_config(vision_api_key=""))
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["reason"], "vision_api_key_not_configured")

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
        self.assertEqual(requests[0]["features"][0]["type_"], "DOCUMENT_TEXT_DETECTION")

    def test_production_rest_batch_uses_public_feature_field(self):
        captured = {}

        class Response:
            def read(self):
                return json.dumps({"responses": [{"textAnnotations": [{"description": "7/10"}]}]}).encode()

        def opener(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return Response()

        with patch("app.pipelines.google_vision_ocr._array_to_png_bytes", return_value=b"png"):
            result = run_google_vision_ocr_batch(
                ["A"], crop_types=["serial_crop"], config=_config(), urlopen_impl=opener
            )
        body = json.loads(captured["request"].data)
        self.assertEqual(body["requests"][0]["features"], [{"type": "DOCUMENT_TEXT_DETECTION"}])
        self.assertNotIn("test-key", captured["request"].full_url.split("?", 1)[0])
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["vision_unit_count"], 1)

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

    def test_serial_regions_accept_one_verified_value_and_reject_verified_conflicts(self):
        verified = _serial_consensus(
            {"candidates": [{"text": "01/35", "confidence": 0.98}], "cost_estimate": 0.0015},
            {"candidates": [{"text": "1 / 35", "confidence": 0.96}], "cost_estimate": 0.0015},
        )
        empty = _serial_consensus(
            {"candidates": [], "cost_estimate": 0.0015},
            {"candidates": [], "cost_estimate": 0.0015},
        )
        merged = _merge_serial_region_consensus(empty, verified)
        self.assertTrue(merged["serial_consensus"]["verified"])
        self.assertEqual(merged["raw_text"], "1/35")
        self.assertEqual(merged["cost_estimate"], 0.006)

        conflicting = _serial_consensus(
            {"candidates": [{"text": "02/35", "confidence": 0.98}]},
            {"candidates": [{"text": "2/35", "confidence": 0.96}]},
        )
        rejected = _merge_serial_region_consensus(verified, conflicting)
        self.assertFalse(rejected["serial_consensus"]["verified"])
        self.assertTrue(rejected["serial_consensus"]["conflict"])
        self.assertEqual(rejected["candidates"], [])

    def test_serial_request_keeps_one_download_and_one_four_unit_vision_batch(self):
        config = SimpleNamespace(
            token="worker-token",
            allowed_image_hosts=("example.test",),
            max_image_bytes=1024,
            max_total_pixels=1024,
            request_timeout_seconds=5,
        )
        raw_results = [
            {"status": "NO_TEXT", "candidates": [], "cost_estimate": 0.0015},
            {"status": "NO_TEXT", "candidates": [], "cost_estimate": 0.0015},
            {"status": "OK", "candidates": [{"text": "01/35", "confidence": 0.98}], "cost_estimate": 0.0015},
            {"status": "OK", "candidates": [{"text": "1/35", "confidence": 0.96}], "cost_estimate": 0.0015},
        ]
        captured = {}

        def fake_batch(arrays, *, crop_types, config, client):
            captured["array_count"] = len(arrays)
            captured["crop_types"] = crop_types
            return {
                "status": "OK",
                "results": raw_results,
                "vision_unit_count": 4,
                "cost_estimate": 0.006,
                "latency_ms": 123,
            }

        payload = {"requests": [{
            "request_id": "serial-1",
            "image_url": "https://example.test/card.jpg",
            "crop_type": "serial_number",
            "crop_box": {"x": 0.58, "y": 0.70, "width": 0.34, "height": 0.22},
            "metadata": {"image_id": "front-1"},
        }]}
        with (
            patch("app.vision_main.load_config", return_value=config),
            patch("app.vision_main.verify_bearer_token"),
            patch("app.vision_main.validate_image_url"),
            patch("app.vision_main.load_signed_image", return_value=SimpleNamespace(array="IMAGE")) as loader,
            patch("app.vision_main._crop", side_effect=lambda array, box: ("crop", tuple(sorted(box.items())))),
            patch("app.vision_main._expanded_crop", side_effect=lambda array, box: ("expanded", tuple(sorted(box.items())))),
            patch("app.vision_main.run_google_vision_ocr_batch", side_effect=fake_batch),
        ):
            result = ocr_fields_batch_payload(payload, "Bearer worker-token", vision_client="client")

        self.assertEqual(loader.call_count, 1)
        self.assertEqual(captured["array_count"], 4)
        self.assertEqual(captured["crop_types"], [
            "serial_number",
            "serial_number_planned_expanded",
            "serial_number_top_right",
            "serial_number_top_right_expanded",
        ])
        self.assertEqual(result["vision_unit_count"], 4)
        self.assertEqual(result["results"][0]["vision_unit_count"], 4)
        self.assertEqual(result["results"][0]["raw_text"], "1/35")

    def test_card_code_request_adds_one_full_image_unit_and_tags_candidates(self):
        config = SimpleNamespace(
            token="worker-token",
            allowed_image_hosts=("example.test",),
            max_image_bytes=1024,
            max_total_pixels=1024,
            request_timeout_seconds=5,
        )
        raw_results = [
            {"status": "OK", "raw_text": "OHTANI", "candidates": [{"text": "OHTANI", "confidence": 0.95}], "confidence": 0.95, "cost_estimate": 0.0015},
            {"status": "OK", "raw_text": "17", "candidates": [{"text": "17", "confidence": 0.98, "box": {"vertices": [{"x": 1, "y": 1}]} }], "confidence": 0.98, "cost_estimate": 0.0015},
        ]
        captured = {}

        def fake_batch(arrays, *, crop_types, config, client):
            captured["arrays"] = arrays
            captured["crop_types"] = crop_types
            return {"status": "OK", "results": raw_results, "vision_unit_count": 2, "cost_estimate": 0.003, "latency_ms": 20}

        payload = {"requests": [{
            "request_id": "code-1",
            "image_url": "https://example.test/card.jpg",
            "crop_type": "collector_number",
            "crop_box": {"x": 0, "y": 0.7, "width": 0.4, "height": 0.3},
            "metadata": {"image_id": "back-1"},
        }]}
        with (
            patch("app.vision_main.load_config", return_value=config),
            patch("app.vision_main.verify_bearer_token"),
            patch("app.vision_main.validate_image_url"),
            patch("app.vision_main.load_signed_image", return_value=SimpleNamespace(array="IMAGE")),
            patch("app.vision_main._crop", return_value="CROP"),
            patch("app.vision_main.run_google_vision_ocr_batch", side_effect=fake_batch),
        ):
            result = ocr_fields_batch_payload(payload, "Bearer worker-token", vision_client="client")

        self.assertEqual(captured["arrays"], ["CROP", "IMAGE"])
        self.assertEqual(captured["crop_types"], ["collector_number", "card_code_full_image"])
        self.assertEqual(result["results"][0]["vision_unit_count"], 2)
        self.assertTrue(result["results"][0]["inline_full_image_fallback_evaluated"])
        self.assertEqual(result["results"][0]["text_candidates"][1]["ocr_pass"], "full_image_fallback")


if __name__ == "__main__":
    unittest.main()
