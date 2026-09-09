from pathlib import Path
import unittest


DOCKERFILE = Path(__file__).resolve().parents[1] / "Dockerfile.facade-worker"


class FacadeWorkerDownloadsTest(unittest.TestCase):
    def test_bootstraps_pip_before_using_resumable_downloads(self):
        dockerfile = DOCKERFILE.read_text("utf-8")

        self.assertIn(
            "pip install --retries 20 --timeout 120 --upgrade pip==25.1.1",
            dockerfile,
        )
        self.assertIn(
            "pip install --resume-retries 20 --timeout 120 --requirement",
            dockerfile,
        )
        self.assertIn(
            "pip install --resume-retries 20 --timeout 120 /app/server",
            dockerfile,
        )


if __name__ == "__main__":
    unittest.main()
