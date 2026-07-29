import unittest
import json
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from app.pipelines.google_vision_ocr import (
    google_vision_configured,
    google_vision_readiness,
    reset_google_vision_client_for_tests,
    run_google_vision_ocr,
    run_google_vision_ocr_batch,
    vision_auth_mode,
)
from app.vision_main import _serial_consensus, app as vision_app, ocr_fields_batch_payload


def _config(**overrides):
    base = dict(
        vision_use_adc=True,
        vision_api_key="test-key",
        vision_endpoint="",
        vision_feature_type="DOCUMENT_TEXT_DETECTION",
        vision_timeout_seconds=30,
        vision_cost_per_image=0.0015,
        token="test-token",
        allowed_image_hosts=["example.supabase.co"],
        max_image_bytes=25 * 1024 * 1024,
        max_total_pixels=50_000_000,
        request_timeout_seconds=30,
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
    def tearDown(self):
        reset_google_vision_client_for_tests()

    def test_auth_mode_is_explicit_and_api_key_remains_supported(self):
        self.assertEqual(vision_auth_mode(_config()), "adc")
        self.assertEqual(vision_auth_mode(_config(vision_use_adc=False)), "api_key")
        self.assertEqual(vision_auth_mode(_config(vision_use_adc=False, vision_api_key="")), "unconfigured")
        self.assertTrue(google_vision_configured(_config(vision_api_key="")))
        self.assertFalse(google_vision_configured(_config(vision_use_adc=False, vision_api_key="")))

    def test_unavailable_when_no_auth_mode_is_configured(self):
        result = run_google_vision_ocr(
            "ARRAY",
            crop_type="serial_crop",
            config=_config(vision_use_adc=False, vision_api_key=""),
        )
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["reason"], "vision_auth_not_configured")
        self.assertEqual(result["vision_http_attempt_count"], 0)
        self.assertEqual(result["google_annotate_request_count"], 0)

    def test_official_client_shapes_batch_and_counts_units(self):
        client = _FakeClient({"responses": [
            {"textAnnotations": [{"description": "7/10"}]},
            {"textAnnotations": [{"description": "PSA 10"}]},
        ]})
        with patch("app.pipelines.google_vision_ocr._array_to_png_bytes", return_value=b"png"):
            result = run_google_vision_ocr_batch(
                ["A", "B"],
                crop_types=["serial_crop", "grade_label_crop"],
                config=_config(vision_api_key=""),
                client=client,
            )
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["vision_unit_count"], 2)
        self.assertEqual(result["cost_estimate"], 0.003)
        self.assertEqual(result["auth_mode"], "adc")
        self.assertEqual(result["vision_http_attempt_count"], 1)
        self.assertEqual(result["google_annotate_request_count"], 1)
        self.assertEqual(result["attempted_vision_unit_count"], 2)
        self.assertEqual(result["confirmed_vision_unit_count"], 2)
        self.assertFalse(result["billing_unknown"])
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
                ["A"],
                crop_types=["serial_crop"],
                config=_config(vision_use_adc=False),
                urlopen_impl=opener,
            )
        body = json.loads(captured["request"].data)
        self.assertEqual(body["requests"][0]["features"], [{"type": "DOCUMENT_TEXT_DETECTION"}])
        self.assertNotIn("test-key", captured["request"].full_url.split("?", 1)[0])
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["vision_unit_count"], 1)
        self.assertEqual(result["auth_mode"], "api_key")

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

    def test_client_error_marks_sent_units_as_billing_unknown(self):
        with patch("app.pipelines.google_vision_ocr._array_to_png_bytes", return_value=b"png"):
            result = run_google_vision_ocr_batch(
                ["A"], crop_types=["serial_crop"], config=_config(), client=_FakeClient(error=TimeoutError("late"))
            )
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["vision_unit_count"], 0)
        self.assertEqual(result["vision_http_attempt_count"], 1)
        self.assertEqual(result["google_annotate_request_count"], 1)
        self.assertEqual(result["attempted_vision_unit_count"], 1)
        self.assertEqual(result["confirmed_vision_unit_count"], 0)
        self.assertTrue(result["billing_unknown"])
        self.assertIsNone(result["cost_estimate"])
        self.assertTrue(result["reason"].startswith("request_failed"))

    def test_invalid_batch_does_not_claim_a_vision_attempt(self):
        result = run_google_vision_ocr_batch([], crop_types=[], config=_config())
        self.assertEqual(result["reason"], "invalid_vision_batch")
        self.assertEqual(result["vision_http_attempt_count"], 0)
        self.assertEqual(result["google_annotate_request_count"], 0)
        self.assertEqual(result["attempted_vision_unit_count"], 0)
        self.assertEqual(result["confirmed_vision_unit_count"], 0)
        self.assertFalse(result["billing_unknown"])

    def test_response_count_mismatch_keeps_attempted_units_and_unknown_billing(self):
        with patch("app.pipelines.google_vision_ocr._array_to_png_bytes", return_value=b"png"):
            result = run_google_vision_ocr_batch(
                ["A", "B"],
                crop_types=["serial_crop", "grade_label_crop"],
                config=_config(),
                client=_FakeClient({"responses": [{"textAnnotations": [{"description": "7/10"}]}]}),
            )
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["reason"], "vision_response_count_mismatch")
        self.assertEqual(result["attempted_vision_unit_count"], 2)
        self.assertEqual(result["confirmed_vision_unit_count"], 1)
        self.assertTrue(result["billing_unknown"])
        self.assertIsNone(result["cost_estimate"])

    def test_adc_readiness_constructs_and_reuses_one_process_client(self):
        client = _FakeClient()
        with patch("app.pipelines.google_vision_ocr._default_client", return_value=client) as factory:
            first = google_vision_readiness(_config(vision_api_key=""))
            second = google_vision_readiness(_config(vision_api_key=""))
        self.assertTrue(first["ready"])
        self.assertTrue(second["ready"])
        self.assertEqual(first["auth_mode"], "adc")
        self.assertEqual(first["readiness_scope"], "credential_source_only")
        self.assertFalse(first["external_vision_verified"])
        self.assertTrue(first["functional_canary_required"])
        factory.assert_called_once()

    def test_adc_readiness_fails_closed_when_credentials_cannot_be_constructed(self):
        with patch("app.pipelines.google_vision_ocr._default_client", side_effect=RuntimeError("no adc")):
            result = google_vision_readiness(_config(vision_api_key=""))
        self.assertFalse(result["ready"])
        self.assertEqual(result["auth_mode"], "adc")
        self.assertEqual(result["reason"], "adc_client_unavailable:RuntimeError")

    def test_readyz_does_not_claim_ready_when_adc_or_endpoint_auth_is_unavailable(self):
        readyz = next(route.endpoint for route in vision_app.routes if route.path == "/readyz")
        with patch("app.vision_main.load_config", return_value=_config(token="")):
            with patch(
                "app.vision_main.google_vision_readiness",
                return_value={
                    "ready": False,
                    "auth_mode": "adc",
                    "reason": "adc_client_unavailable:RuntimeError",
                    "readiness_scope": "credential_source_only",
                    "external_vision_verified": False,
                    "functional_canary_required": True,
                },
            ):
                payload = readyz()
        self.assertEqual(payload["status"], "not_ready")
        self.assertFalse(payload["vision_ready"])
        self.assertEqual(payload["auth_mode"], "adc")
        self.assertEqual(payload["readiness_scope"], "credential_source_only")
        self.assertFalse(payload["external_vision_verified"])
        self.assertTrue(payload["functional_canary_required"])
        self.assertIn("worker_token_not_configured", payload["reason"])
        self.assertIn("adc_client_unavailable:RuntimeError", payload["reason"])

    def test_batch_payload_reports_auth_and_one_external_request(self):
        loaded = SimpleNamespace(array=np.zeros((20, 20, 3), dtype=np.uint8))
        payload = {
            "requests": [{
                "request_id": "ocr_1",
                "image_url": "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
                "crop_type": "player_name",
                "expected_pattern": "year",
                "crop_box": {"x": 0, "y": 0, "width": 10, "height": 10},
                "metadata": {"image_id": "front"},
            }],
        }
        client = _FakeClient({"responses": [{"textAnnotations": [{"description": "2024"}]}]})
        with patch("app.vision_main.load_config", return_value=_config(vision_api_key="")):
            with patch("app.vision_main.load_signed_image", return_value=loaded):
                with patch("app.pipelines.google_vision_ocr._array_to_png_bytes", return_value=b"png"):
                    result = ocr_fields_batch_payload(payload, authorization="Bearer test-token", vision_client=client)
        self.assertEqual(result["request_count"], 1)
        self.assertEqual(result["unique_image_download_count"], 1)
        self.assertEqual(result["decode_count"], 1)
        self.assertEqual(result["vision_unit_count"], 1)
        self.assertEqual(result["vision_http_attempt_count"], 1)
        self.assertEqual(result["google_annotate_request_count"], 1)
        self.assertEqual(result["attempted_vision_unit_count"], 1)
        self.assertEqual(result["confirmed_vision_unit_count"], 1)
        self.assertFalse(result["billing_unknown"])
        self.assertEqual(result["auth_mode"], "adc")
        self.assertEqual(result["results"][0]["auth_mode"], "adc")

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
