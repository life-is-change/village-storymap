from pathlib import Path
import unittest


REQUIREMENTS = Path(__file__).resolve().parents[1] / "requirements-facade-lama.txt"


class LamaRequirementsTest(unittest.TestCase):
    def test_pillow_pin_is_compatible_with_simple_lama_012(self):
        requirements = REQUIREMENTS.read_text("utf-8")

        self.assertIn("Pillow==9.5.0", requirements)
        self.assertNotIn("Pillow==11.0.0", requirements)


if __name__ == "__main__":
    unittest.main()
