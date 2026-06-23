import os
import unittest

import numpy as np

from app.contracts import validate_request
from app.eval import evaluate_worker_items
from app.main import analyze_payload
from app.pipelines.card_rectification import rectify_card_from_array
from app.pipelines.evidence_fusion import fuse_ocr_evidence
from app.pipelines.field_parsers import parse_checklist_code, parse_collector_number, parse_grade, parse_serial
from app.pipelines.glare_detection import detect_glare_from_array
from app.pipelines.image_quality import measure_image_quality_from_array
from app.pipelines.ocr_pipeline import ocr_evidence_from_items
from app.pipelines.region_proposal import propose_regions_for_rectified_card
from app.security import SecurityError, UrlPolicy, redact_url, validate_image_url, verify_bearer_token


class RecognitionWorkerTests(unittest.TestCase):
    def setUp(self):
        os.environ["RECOGNITION_WORKER_TOKEN"] = "test-token"
        os.environ["RECOGNITION_ALLOWED_IMAGE_HOSTS"] = "example.supabase.co"

    def test_contract_validation(self):
        payload = {
            "asset_id": "asset_1",
            "images": [
                {
                    "image_id": "front",
                    "role": "front_original",
                    "signed_url": "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
                }
            ],
            "requested_fields": ["serial_number"],
            "options": {"run_ocr": True},
        }
        self.assertEqual(validate_request(payload), [])
        self.assertTrue(validate_request({**payload, "images": []}))

    def test_security(self):
        verify_bearer_token("Bearer test-token", "test-token")
        with self.assertRaises(SecurityError):
            verify_bearer_token("Bearer wrong", "test-token")
        self.assertEqual(
            validate_image_url(
                "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
                UrlPolicy(["example.supabase.co"]),
            ),
            "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
        )
        with self.assertRaises(SecurityError):
            validate_image_url("http://example.supabase.co/card.jpg", UrlPolicy(["example.supabase.co"]))
        self.assertNotIn("token=secret", redact_url("https://example.supabase.co/path/card.jpg?token=secret"))

    def test_field_parsers(self):
        self.assertEqual(parse_serial("01 / 10").normalized, "1/10")
        self.assertEqual(parse_serial("257/208").valid, False)
        self.assertEqual(parse_collector_number("#136").normalized, "136")
        self.assertEqual(parse_checklist_code("uv 16").normalized, "UV-16")
        grade = parse_grade("PSA 9/10")
        self.assertEqual(grade["card_grade"], "9")
        self.assertEqual(grade["auto_grade"], "10")
        self.assertEqual(grade["grade_type"], "CARD_AND_AUTO")
        auto_grade = parse_grade("PSA AUTO 10")
        self.assertIsNone(auto_grade["card_grade"])
        self.assertEqual(auto_grade["auto_grade"], "10")

    def test_analyze_payload_placeholder(self):
        payload = {
            "asset_id": "asset_1",
            "images": [
                {
                    "image_id": "front",
                    "role": "front_original",
                    "signed_url": "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
                }
            ],
            "requested_fields": ["serial_number", "grade_label"],
            "options": {"run_ocr": True},
        }
        result = analyze_payload(payload, authorization="Bearer test-token")
        self.assertEqual(result["asset_id"], "asset_1")
        self.assertEqual(result["ocr_evidence"]["status"], "UNAVAILABLE")
        self.assertEqual(result["evidence_fusion"]["status"], "NO_EVIDENCE")
        self.assertFalse(result["glare_detection"]["generative_reconstruction_used"])
        self.assertEqual(result["rectification"]["status"], "UNAVAILABLE")

    def test_ocr_text_fusion_parses_fields_and_conflicts(self):
        ocr_evidence = ocr_evidence_from_items([
            {
                "image_id": "front",
                "role": "front_original",
                "text": "2024 Topps Chrome Shohei Ohtani 31/50",
                "confidence": 0.96,
            },
            {
                "image_id": "back",
                "role": "back_original",
                "text": "31/50 #136 TCAR-CF",
                "confidence": 0.94,
            },
            {
                "image_id": "slab",
                "role": "grade_label_crop",
                "text": "PSA 10",
                "confidence": 0.93,
            },
            {
                "image_id": "front_alt",
                "role": "front_alternate",
                "text": "32/50",
                "confidence": 0.62,
            },
        ])
        fusion = fuse_ocr_evidence(
            ocr_evidence,
            ["serial_number", "collector_number", "checklist_code", "grade_label", "year_product"],
        )

        self.assertEqual(fusion["status"], "CONFLICT")
        self.assertEqual(fusion["resolved_fields"]["serial_number"], "31/50")
        self.assertEqual(fusion["resolved_fields"]["collector_number"], "136")
        self.assertEqual(fusion["resolved_fields"]["checklist_code"], "TCAR-CF")
        self.assertEqual(fusion["resolved_fields"]["year"], "2024")
        self.assertEqual(fusion["resolved_fields"]["grade_company"], "PSA")
        self.assertEqual(fusion["resolved_fields"]["card_grade"], "10")
        self.assertTrue(any(item["field"] == "grade_label" and item["parsed_fields"]["grade_company"] == "PSA" for item in fusion["items"]))
        serial_conflict = next(conflict for conflict in fusion["conflicts"] if conflict["field"] == "serial_number")
        self.assertEqual(serial_conflict["conflict_type"], "OCR_VALUE_CONFLICT")
        self.assertEqual(serial_conflict["severity"], "HIGH")

    def test_r2_rectification_quality_glare_and_regions(self):
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        image[120:920, 115:685] = 210
        image[260:330, 420:520] = 255
        image[500:510, 150:650] = 20

        rectification = rectify_card_from_array(image, image_id="front")
        self.assertEqual(rectification["status"], "OK")
        self.assertGreater(rectification["rectification_confidence"], 0.4)
        self.assertEqual(len(rectification["card_polygon"]), 4)
        self.assertFalse(rectification["fallback_used"])

        glare = detect_glare_from_array(image, image_id="front")
        self.assertEqual(glare["status"], "OK")
        self.assertGreater(glare["glare_score"], 0)
        self.assertFalse(glare["generative_reconstruction_used"])

        quality = measure_image_quality_from_array(image, image_id="front", rectification=rectification, glare=glare)
        self.assertEqual(quality["status"], "OK")
        self.assertIn("laplacian_variance", quality["focus_features"])
        self.assertIsInstance(quality["resolution_sufficient"], bool)

        regions = propose_regions_for_rectified_card(["serial_number", "grade_label"], rectification["rectified_size"], "front")
        self.assertEqual(len(regions), 2)
        self.assertTrue(all(region["polygon"] for region in regions))

    def test_worker_eval_field_metrics(self):
        result = evaluate_worker_items([
            {
                "ground_truth": {
                    "serial_number": "01/10",
                    "collector_number": "136",
                    "checklist_code": "tc ar cf",
                    "grade_company": "PSA",
                    "card_grade": "9",
                    "auto_grade": "10",
                    "grade_type": "CARD_AND_AUTO",
                },
                "prediction": {
                    "resolved_fields": {
                        "serial_number": "1/10",
                        "collector_number": "136",
                        "checklist_code": "TC-AR-CF",
                        "grade_company": "PSA",
                        "card_grade": "9",
                        "auto_grade": "10",
                        "grade_type": "CARD_AND_AUTO",
                    }
                },
            }
        ])
        self.assertEqual(result["total_items"], 1)
        self.assertEqual(result["field_level_accuracy"], 1)
        self.assertEqual(result["field_accuracy"]["serial_number"]["accuracy"], 1)


if __name__ == "__main__":
    unittest.main()
