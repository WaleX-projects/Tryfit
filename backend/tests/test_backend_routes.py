import sys
import unittest
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from routers.image import ImageRequest
from routers.webhook import build_webhook_message


class BackendRouteTests(unittest.TestCase):
    def test_image_request_accepts_optional_client_id(self):
        request = ImageRequest(
            src_file_url="https://example.com/source.jpg",
            ref_file_url="https://example.com/reference.jpg",
            client_id="client-123",
        )

        self.assertEqual(request.client_id, "client-123")
        self.assertEqual(request.garment_category, "full_body")
        self.assertTrue(request.change_shoes)

    def test_build_webhook_message_uses_task_status_and_result_url(self):
        payload = {
            "status": "completed",
            "data": {
                "task_id": "task-42",
                "task_status": "COMPLETED",
                "results": {"url": "https://example.com/result.jpg"},
                "error": None,
            },
        }

        message = build_webhook_message(payload)

        self.assertEqual(message["status"], "completed")
        self.assertEqual(message["data"]["results"]["url"], "https://example.com/result.jpg")
        self.assertEqual(message["data"]["task_status"], "COMPLETED")


if __name__ == "__main__":
    unittest.main()
