from pathlib import Path
import ast
import unittest


LINUX_DIR = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = LINUX_DIR.parent
DOCKERFILE = LINUX_DIR / "Dockerfile.facade-worker"
REQUIREMENTS = LINUX_DIR / "requirements-facade-worker.txt"
CLI = REPOSITORY_ROOT / "server" / "src" / "village_processing" / "__main__.py"


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

    def test_facade_worker_declares_dotenv_dependency(self):
        requirements = REQUIREMENTS.read_text("utf-8")

        self.assertIn("python-dotenv==1.1.0", requirements)

    def test_cli_does_not_import_gis_stack_at_module_load_time(self):
        tree = ast.parse(CLI.read_text("utf-8"))
        top_level_imports = {
            node.module
            for node in tree.body
            if isinstance(node, ast.ImportFrom) and node.level == 1
        }

        self.assertTrue(
            {
                "catalog",
                "raster",
                "processors.osm",
                "processors.contours",
                "contracts",
                "pipeline",
                "preview",
            }.isdisjoint(top_level_imports)
        )


if __name__ == "__main__":
    unittest.main()
