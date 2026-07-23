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


if __name__ == "__main__":
    unittest.main()
