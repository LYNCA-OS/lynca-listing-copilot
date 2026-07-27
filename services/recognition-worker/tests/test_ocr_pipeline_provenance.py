import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.pipelines.ocr_pipeline import ocr_field_from_loaded_image


class OcrPipelineProvenanceTests(unittest.TestCase):
    def test_google_lane_owns_model_and_unit_provenance(self):
        loaded = SimpleNamespace(image_id="front", role="front_original", array="IMAGE")
        config = SimpleNamespace(vision_feature_type="DOCUMENT_TEXT_DETECTION")
        vision_result = {
            "status": "OK",
            "candidates": [{"text": "OHTANI", "confidence": 0.99, "box": None}],
            "latency_ms": 17,
            "vision_unit_count": 1,
            "cost_estimate": 0.0015,
        }
        with (
            patch("app.pipelines.ocr_pipeline._crop_array_by_box", return_value=("CROP", (0, 0))),
            patch("app.pipelines.google_vision_ocr.run_google_vision_ocr", return_value=vision_result),
        ):
            result = ocr_field_from_loaded_image(
                loaded,
                crop_type="subject_crop",
                model_id="paddleocr",
                model_revision="ppocr-v6-medium-hpi-cpu",
                ocr_backend="google_vision",
                config=config,
            )

        self.assertEqual(result["model_id"], "google-cloud-vision")
        self.assertEqual(result["model_revision"], "DOCUMENT_TEXT_DETECTION")
        self.assertEqual(result["ocr_backend"], "google_vision")
        self.assertEqual(result["vision_unit_count"], 1)
        self.assertEqual(result["vision_cost_estimate"], 0.0015)

    def test_google_unavailable_does_not_masquerade_as_no_text(self):
        loaded = SimpleNamespace(image_id="front", role="front_original", array="IMAGE")
        config = SimpleNamespace(vision_feature_type="DOCUMENT_TEXT_DETECTION")
        with (
            patch("app.pipelines.ocr_pipeline._crop_array_by_box", return_value=("CROP", (0, 0))),
            patch("app.pipelines.google_vision_ocr.run_google_vision_ocr", return_value={
                "status": "UNAVAILABLE",
                "reason": "request_failed:http_429",
                "candidates": [],
                "vision_unit_count": 0,
                "cost_estimate": 0,
            }),
        ):
            result = ocr_field_from_loaded_image(
                loaded,
                crop_type="subject_crop",
                ocr_backend="google_vision",
                config=config,
            )

        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["reason"], "request_failed:http_429")

    def test_google_serial_requires_raw_and_contrast_variant_agreement(self):
        loaded = SimpleNamespace(image_id="back", role="back_original", array="IMAGE")
        config = SimpleNamespace(vision_feature_type="DOCUMENT_TEXT_DETECTION")
        batch_result = {
            "status": "OK",
            "results": [
                {"status": "OK", "candidates": [{"text": "19/99", "confidence": 0.97}]},
                {"status": "OK", "candidates": [{"text": "19 / 99", "confidence": 0.94}]},
            ],
            "vision_unit_count": 2,
            "cost_estimate": 0.003,
            "latency_ms": 21,
        }
        with (
            patch("app.pipelines.ocr_pipeline._crop_array_by_box", return_value=("CROP", (0, 0))),
            patch("app.pipelines.ocr_pipeline._serial_contrast_variant", return_value="CONTRAST"),
            patch("app.pipelines.google_vision_ocr.run_google_vision_ocr_batch", return_value=batch_result) as batch_mock,
        ):
            result = ocr_field_from_loaded_image(
                loaded,
                crop_type="serial_crop",
                ocr_backend="google_vision",
                config=config,
            )

        batch_mock.assert_called_once()
        self.assertEqual(result["raw_text"], "19/99")
        self.assertEqual(result["vision_unit_count"], 2)
        self.assertEqual(result["vision_cost_estimate"], 0.003)
        self.assertTrue(result["serial_consensus"]["verified"])
        self.assertEqual(result["serial_consensus"]["variant"], "raw_plus_clahe_v1")

    def test_google_serial_conflict_never_emits_a_numerator(self):
        loaded = SimpleNamespace(image_id="back", role="back_original", array="IMAGE")
        config = SimpleNamespace(vision_feature_type="DOCUMENT_TEXT_DETECTION")
        with (
            patch("app.pipelines.ocr_pipeline._crop_array_by_box", return_value=("CROP", (0, 0))),
            patch("app.pipelines.ocr_pipeline._serial_contrast_variant", return_value="CONTRAST"),
            patch("app.pipelines.google_vision_ocr.run_google_vision_ocr_batch", return_value={
                "status": "OK",
                "results": [
                    {"status": "OK", "candidates": [{"text": "19/99", "confidence": 0.98}]},
                    {"status": "OK", "candidates": [{"text": "79/99", "confidence": 0.96}]},
                ],
                "vision_unit_count": 2,
                "cost_estimate": 0.003,
                "latency_ms": 22,
            }),
        ):
            result = ocr_field_from_loaded_image(
                loaded,
                crop_type="serial_crop",
                ocr_backend="google_vision",
                config=config,
            )

        self.assertEqual(result["raw_text"], "#/99")
        self.assertFalse(result["serial_consensus"]["verified"])
        self.assertTrue(result["serial_consensus"]["conflict"])


if __name__ == "__main__":
    unittest.main()
