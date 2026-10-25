"""Reuse the workstation's loaded detector/SAM and shared GPU lock."""
from pathlib import Path
import json
import numpy as np
import cv2


def detect_components(runtime, rgb):
    height, width = rgb.shape[:2]
    found = []
    groups = [
        ('building. window. door. balcony. roof.', .24),
        ('stone balustrade. metal railing. air conditioner.', .26),
        ('column. pillar. solid balcony parapet. roller shutter. open passage. roof vent.', .27)]
    names = [('air conditioner', 'air_conditioner'), ('balustrade', 'railing'), ('railing', 'railing'),
             ('parapet', 'parapet'), ('shutter', 'shutter'), ('passage', 'passage'), ('vent', 'roof_vent'),
             ('column', 'column'), ('pillar', 'column'), ('window', 'window'), ('door', 'door'),
             ('balcony', 'balcony'), ('roof', 'roof'), ('building', 'building')]
    for prompt, threshold in groups:
        boxes, scores, labels = runtime._detect(rgb, prompt, threshold, .18)
        for box, score, label in zip(boxes, scores, labels):
            kind = next((kind for text, kind in names if text in label.lower()), None)
            normalized = np.clip(box / [width, height, width, height], 0, 1).tolist()
            if kind and normalized[2]-normalized[0] > .012 and normalized[3]-normalized[1] > .015:
                item = {'kind': kind, 'box': normalized, 'score': round(float(score), 4), 'source': 'grounding-dino-base'}
                if kind == 'railing': item['style'] = 'metal' if 'metal' in label else 'stone'
                found.append(item)
    found = sorted(found, key=lambda item: item['score'], reverse=True)[:90]
    runtime.sam.set_image(rgb)
    for item in found:
        if item['kind'] not in ('building', 'window', 'door', 'roof'): continue
        box = np.array(item['box']) * [width, height, width, height]
        masks, scores, _ = runtime.sam.predict(box=box[None, :], multimask_output=True)
        masks = np.asarray(masks).reshape(-1, height, width)
        mask = masks[int(np.argmax(np.asarray(scores).ravel()))].astype('uint8')
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            contour = cv2.approxPolyDP(max(contours, key=cv2.contourArea), 3, True)
            item['mask_contour'] = [[round(float(x)/width, 5), round(float(y)/height, 5)] for x, y in contour[:, 0]][:160]
            item['source'] += '+sam2.1'
    buildings = [item for item in found if item['kind'] == 'building']
    if not buildings: raise ValueError('没有识别到完整建筑主体')
    primary = max(buildings, key=lambda d: (d['box'][2]-d['box'][0])*(d['box'][3]-d['box'][1]))
    return {'feature_version': 3, 'building_box': primary['box'], 'detections': found,
            'sam_available': True, 'device': runtime.device,
            'component_retrieval': {'available': False, 'reason': 'not-required-for-platform-integration'}}


def subtract_protected(occlusion, protected):
    return np.where(protected > 0, 0, occlusion).astype('uint8')
