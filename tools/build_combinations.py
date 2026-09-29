#!/usr/bin/env python3
import json, math
from pathlib import Path
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT/"catalog/asset_catalog.json").read_text(encoding="utf-8"))
TEMPLATES = json.loads((ROOT/"templates/scene_combinations.json").read_text(encoding="utf-8"))
BY_ID = {a["id"]: a for a in CATALOG["assets"]}
OUT = ROOT/"models/combinations"
OUT.mkdir(parents=True, exist_ok=True)

def transform_matrix(position, rotation_deg, scale):
    s = float(scale if isinstance(scale, (int,float)) else 1.0)
    S = np.eye(4); S[0,0]=S[1,1]=S[2,2]=s
    a = math.radians(float(rotation_deg or 0))
    c, sn = math.cos(a), math.sin(a)
    R = np.array([[c,0,sn,0],[0,1,0,0],[-sn,0,c,0],[0,0,0,1]], dtype=float)
    T = np.eye(4)
    x,y,z = position
    T[:3,3] = [float(x),float(y),float(z)]
    return T @ R @ S

index=[]
for t in TEMPLATES["templates"]:
    out_scene = trimesh.Scene()
    count=0
    for obj in t["objects"]:
        asset = BY_ID[obj["assetId"]]
        path = ROOT/asset["path"]
        if not path.exists():
            raise FileNotFoundError(path)
        src = trimesh.load(path, force="scene", process=False)
        meshes = src.dump(concatenate=False)
        M = transform_matrix(obj.get("position",[0,0,0]), obj.get("rotationYDeg",0), obj.get("scale",1))
        for mesh in meshes:
            if not isinstance(mesh, trimesh.Trimesh):
                continue
            mesh = mesh.copy()
            mesh.apply_transform(M)
            out_scene.add_geometry(mesh, node_name=f"{obj['assetId']}_{count}")
            count += 1
    out_path = ROOT/t["combinedGlb"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(trimesh.exchange.gltf.export_glb(out_scene, include_normals=True))
    bounds = out_scene.bounds.tolist() if out_scene.bounds is not None else None
    index.append({
        "id": t["id"], "label": t["label"], "category": t["category"],
        "path": t["combinedGlb"], "objectCount": len(t["objects"]),
        "meshCount": count, "bounds": bounds
    })
(OUT/"combined_catalog.json").write_text(json.dumps({"generatedFrom":"templates/scene_combinations.json","count":len(index),"items":index},ensure_ascii=False,indent=2),encoding="utf-8")
print(f"Built {len(index)} combined GLB files in {OUT}")
