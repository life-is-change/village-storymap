import unittest

from rural_house_generator.backend.grounding_dino_compat import (
    post_process_grounding_dino,
)


class Transformers4463Processor:
    def post_process_grounded_object_detection(
        self,
        outputs,
        input_ids,
        *,
        box_threshold,
        text_threshold,
        target_sizes,
    ):
        return [
            {
                "boxes": "boxes",
                "scores": "scores",
                "labels": ["car", "tree"],
            }
        ]


class GroundingDinoCompatibilityTests(unittest.TestCase):
    def test_uses_transformers_4463_threshold_and_label_contract(self):
        result = post_process_grounding_dino(
            Transformers4463Processor(),
            outputs="outputs",
            input_ids="input-ids",
            box_threshold=0.2,
            text_threshold=0.16,
            target_sizes=[(720, 1280)],
        )

        self.assertEqual(result["boxes"], "boxes")
        self.assertEqual(result["scores"], "scores")
        self.assertEqual(result["text_labels"], ["car", "tree"])


if __name__ == "__main__":
    unittest.main()
