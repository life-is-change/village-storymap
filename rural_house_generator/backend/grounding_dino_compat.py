def post_process_grounding_dino(
    processor,
    outputs,
    input_ids,
    *,
    box_threshold: float,
    text_threshold: float,
    target_sizes,
):
    result = processor.post_process_grounded_object_detection(
        outputs,
        input_ids,
        box_threshold=box_threshold,
        text_threshold=text_threshold,
        target_sizes=target_sizes,
    )[0]
    result["text_labels"] = list(
        result.get("text_labels") or result.get("labels") or []
    )
    return result
