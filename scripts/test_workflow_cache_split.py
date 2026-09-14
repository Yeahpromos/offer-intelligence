from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent


class WorkflowCacheSplitTests(unittest.TestCase):
    def test_payment_workflow_no_longer_rebuilds_caches(self) -> None:
        workflow = (ROOT / ".github/workflows/sync-levanta-payments.yml").read_text(encoding="utf-8")

        self.assertNotIn("refresh_api_caches.py", workflow)
        self.assertNotIn("chatbot_data.js", workflow)
        self.assertNotIn("sheet_report_data.js", workflow)
        self.assertNotIn("product_keywords.js", workflow)
        self.assertIn("output/payment_records.json", workflow)
        self.assertIn("github.repository == 'Yeahpromos/offer-intelligence'", workflow)

    def test_cache_workflow_runs_after_successful_payment_sync(self) -> None:
        workflow = (ROOT / ".github/workflows/refresh-db-caches.yml").read_text(encoding="utf-8")

        self.assertIn("workflow_run:", workflow)
        self.assertIn("- Sync Levanta payments", workflow)
        self.assertIn("workflow_run.conclusion == 'success'", workflow)
        self.assertIn("github.repository == 'Yeahpromos/offer-intelligence'", workflow)
        self.assertIn("protected_data/db_offers_cache.json", workflow)
        self.assertIn("protected_data/db_keywords_cache.json", workflow)

    def test_secret_bearing_cache_workflow_only_executes_main(self) -> None:
        workflow = (ROOT / ".github/workflows/refresh-db-caches.yml").read_text(encoding="utf-8")
        self.assertIn("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'", workflow)
        self.assertIn("ref: main", workflow)
        self.assertIn("CACHE_BRANCH: main", workflow)
        self.assertNotIn("github.ref_name", workflow)
        self.assertNotIn("ref: ${{ env.CACHE_BRANCH }}", workflow)


if __name__ == "__main__":
    unittest.main()
