from pathlib import Path
import unittest


LINUX_DIR = Path(__file__).resolve().parents[1]
REQUIREMENTS = LINUX_DIR / "requirements-facade-lama.txt"
DOCKERFILE = LINUX_DIR / "Dockerfile.facade-lama"


class LamaRequirementsTest(unittest.TestCase):
    def test_pillow_pin_is_compatible_with_simple_lama_012(self):
        requirements = REQUIREMENTS.read_text("utf-8")

        self.assertIn("Pillow==9.5.0", requirements)
        self.assertNotIn("Pillow==11.0.0", requirements)

    def test_lama_uses_pinned_cpu_torch_with_resumable_downloads(self):
        dockerfile = DOCKERFILE.read_text("utf-8")

        self.assertIn(
            "pip install --retries 20 --timeout 120 --upgrade pip==25.1.1",
            dockerfile,
        )
        self.assertIn("torch==2.5.1 torchvision==0.20.1", dockerfile)
        self.assertIn("https://download.pytorch.org/whl/cpu", dockerfile)
        self.assertIn("--resume-retries 20", dockerfile)
        self.assertIn("--timeout 120", dockerfile)


if __name__ == "__main__":
    unittest.main()
