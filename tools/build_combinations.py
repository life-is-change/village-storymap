#!/usr/bin/env python3
import json
import math
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "catalog/asset_catalog.json").read_text(encoding="utf-8"))
TEMPLATES = json.loads((ROOT / "templates/scene_combinations.json").read_text(encoding="utf-8"))
BY_ID = {a["id"]: a for a in CATALOG["assets"]}
OUT = ROOT / "models/combinations"
OUT.mkdir(parents=True, exist_ok=True)


def as_scale3(value):
    if isinstance(value, (int, float)):
        s = float(value)
        return np.array([s, s, s], dtype=float)
    if isinstance(value, (list, tuple)) and len(value) == 3:
        return np.array([float(v) for v in value], dtype=float)
    return np.ones(3, dtype=float)


def placement_matrix(position, rotation_deg, scale):
    sx, sy, sz = as_scale3(scale)
    S = np.eye(4)
    S[0, 0], S[1, 1], S[2, 2] = sx, sy, sz

    a = math.radians(float(rotation_deg or 0))
    c, sn = math.cos(a), math.sin(a)
    # Source GLBs are treated as Y-up; Blender converts this to its Z-up view.
    R = np.array(
        [[c, 0, sn, 0], [0, 1, 0, 0], [-sn, 0, c, 0], [0, 0, 0, 1]],
        dtype=float,
    )

    T = np.eye(4)
    x, y, z = position
    T[:3, 3] = [float(x), float(y), float(z)]
    return T @ R @ S


def load_component_meshes(path, scene_scale=1.0):
    """Load one source GLB and normalize it to a ground-centered local anchor.

    Scene.dump(concatenate=False) bakes source node transforms into its meshes.
    The union bounds are then shifted so X/Z are centered on the origin and
    the lowest Y point is exactly Y=0. Template positions therefore refer to
    the visible object instead of an arbitrary authoring origin.
    """
    src = trimesh.load(path, force="scene", process=False)
    meshes = [
        m.copy()
        for m in src.dump(concatenate=False)
        if isinstance(m, trimesh.Trimesh)
    ]
    if not meshes:
        raise ValueError(f"No mesh geometry found in {path}")

    mins = np.vstack([m.bounds[0] for m in meshes])
    maxs = np.vstack([m.bounds[1] for m in meshes])
    bmin = mins.min(axis=0)
    bmax = maxs.max(axis=0)
    center = (bmin + bmax) * 0.5

    anchor = np.eye(4)
    anchor[:3, 3] = [-center[0], -bmin[1], -center[2]]

    s = float(scene_scale or 1.0)
    asset_scale = np.eye(4)
    asset_scale[0, 0] = asset_scale[1, 1] = asset_scale[2, 2] = s
    normalize = asset_scale @ anchor

    for mesh in meshes:
        mesh.apply_transform(normalize)

    normalized_size = (bmax - bmin) * s
    return meshes, {
        "sourceBounds": [bmin.tolist(), bmax.tolist()],
        "normalizedSize": normalized_size.tolist(),
        "sceneScale": s,
    }


index = []
for template in TEMPLATES["templates"]:
    out_scene = trimesh.Scene()
    mesh_count = 0
    component_info = []

    for obj_index, obj in enumerate(template["objects"]):
        asset_id = obj["assetId"]
        if asset_id not in BY_ID:
            raise KeyError(f"Unknown assetId {asset_id} in template {template['id']}")

        asset = BY_ID[asset_id]
        path = ROOT / asset["path"]
        if not path.exists():
            raise FileNotFoundError(path)

        meshes, meta = load_component_meshes(path, asset.get("sceneScale", 1.0))
        placement = placement_matrix(
            obj.get("position", [0, 0, 0]),
            obj.get("rotationYDeg", 0),
            obj.get("scale", 1),
        )

        component_name = f"{obj_index:02d}_{asset_id}"
        # Keep a transform-only parent node so a multi-mesh source remains
        # one logical component in Blender/glTF rather than unrelated pieces.
        out_scene.graph.update(frame_to=component_name, matrix=placement)

        for mesh_index, mesh in enumerate(meshes):
            node_name = f"{component_name}__mesh_{mesh_index:02d}"
            geom_name = f"{component_name}__geom_{mesh_index:02d}"
            out_scene.add_geometry(
                mesh,
                node_name=node_name,
                geom_name=geom_name,
                parent_node_name=component_name,
            )
            mesh_count += 1

        component_info.append(
            {
                "assetId": asset_id,
                "label": asset.get("label", asset_id),
                "sceneScale": meta["sceneScale"],
                "normalizedSize": [
                    round(float(v), 4) for v in meta["normalizedSize"]
                ],
                "position": obj.get("position", [0, 0, 0]),
                "rotationYDeg": obj.get("rotationYDeg", 0),
                "scale": obj.get("scale", 1),
            }
        )

    out_path = ROOT / template["combinedGlb"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(
        trimesh.exchange.gltf.export_glb(out_scene, include_normals=True)
    )

    bounds = out_scene.bounds.tolist() if out_scene.bounds is not None else None
    index.append(
        {
            "id": template["id"],
            "label": template["label"],
            "category": template["category"],
            "path": template["combinedGlb"],
            "objectCount": len(template["objects"]),
            "meshCount": mesh_count,
            "bounds": bounds,
            "components": component_info,
        }
    )

(OUT / "combined_catalog.json").write_text(
    json.dumps(
        {
            "generatedFrom": "templates/scene_combinations.json",
            "anchorConvention": "ground-center (X/Z centered, Y bottom = 0)",
            "count": len(index),
            "items": index,
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)
print(f"Built {len(index)} combined GLB files in {OUT}")
