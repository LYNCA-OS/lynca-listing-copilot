import os
import unittest
from io import BytesIO
from unittest.mock import patch

import numpy as np
from PIL import Image

from app.contracts import validate_embed_request, validate_request
from app.eval import evaluate_worker_items
from app.main import embed_images_payload, analyze_payload
from app.pipelines.card_rectification import rectify_card_from_array
from app.pipelines.evidence_fusion import fuse_ocr_evidence
from app.pipelines.field_parsers import parse_checklist_code, parse_collector_number, parse_grade, parse_serial
from app.pipelines.glare_detection import detect_glare_from_array
from app.pipelines.image_loader import ImageLoadError, LoadedImage, load_signed_image
from app.pipelines.image_quality import measure_image_quality_from_array
from app.pipelines.multi_card_detection import detect_multi_card_from_array
from app.pipelines.ocr_pipeline import ocr_evidence_from_items, ocr_evidence_from_loaded_images
from app.pipelines.region_proposal import propose_regions_for_rectified_card
from app.pipelines.visual_embeddings import (
    VisualEmbeddingBackendUnavailable,
    embedding_role_for_image_role,
    extract_visual_embeddings,
)
from app.security import SecurityError, UrlPolicy, redact_url, validate_image_url, verify_bearer_token


class RecognitionWorkerTests(unittest.TestCase):
    def setUp(self):
        os.environ["RECOGNITION_WORKER_TOKEN"] = "test-token"
        os.environ["RECOGNITION_ALLOWED_IMAGE_HOSTS"] = "example.supabase.co"
        os.environ["ENABLE_IMAGE_DOWNLOAD"] = "false"
        os.environ["ENABLE_TESSERACT_OCR"] = "false"

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

    def test_embed_contract_validation(self):
        payload = {
            "request_id": "req_1",
            "model_id": "google/siglip2-base-patch16-384",
            "model_revision": "main",
            "preprocessing_version": "card-rectification-v1",
            "images": [
                {
                    "image_id": "front",
                    "role": "front_global",
                    "signed_url": "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
                },
                {
                    "image_id": "back",
                    "role": "back_global",
                    "signed_url": "https://example.supabase.co/storage/v1/object/sign/cards/back.jpg?token=secret",
                },
            ],
        }
        self.assertEqual(validate_embed_request(payload), [])
        duplicate = {**payload, "images": [payload["images"][0], payload["images"][0]]}
        self.assertTrue(any(error["path"].endswith(".role") for error in validate_embed_request(duplicate)))
        bad_role = {**payload, "images": [{**payload["images"][0], "role": "front_original"}]}
        self.assertTrue(validate_embed_request(bad_role))

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
        self.assertFalse(parse_checklist_code("2025-26").valid)
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
        self.assertEqual(result["visual_features"]["status"], "DISABLED")
        self.assertEqual(result["visual_features"]["models"]["primary"]["model_id"], "google/siglip2-base-patch16-384")
        self.assertFalse(result["glare_detection"]["generative_reconstruction_used"])
        self.assertEqual(result["rectification"]["status"], "UNAVAILABLE")

    def test_embed_images_endpoint_returns_batch_embeddings_without_signed_urls(self):
        os.environ["ENABLE_IMAGE_DOWNLOAD"] = "true"
        os.environ["ENABLE_VISUAL_EMBEDDINGS"] = "true"
        front = LoadedImage(
            image_id="front",
            role="front_global",
            url="https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
            content_type="image/jpeg",
            size_bytes=12345,
            width=800,
            height=1000,
            array=np.zeros((1000, 800, 3), dtype=np.uint8),
        )
        back = LoadedImage(
            image_id="back",
            role="back_global",
            url="https://example.supabase.co/storage/v1/object/sign/cards/back.jpg?token=secret",
            content_type="image/jpeg",
            size_bytes=12000,
            width=800,
            height=1000,
            array=np.ones((1000, 800, 3), dtype=np.uint8),
        )
        payload = {
            "request_id": "req_1",
            "model_id": "google/siglip2-base-patch16-384",
            "model_revision": "main",
            "preprocessing_version": "card-rectification-v1",
            "images": [
                {
                    "image_id": "front",
                    "role": "front_global",
                    "signed_url": "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
                    "content_sha256": "a" * 64,
                },
                {
                    "image_id": "back",
                    "role": "back_global",
                    "signed_url": "https://example.supabase.co/storage/v1/object/sign/cards/back.jpg?token=secret",
                    "content_sha256": "b" * 64,
                },
            ],
        }

        def fake_extract(image_loads, config):
            self.assertEqual([image.role for image in image_loads], ["front_global", "back_global"])
            return {
                "status": "OK",
                "features": [
                    {
                        "image_id": "front",
                        "embedding_role": "front_global",
                        "dimensions": 768,
                        "status": "OK",
                        "embedding": [1.0] + [0.0] * 767,
                    },
                    {
                        "image_id": "back",
                        "embedding_role": "back_global",
                        "dimensions": 768,
                        "status": "OK",
                        "embedding": [0.0, 1.0] + [0.0] * 766,
                    },
                ],
            }

        with patch("app.main.load_signed_image", side_effect=[front, back]) as load_mock:
            with patch("app.main.extract_visual_embeddings", side_effect=fake_extract) as extract_mock:
                result = embed_images_payload(payload, authorization="Bearer test-token")

        self.assertEqual(load_mock.call_count, 2)
        extract_mock.assert_called_once()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["model_id"], "google/siglip2-base-patch16-384")
        self.assertEqual([item["role"] for item in result["embeddings"]], ["front_global", "back_global"])
        self.assertTrue(all(item["normalized"] for item in result["embeddings"]))
        self.assertNotIn("token=secret", str(result))

    def test_embed_images_endpoint_differentiates_unavailable_from_no_match(self):
        os.environ["ENABLE_IMAGE_DOWNLOAD"] = "false"
        os.environ["ENABLE_VISUAL_EMBEDDINGS"] = "true"
        payload = {
            "request_id": "req_unavailable",
            "model_id": "google/siglip2-base-patch16-384",
            "model_revision": "main",
            "preprocessing_version": "card-rectification-v1",
            "images": [
                {
                    "image_id": "front",
                    "role": "front_global",
                    "signed_url": "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
                }
            ],
        }

        result = embed_images_payload(payload, authorization="Bearer test-token")

        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "image_download_disabled")
        self.assertNotEqual(result["reason"], "NO_VECTOR_MATCH")

    def test_visual_embedding_contract_is_versioned_and_explicit_when_backend_unavailable(self):
        from app.config import WorkerConfig

        config = WorkerConfig(
            token="test-token",
            allowed_image_hosts=["example.supabase.co"],
            max_image_bytes=1024,
            max_total_pixels=10000,
            request_timeout_seconds=3,
            enable_image_download=True,
            enable_paddleocr=False,
            enable_tesseract_ocr=False,
            enable_opencv_rectification=False,
            enable_visual_embeddings=True,
            visual_embedding_model_id="google/siglip2-base-patch16-384",
            visual_embedding_model_revision="main",
            visual_embedding_preprocessing_version="card-rectification-v1",
            visual_embedding_dimensions=768,
            enable_candidate_verification=False,
            tesseract_language="eng",
            tesseract_psm=11,
            tesseract_timeout_seconds=20,
        )
        loaded = LoadedImage(
            image_id="front",
            role="front_original",
            url="https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
            content_type="image/jpeg",
            size_bytes=12345,
            width=800,
            height=1000,
            array=np.zeros((1000, 800, 3), dtype=np.uint8),
        )

        self.assertEqual(embedding_role_for_image_role("back_original"), "back_global")
        self.assertEqual(embedding_role_for_image_role("front_original"), "front_global")
        def unavailable_embedder(image_loads, config):
            raise VisualEmbeddingBackendUnavailable("embedding_backend_not_installed")

        features = extract_visual_embeddings([loaded], config, embedder=unavailable_embedder)

        self.assertEqual(features["status"], "UNAVAILABLE")
        self.assertEqual(features["reason"], "embedding_backend_not_installed")
        self.assertEqual(features["models"]["primary"]["dimensions"], 768)
        self.assertEqual(features["features"][0]["embedding_role"], "front_global")
        self.assertEqual(features["features"][0]["status"], "UNAVAILABLE")

    def test_visual_embedding_contract_emits_real_backend_vectors(self):
        from app.config import WorkerConfig

        config = WorkerConfig(
            token="test-token",
            allowed_image_hosts=["example.supabase.co"],
            max_image_bytes=1024,
            max_total_pixels=10000,
            request_timeout_seconds=3,
            enable_image_download=True,
            enable_paddleocr=False,
            enable_tesseract_ocr=False,
            enable_opencv_rectification=False,
            enable_visual_embeddings=True,
            visual_embedding_model_id="google/siglip2-base-patch16-384",
            visual_embedding_model_revision="main",
            visual_embedding_preprocessing_version="card-rectification-v1",
            visual_embedding_dimensions=768,
            enable_candidate_verification=False,
            tesseract_language="eng",
            tesseract_psm=11,
            tesseract_timeout_seconds=20,
        )
        loaded = LoadedImage(
            image_id="front",
            role="front_original",
            url="https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
            content_type="image/jpeg",
            size_bytes=12345,
            width=800,
            height=1000,
            array=np.zeros((1000, 800, 3), dtype=np.uint8),
        )

        def fake_embedder(image_loads, config):
            self.assertEqual(len(image_loads), 1)
            return [[1.0] + [0.0] * 767]

        features = extract_visual_embeddings([loaded], config, embedder=fake_embedder)

        self.assertEqual(features["status"], "OK")
        self.assertEqual(features["features"][0]["status"], "OK")
        self.assertEqual(features["features"][0]["dimensions"], 768)
        self.assertEqual(len(features["features"][0]["embedding"]), 768)
        self.assertEqual(features["features"][0]["embedding_role"], "front_global")

    def test_safe_image_loader_reads_bounded_signed_image(self):
        image = Image.new("RGB", (32, 48), color=(210, 210, 210))
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        data = buffer.getvalue()

        class FakeResponse:
            status = 200
            headers = {
                "content-type": "image/png",
                "content-length": str(len(data)),
            }

            def __init__(self, payload: bytes):
                self.payload = BytesIO(payload)

            def read(self, size: int = -1) -> bytes:
                return self.payload.read(size)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

        def fake_urlopen(request, timeout):
            self.assertEqual(timeout, 3)
            self.assertIn("front.png", request.full_url)
            return FakeResponse(data)

        loaded = load_signed_image(
            {
                "image_id": "front",
                "role": "front_original",
                "signed_url": "https://example.supabase.co/storage/v1/object/sign/cards/front.png?token=secret",
            },
            allowed_hosts=["example.supabase.co"],
            max_bytes=1024 * 1024,
            max_total_pixels=10000,
            timeout_seconds=3,
            urlopen_impl=fake_urlopen,
        )

        self.assertEqual(loaded.image_id, "front")
        self.assertEqual(loaded.width, 32)
        self.assertEqual(loaded.height, 48)
        self.assertEqual(loaded.array.shape, (48, 32, 3))

        with self.assertRaises(ImageLoadError):
            load_signed_image(
                {
                    "image_id": "front",
                    "role": "front_original",
                    "signed_url": "https://example.supabase.co/storage/v1/object/sign/cards/front.png?token=secret",
                },
                allowed_hosts=["example.supabase.co"],
                max_bytes=8,
                max_total_pixels=10000,
                timeout_seconds=3,
                urlopen_impl=fake_urlopen,
            )

    def test_analyze_payload_uses_loaded_image_for_quality_geometry(self):
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        image[120:920, 115:685] = 210
        loaded = LoadedImage(
            image_id="front",
            role="front_original",
            url="https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
            content_type="image/jpeg",
            size_bytes=12345,
            width=800,
            height=1000,
            array=image,
        )
        os.environ["ENABLE_IMAGE_DOWNLOAD"] = "true"
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

        with patch("app.main.load_signed_image", return_value=loaded):
            result = analyze_payload(payload, authorization="Bearer test-token")

        self.assertEqual(result["rectification"]["status"], "OK")
        self.assertEqual(result["image_quality"]["status"], "OK")
        self.assertEqual(result["glare_detection"]["status"], "OK")
        self.assertEqual(result["multi_card_detection"]["status"], "OK")
        self.assertFalse(result["multi_card_detection"]["multi_card"])
        self.assertEqual(result["processing"]["image_download"]["images"][0]["width"], 800)
        self.assertTrue(result["regions"])

    def test_multi_card_detection_flags_two_card_photo(self):
        image = np.zeros((1000, 1300, 3), dtype=np.uint8)
        image[120:540, 120:420] = 210
        image[160:580, 680:980] = 215

        detection = detect_multi_card_from_array(image, image_id="front", role="front_original")

        self.assertEqual(detection["status"], "OK")
        self.assertTrue(detection["multi_card"])
        self.assertEqual(detection["card_count_estimate"], 2)
        self.assertGreaterEqual(detection["confidence"], 0.72)
        self.assertEqual(len(detection["candidates"]), 2)

    def test_analyze_payload_can_run_tesseract_adapter_on_loaded_images(self):
        front = LoadedImage(
            image_id="front",
            role="front_original",
            url="https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
            content_type="image/jpeg",
            size_bytes=12345,
            width=800,
            height=1000,
            array=np.zeros((1000, 800, 3), dtype=np.uint8),
        )
        back = LoadedImage(
            image_id="back",
            role="back_original",
            url="https://example.supabase.co/storage/v1/object/sign/cards/back.jpg?token=secret",
            content_type="image/jpeg",
            size_bytes=12000,
            width=800,
            height=1000,
            array=np.zeros((1000, 800, 3), dtype=np.uint8),
        )
        os.environ["ENABLE_IMAGE_DOWNLOAD"] = "true"
        os.environ["ENABLE_TESSERACT_OCR"] = "true"
        payload = {
            "asset_id": "asset_1",
            "images": [
                {
                    "image_id": "front",
                    "role": "front_original",
                    "signed_url": "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
                },
                {
                    "image_id": "back",
                    "role": "back_original",
                    "signed_url": "https://example.supabase.co/storage/v1/object/sign/cards/back.jpg?token=secret",
                },
            ],
            "requested_fields": ["serial_number", "grade_label"],
            "options": {"run_ocr": True},
        }

        with patch("app.main.load_signed_image", side_effect=[front, back]) as load_mock:
            with patch("app.main.ocr_evidence_from_loaded_images", return_value=ocr_evidence_from_items([
                {
                    "image_id": "back",
                    "role": "back_original",
                    "text": "05/50",
                    "confidence": 0.91,
                },
                {
                    "image_id": "front",
                    "role": "grade_label_crop",
                    "text": "PSA 9",
                    "confidence": 0.93,
                },
            ])) as ocr_mock:
                result = analyze_payload(payload, authorization="Bearer test-token")

        self.assertEqual(load_mock.call_count, 2)
        ocr_mock.assert_called_once()
        self.assertEqual(len(ocr_mock.call_args.args[0]), 2)
        self.assertEqual(ocr_mock.call_args.kwargs["focused_fields"], ["serial_number", "grade_label"])
        self.assertEqual(result["processing"]["model_versions"]["tesseract"], "enabled")
        self.assertEqual(result["ocr_evidence"]["status"], "OK")
        self.assertEqual(result["evidence_fusion"]["resolved_fields"]["serial_number"], "5/50")
        self.assertEqual(result["evidence_fusion"]["resolved_fields"]["grade_company"], "PSA")
        self.assertEqual(result["evidence_fusion"]["resolved_fields"]["card_grade"], "9")

    def test_tesseract_adapter_runs_focused_serial_crop(self):
        loaded = LoadedImage(
            image_id="front",
            role="front_original",
            url="https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret",
            content_type="image/jpeg",
            size_bytes=12345,
            width=800,
            height=1000,
            array=np.zeros((1000, 800, 3), dtype=np.uint8),
        )
        tsv = "\n".join([
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
            "5\t1\t1\t1\t1\t1\t10\t10\t20\t10\t90\t31",
            "5\t1\t1\t1\t1\t2\t34\t10\t10\t10\t90\t/",
            "5\t1\t1\t1\t1\t3\t48\t10\t20\t10\t90\t50",
        ])

        with patch("app.pipelines.ocr_pipeline.shutil.which", return_value="/usr/bin/tesseract"):
            with patch("app.pipelines.ocr_pipeline._run_tesseract", return_value=tsv) as run_mock:
                evidence = ocr_evidence_from_loaded_images(
                    [loaded],
                    focused_fields=["serial_number"],
                    timeout_seconds=3,
                )

        self.assertEqual(evidence["status"], "OK")
        self.assertGreaterEqual(run_mock.call_count, 2)
        serial_crop_items = [item for item in evidence["items"] if item["role"] == "serial_crop"]
        self.assertTrue(serial_crop_items)
        self.assertEqual(serial_crop_items[0]["source_type"], "CARD_FRONT")
        self.assertEqual(serial_crop_items[0]["observed_text"], "31 / 50")

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

    def test_ocr_text_fusion_ignores_season_range_and_standalone_noise_numbers(self):
        ocr_evidence = ocr_evidence_from_items([
            {
                "image_id": "back",
                "role": "back_original",
                "text": "2025-26 PANINI PRIZM FIFA SOCCER",
                "confidence": 0.94,
            },
            {
                "image_id": "back",
                "role": "back_original",
                "text": "33",
                "confidence": 0.82,
            },
            {
                "image_id": "back",
                "role": "back_original",
                "text": "No. CL-LM",
                "confidence": 0.88,
            },
            {
                "image_id": "back",
                "role": "back_original",
                "text": "SIGNED: ANGELS-2017 AS FREE AGENT",
                "confidence": 0.88,
            },
            {
                "image_id": "back",
                "role": "back_original",
                "text": "2014 THREW FASTEST PITCH EVER IN AN NPB ALL-STAR GAME FIRED 1-HIT SHO VS ORIX",
                "confidence": 0.88,
            },
        ])
        fusion = fuse_ocr_evidence(
            ocr_evidence,
            ["collector_number", "checklist_code", "year_product"],
        )

        self.assertEqual(fusion["resolved_fields"].get("year"), "2025")
        self.assertEqual(fusion["resolved_fields"].get("checklist_code"), "CL-LM")
        self.assertNotIn("collector_number", fusion["resolved_fields"])
        self.assertFalse(any(item["field"] == "checklist_code" and item["value"] == "2025-26" for item in fusion["items"]))
        self.assertFalse(any(item["field"] == "checklist_code" and item["value"] == "ANGELS-2017" for item in fusion["items"]))
        self.assertFalse(any(item["field"] == "checklist_code" and item["value"] == "1-HIT" for item in fusion["items"]))

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
