from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy


def parse_args() -> argparse.Namespace:
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    return parser.parse_args(arguments)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.materials, bpy.data.meshes, bpy.data.images):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def principled_shader(material):
    return next(
        node
        for node in material.node_tree.nodes
        if node.type == "BSDF_PRINCIPLED"
    )


def neutral_material(name: str, color: tuple[float, float, float, float]):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = principled_shader(material)
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = 0.82
    return material


def facade_material(texture_path: Path):
    material = bpy.data.materials.new("Real facade")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = principled_shader(material)
    shader.inputs["Roughness"].default_value = 0.72
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(texture_path), check_existing=False)
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    return material


def add_body(width: float, depth: float, wall_height: float, material) -> None:
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, wall_height / 2))
    body = bpy.context.object
    body.name = "Building body"
    body.dimensions = (width, depth, wall_height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    body.data.materials.append(material)


def add_facade_plane(
    width: float, depth: float, wall_height: float, material
) -> None:
    y = -(depth / 2 + 0.004)
    vertices = [
        (-width / 2, y, 0),
        (-width / 2, y, wall_height),
        (width / 2, y, wall_height),
        (width / 2, y, 0),
    ]
    mesh = bpy.data.meshes.new("Facade mesh")
    mesh.from_pydata(vertices, [], [(0, 1, 2, 3)])
    mesh.update()
    facade = bpy.data.objects.new("Photo facade", mesh)
    bpy.context.collection.objects.link(facade)
    mesh.materials.append(material)
    uv_layer = mesh.uv_layers.new(name="Facade UV")
    uv_coordinates = ((0, 0), (0, 1), (1, 1), (1, 0))
    for loop, coordinates in zip(mesh.polygons[0].loop_indices, uv_coordinates):
        uv_layer.data[loop].uv = coordinates


def add_gable_roof(
    width: float,
    depth: float,
    wall_height: float,
    roof_height: float,
    material,
) -> None:
    eave = 0.18
    half_width = width / 2 + eave
    half_depth = depth / 2 + eave
    ridge_height = wall_height + max(roof_height, 0.25)
    vertices = [
        (-half_width, -half_depth, wall_height),
        (half_width, -half_depth, wall_height),
        (half_width, half_depth, wall_height),
        (-half_width, half_depth, wall_height),
        (0, -half_depth, ridge_height),
        (0, half_depth, ridge_height),
    ]
    faces = [(0, 1, 4), (3, 5, 2), (0, 4, 5, 3), (1, 2, 5, 4)]
    mesh = bpy.data.meshes.new("Gable roof mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    roof = bpy.data.objects.new("Simple gable roof", mesh)
    bpy.context.collection.objects.link(roof)
    mesh.materials.append(material)


def add_flat_roof(
    width: float,
    depth: float,
    wall_height: float,
    roof_height: float,
    material,
) -> None:
    thickness = max(roof_height, 0.2)
    bpy.ops.mesh.primitive_cube_add(
        location=(0, 0, wall_height + thickness / 2)
    )
    roof = bpy.context.object
    roof.name = "Simple flat roof"
    roof.dimensions = (width + 0.25, depth + 0.25, thickness)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    roof.data.materials.append(material)


def add_hipped_roof(
    width: float,
    depth: float,
    wall_height: float,
    roof_height: float,
    material,
) -> None:
    eave = 0.28
    half_width = width / 2 + eave
    half_depth = depth / 2 + eave
    ridge_half = max(0.0, half_width - half_depth)
    ridge_height = wall_height + max(roof_height, 0.35)
    vertices = [
        (-half_width, -half_depth, wall_height),
        (half_width, -half_depth, wall_height),
        (half_width, half_depth, wall_height),
        (-half_width, half_depth, wall_height),
        (-ridge_half, 0, ridge_height),
        (ridge_half, 0, ridge_height),
    ]
    faces = [
        (0, 1, 5, 4),
        (1, 2, 5),
        (2, 3, 4, 5),
        (3, 0, 4),
    ]
    mesh = bpy.data.meshes.new("Hipped roof mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    roof = bpy.data.objects.new("Hipped roof", mesh)
    bpy.context.collection.objects.link(roof)
    mesh.materials.append(material)


def main() -> None:
    args = parse_args()
    config_path = Path(args.config).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    building = config["building"]
    texture_path = Path(config["texture_path"]).resolve()
    output_path = Path(config["output_path"]).resolve()

    clear_scene()
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0

    wall_material = neutral_material(
        "Neutral white shell", (0.82, 0.82, 0.79, 1.0)
    )
    roof_material = neutral_material(
        "Dark grey roof tiles", (0.12, 0.13, 0.14, 1.0)
    )
    photo_material = facade_material(texture_path)

    width = float(building["width"])
    depth = float(building["depth"])
    wall_height = float(building["wall_height"])
    roof_height = float(building["roof_height"])
    add_body(width, depth, wall_height, wall_material)
    add_facade_plane(width, depth, wall_height, photo_material)
    if building["roof_type"] == "flat":
        add_flat_roof(width, depth, wall_height, roof_height, roof_material)
    elif building["roof_type"] == "gable":
        add_gable_roof(width, depth, wall_height, roof_height, roof_material)
    else:
        add_hipped_roof(width, depth, wall_height, roof_height, roof_material)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path = output_path.parent / "model_manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "object_names": sorted(
                    item.name
                    for item in bpy.context.scene.objects
                    if item.type == "MESH"
                ),
                "front_texture": texture_path.name,
                "dimensions": {
                    "width": width,
                    "depth": depth,
                    "height": wall_height,
                },
                "roof": {
                    "type": building["roof_type"],
                    "height": roof_height,
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
    )
    if not output_path.is_file():
        raise RuntimeError("Blender did not create the requested GLB")


if __name__ == "__main__":
    main()
