import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from policypulse import config
from policypulse.memory import Memory
from policypulse.pipeline import run_agent
from policypulse.search import run_search
from policypulse.server import _is_allowed_origin


class PolicyPulseRegressionTests(unittest.TestCase):
    def test_official_detector_uses_hostname_only(self):
        self.assertTrue(config.is_official("https://www.gov.uk/skilled-worker-visa"))
        self.assertTrue(config.is_official("https://service.gov.au/example"))
        self.assertTrue(config.is_official("https://www.bamf.de/example"))
        self.assertFalse(config.is_official("https://example.com/path/.gov.uk/fake"))
        self.assertFalse(config.is_official("https://govindustries.com/example"))

    def test_invalid_provider_is_client_error(self):
        with self.assertRaisesRegex(ValueError, "Unknown provider"):
            run_search("German student visa rules", "bogus")

    def test_memory_corruption_fails_loudly(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "memory.json"
            path.write_text("{not-json")
            with self.assertRaisesRegex(RuntimeError, "Memory file is corrupt"):
                Memory(str(path))

    def test_pipeline_refuses_alert_without_official_sources(self):
        source_result = {
            "sources": [
                {"url": "https://example.com/a", "title": "A", "type": "source", "key_info": "x"},
                {"url": "https://example.com/b", "title": "B", "type": "source", "key_info": "y"},
            ],
            "summary": "",
            "provider": "tavily",
        }
        reason_result = {
            "json": {"key_findings": ["finding"], "confidence": 0.9},
            "data": {},
            "attempts": 1,
            "valid": True,
        }
        with patch("policypulse.pipeline.search_with_source_policy", return_value=source_result), \
             patch("policypulse.pipeline.call_json", return_value=reason_result):
            with self.assertRaisesRegex(RuntimeError, "no official sources"):
                run_agent("German student visa work rules", memory=Memory(), log=lambda *_: None)

    def test_origin_allowlist_is_exact(self):
        self.assertTrue(_is_allowed_origin(""))
        self.assertTrue(_is_allowed_origin("http://127.0.0.1:5173"))
        self.assertFalse(_is_allowed_origin("http://127.0.0.1:9999"))
        self.assertFalse(_is_allowed_origin("https://evil.example"))


if __name__ == "__main__":
    unittest.main()
