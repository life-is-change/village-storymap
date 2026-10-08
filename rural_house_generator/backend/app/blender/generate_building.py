from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from rural_house_generator.backend.app.roof_profile import (
    bounded_segment_count,
    resolve_roof_profile,
    should_add_downspouts,
)


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


def generated_roof_material(profile: dict[str, object]):
    material_key = str(profile["material"])
    material = bpy.data.materials.new(f"Roof material {material_key}")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = principled_shader(material)
    roughness = {
        "gray_tile": 0.78,
        "asphalt_shingle": 0.88,
        "terracotta_tile": 0.72,
    }[material_key]
    shader.inputs["Roughness"].default_value = roughness

    size = 128
    base = tuple(float(value) for value in profile["base_color"][:3])
    accent = tuple(float(value) for value in profile["accent_color"][:3])
    pixels: list[float] = []
    course_height = 14 if material_key != "asphalt_shingle" else 11
    unit_width = 28 if material_key != "asphalt_shingle" else 22
    for y in range(size):
        course = y // course_height
        offset = unit_width // 2 if course % 2 else 0
        for x in range(size):
            joint = y % course_height < 2 or (x + offset) % unit_width < 2
            color = accent if joint else base
            variation = 1.0 + (((x * 17 + y * 13) % 9) - 4) * 0.008
            pixels.extend(
                [
                    max(0.0, min(1.0, color[0] * variation)),
                    max(0.0, min(1.0, color[1] * variation)),
                    max(0.0, min(1.0, color[2] * variation)),
                    1.0,
                ]
            )
    image = bpy.data.images.new(f"Roof texture {material_key}", size, size)
    image.pixels.foreach_set(pixels)
    image.pack()
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.extension = "REPEAT"
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.16
    bump.inputs["Distance"].default_value = 0.08
    links.new(texture.outputs["Color"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return material


def assign_roof_uv(mesh, tile_scale: tuple[float, float]) -> None:
    uv_layer = mesh.uv_layers.new(name="Roof UV")
    tile_width, tile_height = tile_scale
    for polygon in mesh.polygons:
        use_x = abs(polygon.normal.y) >= abs(polygon.normal.x)
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            horizontal = vertex.x if use_x else vertex.y
            uv_layer.data[loop_index].uv = (
                horizontal / tile_width,
                vertex.z / tile_height,
            )


def mesh_object(
    name: str,
    vertices,
    faces,
    material,
    *,
    solidify: float = 0.0,
    tile_scale: tuple[float, float] | None = None,
):
    mesh = bpy.data.meshes.new(f"{name} mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    if tile_scale is not None:
        assign_roof_uv(mesh, tile_scale)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    if solidify > 0:
        modifier = obj.modifiers.new("Roof thickness", "SOLIDIFY")
        modifier.thickness = solidify
        modifier.offset = -0.5
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    return obj


def add_box(name: str, center, dimensions, material):
    bpy.ops.mesh.primitive_cube_add(location=center)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def add_cap_between(name: str, start, end, radius: float, material):
    start_vector = Vector(start)
    end_vector = Vector(end)
    direction = end_vector - start_vector
    length = direction.length
    midpoint = (start_vector + end_vector) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=12,
        radius=radius,
        depth=length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(
        direction.normalized()
    )
    obj.data.materials.append(material)
    return obj


def mesh_from_buffers(name: str, vertices, faces, material):
    mesh = bpy.data.meshes.new(f"{name} mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    return obj


def append_box_buffer(vertices, faces, center, axis_x, axis_y, axis_z, dimensions):
    center_v = Vector(center)
    axes = [Vector(axis_x).normalized(), Vector(axis_y).normalized(), Vector(axis_z).normalized()]
    half = [axes[index] * (float(dimensions[index]) / 2) for index in range(3)]
    base = len(vertices)
    vertices.extend(
        tuple(center_v + half[0] * sx + half[1] * sy + half[2] * sz)
        for sx, sy, sz in (
            (-1, -1, -1),
            (1, -1, -1),
            (1, 1, -1),
            (-1, 1, -1),
            (-1, -1, 1),
            (1, -1, 1),
            (1, 1, 1),
            (-1, 1, 1),
        )
    )
    faces.extend(
        tuple(base + index for index in face)
        for face in (
            (0, 1, 2, 3),
            (4, 7, 6, 5),
            (0, 4, 5, 1),
            (1, 5, 6, 2),
            (2, 6, 7, 3),
            (4, 0, 3, 7),
        )
    )


def append_cylinder_buffer(vertices, faces, start, end, radius: float, sections: int = 8):
    start_v, end_v = Vector(start), Vector(end)
    direction = end_v - start_v
    if direction.length <= 1e-6:
        return
    axis = direction.normalized()
    reference = Vector((0, 0, 1)) if abs(axis.z) < 0.92 else Vector((0, 1, 0))
    basis_u = axis.cross(reference).normalized()
    basis_v = axis.cross(basis_u).normalized()
    base = len(vertices)
    for center in (start_v, end_v):
        for index in range(sections):
            angle = 2 * math.pi * index / sections
            vertices.append(
                tuple(center + basis_u * (math.cos(angle) * radius) + basis_v * (math.sin(angle) * radius))
            )
    for index in range(sections):
        following = (index + 1) % sections
        faces.append((base + index, base + following, base + sections + following, base + sections + index))
    faces.append(tuple(base + index for index in reversed(range(sections))))
    faces.append(tuple(base + sections + index for index in range(sections)))


def add_segmented_caps(
    name: str,
    start,
    end,
    radius: float,
    cap_length: float,
    overlap: float,
    maximum: int,
    material,
):
    start_v, end_v = Vector(start), Vector(end)
    direction = end_v - start_v
    count = bounded_segment_count(
        direction.length,
        max(0.05, cap_length - overlap),
        maximum,
    )
    axis = direction.normalized()
    spacing = direction.length / count
    segment_length = min(cap_length, spacing + overlap)
    vertices, faces = [], []
    for index in range(count):
        center = start_v + axis * ((index + 0.5) * spacing)
        append_cylinder_buffer(
            vertices,
            faces,
            center - axis * (segment_length / 2),
            center + axis * (segment_length / 2),
            radius,
        )
    return mesh_from_buffers(name, vertices, faces, material), count


def add_eave_tile_strip(
    name: str,
    start,
    end,
    outward,
    tile_width: float,
    rise: float,
    maximum: int,
    material,
):
    start_v, end_v = Vector(start), Vector(end)
    direction = end_v - start_v
    axis = direction.normalized()
    outward_v = Vector(outward).normalized()
    count = bounded_segment_count(direction.length, tile_width, maximum)
    spacing = direction.length / count
    vertices, faces = [], []
    for index in range(count):
        center = start_v + axis * ((index + 0.5) * spacing) + outward_v * 0.10
        append_box_buffer(
            vertices,
            faces,
            center,
            axis,
            outward_v,
            (0, 0, 1),
            (spacing + 0.025, 0.30, rise),
        )
    return mesh_from_buffers(name, vertices, faces, material), count


def add_u_gutter(name: str, start, end, outward, radius: float, material):
    start_v, end_v = Vector(start), Vector(end)
    outward_v = Vector(outward).normalized()
    vertical = Vector((0, 0, 1))
    sections = 9
    vertices = []
    for center in (start_v, end_v):
        for index in range(sections):
            angle = math.pi + math.pi * index / (sections - 1)
            vertices.append(
                tuple(center + outward_v * (math.cos(angle) * radius) + vertical * (math.sin(angle) * radius))
            )
    faces = []
    for index in range(sections - 1):
        faces.append((index, index + 1, sections + index + 1, sections + index))
    return mesh_from_buffers(name, vertices, faces, material)


def add_downspout(name: str, top, wall_height: float, radius: float, outward, material):
    top_v = Vector(top)
    outward_v = Vector(outward).normalized()
    bottom = Vector((top_v.x, top_v.y, 0.12))
    vertices, faces = [], []
    append_cylinder_buffer(vertices, faces, top_v, bottom, radius)
    append_cylinder_buffer(vertices, faces, bottom, bottom + outward_v * 0.24, radius)
    append_cylinder_buffer(
        vertices,
        faces,
        top_v + Vector((0, 0, -0.08)),
        top_v + Vector((0, 0, 0.06)),
        radius * 1.7,
    )
    return mesh_from_buffers(name, vertices, faces, material)


def add_soffit_ring(
    half_width: float,
    half_depth: float,
    wall_height: float,
    profile: dict[str, object],
    material,
):
    thickness = float(profile["soffit_thickness"])
    eave = float(profile["eave"])
    vertices, faces = [], []
    z = wall_height - thickness / 2
    append_box_buffer(vertices, faces, (0, -half_depth + eave / 2, z), (1, 0, 0), (0, 1, 0), (0, 0, 1), (half_width * 2, eave, thickness))
    append_box_buffer(vertices, faces, (0, half_depth - eave / 2, z), (1, 0, 0), (0, 1, 0), (0, 0, 1), (half_width * 2, eave, thickness))
    append_box_buffer(vertices, faces, (-half_width + eave / 2, 0, z), (1, 0, 0), (0, 1, 0), (0, 0, 1), (eave, max(0.1, half_depth * 2 - eave * 2), thickness))
    append_box_buffer(vertices, faces, (half_width - eave / 2, 0, z), (1, 0, 0), (0, 1, 0), (0, 0, 1), (eave, max(0.1, half_depth * 2 - eave * 2), thickness))
    return mesh_from_buffers("Roof soffit", vertices, faces, material)


def add_perimeter_details(
    half_width: float,
    half_depth: float,
    wall_height: float,
    profile: dict[str, object],
    trim_material,
    include_downspouts: bool,
) -> tuple[list[str], dict[str, int]]:
    fascia_height = float(profile["fascia_height"])
    gutter_radius = float(profile["gutter_radius"])
    details = [
        add_soffit_ring(half_width, half_depth, wall_height, profile, trim_material),
        add_box(
            "Roof fascia front",
            (0, -half_depth, wall_height - fascia_height / 2),
            (half_width * 2, 0.12, fascia_height),
            trim_material,
        ),
        add_box(
            "Roof fascia rear",
            (0, half_depth, wall_height - fascia_height / 2),
            (half_width * 2, 0.12, fascia_height),
            trim_material,
        ),
        add_box(
            "Roof fascia left",
            (-half_width, 0, wall_height - fascia_height / 2),
            (0.12, half_depth * 2, fascia_height),
            trim_material,
        ),
        add_box(
            "Roof fascia right",
            (half_width, 0, wall_height - fascia_height / 2),
            (0.12, half_depth * 2, fascia_height),
            trim_material,
        ),
    ]
    drip_height = float(profile["drip_edge_height"])
    details.extend(
        [
            add_box("Roof drip edge front", (0, -half_depth - 0.04, wall_height - drip_height / 2), (half_width * 2, 0.08, drip_height), trim_material),
            add_box("Roof drip edge rear", (0, half_depth + 0.04, wall_height - drip_height / 2), (half_width * 2, 0.08, drip_height), trim_material),
        ]
    )
    tile_width = float(profile["eave_tile_width"])
    tile_rise = float(profile["eave_tile_rise"])
    max_tiles = int(profile["max_eave_tiles"])
    front_tiles, front_count = add_eave_tile_strip(
        "Roof eave tiles front",
        (-half_width, -half_depth, wall_height + tile_rise / 2),
        (half_width, -half_depth, wall_height + tile_rise / 2),
        (0, -1, 0),
        tile_width,
        tile_rise,
        max_tiles,
        trim_material,
    )
    rear_tiles, rear_count = add_eave_tile_strip(
        "Roof eave tiles rear",
        (-half_width, half_depth, wall_height + tile_rise / 2),
        (half_width, half_depth, wall_height + tile_rise / 2),
        (0, 1, 0),
        tile_width,
        tile_rise,
        max_tiles,
        trim_material,
    )
    details.extend([front_tiles, rear_tiles])
    gutter_z = wall_height - fascia_height - gutter_radius * 0.35
    front_y = -half_depth - gutter_radius
    rear_y = half_depth + gutter_radius
    details.extend(
        [
            add_u_gutter("Roof gutter front", (-half_width, front_y, gutter_z), (half_width, front_y, gutter_z), (0, -1, 0), gutter_radius, trim_material),
            add_u_gutter("Roof gutter rear", (-half_width, rear_y, gutter_z), (half_width, rear_y, gutter_z), (0, 1, 0), gutter_radius, trim_material),
        ]
    )
    if include_downspouts:
        down_radius = float(profile["downspout_radius"])
        offset = float(profile["downspout_offset"])
        details.extend(
            [
                add_downspout("Roof downspout left", (-half_width + offset, front_y, gutter_z), wall_height, down_radius, (0, -1, 0), trim_material),
                add_downspout("Roof downspout right", (half_width - offset, front_y, gutter_z), wall_height, down_radius, (0, -1, 0), trim_material),
            ]
        )
    return [obj.name for obj in details], {
        "eave_tiles": front_count + rear_count,
        "downspouts": 2 if include_downspouts else 0,
    }


def add_hipped_roof(
    width: float,
    depth: float,
    wall_height: float,
    profile: dict[str, object],
    material,
    trim_material,
    include_downspouts: bool,
) -> tuple[list[str], dict[str, int]]:
    eave = float(profile["eave"])
    half_width = width / 2 + eave
    half_depth = depth / 2 + eave
    ridge_height = wall_height + float(profile["height"])
    corners = [
        (-half_width, -half_depth, wall_height),
        (half_width, -half_depth, wall_height),
        (half_width, half_depth, wall_height),
        (-half_width, half_depth, wall_height),
    ]
    if profile["ridge_axis"] == "x":
        ridge_half = max(0.10, half_width - half_depth)
        ridge = [(-ridge_half, 0, ridge_height), (ridge_half, 0, ridge_height)]
        faces = [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4)]
        hip_pairs = [(0, 4), (1, 5), (2, 5), (3, 4)]
    else:
        ridge_half = max(0.10, half_depth - half_width)
        ridge = [(0, -ridge_half, ridge_height), (0, ridge_half, ridge_height)]
        faces = [(0, 1, 4), (1, 2, 5, 4), (2, 3, 5), (3, 0, 4, 5)]
        hip_pairs = [(0, 4), (1, 4), (2, 5), (3, 5)]
    vertices = corners + ridge
    surface = mesh_object(
        "Roof surface",
        vertices,
        faces,
        material,
        solidify=float(profile["surface_thickness"]),
        tile_scale=tuple(profile["tile_scale"]),
    )
    radius = float(profile["ridge_radius"])
    objects = [surface.name]
    ridge_caps, ridge_count = add_segmented_caps(
        "Roof ridge caps",
        ridge[0],
        ridge[1],
        radius,
        float(profile["ridge_cap_length"]),
        float(profile["ridge_cap_overlap"]),
        int(profile["max_ridge_caps"]),
        trim_material,
    )
    objects.append(ridge_caps.name)
    hip_count = 0
    for index, (corner_index, ridge_index) in enumerate(hip_pairs, start=1):
        caps, count = add_segmented_caps(
            f"Roof hip ridge caps {index}",
            vertices[corner_index],
            vertices[ridge_index],
            radius * 0.84,
            float(profile["ridge_cap_length"]),
            float(profile["ridge_cap_overlap"]),
            int(profile["max_ridge_caps"]),
            trim_material,
        )
        objects.append(caps.name)
        hip_count += count
    for index, corner in enumerate(corners, start=1):
        objects.append(
            add_box(
                f"Roof edge closure {index}",
                (corner[0], corner[1], wall_height - 0.02),
                (0.18, 0.18, 0.18),
                trim_material,
            ).name
        )
    perimeter, detail_counts = add_perimeter_details(
        half_width,
        half_depth,
        wall_height,
        profile,
        trim_material,
        include_downspouts,
    )
    objects.extend(perimeter)
    detail_counts.update({
        "ridge_caps": ridge_count,
        "hip_ridge_caps": hip_count,
        "edge_closures": 4,
    })
    return objects, detail_counts


def add_gable_roof(
    width: float,
    depth: float,
    wall_height: float,
    profile: dict[str, object],
    material,
    trim_material,
    wall_material,
    include_downspouts: bool,
) -> tuple[list[str], dict[str, int]]:
    eave = float(profile["eave"])
    half_width = width / 2 + eave
    half_depth = depth / 2 + eave
    ridge_height = wall_height + float(profile["height"])
    corners = [
        (-half_width, -half_depth, wall_height),
        (half_width, -half_depth, wall_height),
        (half_width, half_depth, wall_height),
        (-half_width, half_depth, wall_height),
    ]
    if profile["ridge_axis"] == "x":
        ridge = [(-half_width, 0, ridge_height), (half_width, 0, ridge_height)]
        faces = [(0, 1, 5, 4), (3, 4, 5, 2)]
    else:
        ridge = [(0, -half_depth, ridge_height), (0, half_depth, ridge_height)]
        faces = [(0, 4, 5, 3), (1, 2, 5, 4)]
    surface = mesh_object(
        "Roof surface",
        corners + ridge,
        faces,
        material,
        solidify=float(profile["surface_thickness"]),
        tile_scale=tuple(profile["tile_scale"]),
    )
    objects = [surface.name]
    ridge_caps, ridge_count = add_segmented_caps(
        "Roof ridge caps",
        ridge[0],
        ridge[1],
        float(profile["ridge_radius"]),
        float(profile["ridge_cap_length"]),
        float(profile["ridge_cap_overlap"]),
        int(profile["max_ridge_caps"]),
        trim_material,
    )
    objects.append(ridge_caps.name)
    if profile["ridge_axis"] == "x":
        gable_paths = [
            ((-half_width, -half_depth, wall_height), (-half_width, 0, ridge_height), (-half_width, half_depth, wall_height)),
            ((half_width, -half_depth, wall_height), (half_width, 0, ridge_height), (half_width, half_depth, wall_height)),
        ]
    else:
        gable_paths = [
            ((-half_width, -half_depth, wall_height), (0, -half_depth, ridge_height), (half_width, -half_depth, wall_height)),
            ((-half_width, half_depth, wall_height), (0, half_depth, ridge_height), (half_width, half_depth, wall_height)),
        ]
    for index, path in enumerate(gable_paths, start=1):
        vertices_buffer, faces_buffer = [], []
        append_cylinder_buffer(vertices_buffer, faces_buffer, path[0], path[1], float(profile["ridge_radius"]) * 0.72)
        append_cylinder_buffer(vertices_buffer, faces_buffer, path[1], path[2], float(profile["ridge_radius"]) * 0.72)
        objects.append(
            mesh_from_buffers(
                f"Roof gable edge closure {index}",
                vertices_buffer,
                faces_buffer,
                trim_material,
            ).name
        )
    if profile["ridge_axis"] == "x":
        gable_infills = [
            (
                (-width / 2, -depth / 2, wall_height),
                (-width / 2, depth / 2, wall_height),
                (-width / 2, 0, ridge_height),
            ),
            (
                (width / 2, depth / 2, wall_height),
                (width / 2, -depth / 2, wall_height),
                (width / 2, 0, ridge_height),
            ),
        ]
    else:
        gable_infills = [
            (
                (width / 2, -depth / 2, wall_height),
                (-width / 2, -depth / 2, wall_height),
                (0, -depth / 2, ridge_height),
            ),
            (
                (-width / 2, depth / 2, wall_height),
                (width / 2, depth / 2, wall_height),
                (0, depth / 2, ridge_height),
            ),
        ]
    for index, vertices in enumerate(gable_infills, start=1):
        objects.append(
            mesh_object(
                f"Roof gable wall infill {index}",
                vertices,
                [(0, 1, 2)],
                wall_material,
                solidify=0.08,
            ).name
        )
    perimeter, detail_counts = add_perimeter_details(
        half_width,
        half_depth,
        wall_height,
        profile,
        trim_material,
        include_downspouts,
    )
    objects.extend(perimeter)
    detail_counts.update({
        "ridge_caps": ridge_count,
        "hip_ridge_caps": 0,
        "edge_closures": 2,
        "gable_infills": 2,
    })
    return objects, detail_counts


def add_flat_roof(
    width: float,
    depth: float,
    wall_height: float,
    profile: dict[str, object],
    material,
    trim_material,
) -> tuple[list[str], dict[str, int]]:
    slab_height = float(profile["height"])
    parapet_height = float(profile["parapet_height"])
    coping_width = float(profile["coping_width"])
    surface = add_box(
        "Roof surface",
        (0, 0, wall_height + slab_height / 2),
        (width + 0.20, depth + 0.20, slab_height),
        material,
    )
    z = wall_height + slab_height + parapet_height / 2
    coping_z = wall_height + slab_height + parapet_height + 0.06
    wall_thickness = 0.18
    objects = [surface.name]
    specs = [
        ("front", (0, -depth / 2, z), (width, wall_thickness, parapet_height)),
        ("rear", (0, depth / 2, z), (width, wall_thickness, parapet_height)),
        ("left", (-width / 2, 0, z), (wall_thickness, depth, parapet_height)),
        ("right", (width / 2, 0, z), (wall_thickness, depth, parapet_height)),
    ]
    for side, center, dimensions in specs:
        objects.append(
            add_box(f"Roof parapet {side}", center, dimensions, trim_material).name
        )
        coping_dimensions = (
            dimensions[0] + coping_width
            if dimensions[0] > dimensions[1]
            else coping_width,
            dimensions[1] + coping_width
            if dimensions[1] > dimensions[0]
            else coping_width,
            0.12,
        )
        objects.append(
            add_box(
                f"Roof coping {side}",
                (center[0], center[1], coping_z),
                coping_dimensions,
                trim_material,
            ).name
        )
    return objects, {
        "ridge_caps": 0,
        "hip_ridge_caps": 0,
        "eave_tiles": 0,
        "downspouts": 0,
        "edge_closures": 0,
    }


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
    photo_material = facade_material(texture_path)

    width = float(building["width"])
    depth = float(building["depth"])
    wall_height = float(building["wall_height"])
    roof_height = float(building["roof_height"])
    profile = resolve_roof_profile(
        width=width,
        depth=depth,
        wall_height=wall_height,
        roof_type=str(building["roof_type"]),
        roof_pitch=str(building.get("roof_pitch", "standard")),
        roof_material=str(building.get("roof_material", "gray_tile")),
    )
    profile["height"] = roof_height
    include_downspouts = should_add_downspouts(config.get("roof_analysis"))
    roof_surface_material = generated_roof_material(profile)
    roof_trim_material = neutral_material(
        "Roof ridge and trim", tuple(profile["accent_color"])
    )
    add_body(width, depth, wall_height, wall_material)
    add_facade_plane(width, depth, wall_height, photo_material)
    if building["roof_type"] == "flat":
        roof_objects, roof_detail_counts = add_flat_roof(
            width,
            depth,
            wall_height,
            profile,
            roof_surface_material,
            roof_trim_material,
        )
    elif building["roof_type"] == "gable":
        roof_objects, roof_detail_counts = add_gable_roof(
            width,
            depth,
            wall_height,
            profile,
            roof_surface_material,
            roof_trim_material,
            wall_material,
            include_downspouts,
        )
    else:
        roof_objects, roof_detail_counts = add_hipped_roof(
            width,
            depth,
            wall_height,
            profile,
            roof_surface_material,
            roof_trim_material,
            include_downspouts,
        )

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
                    "material": profile["material"],
                    "pitch": profile["pitch"],
                    "pitch_degrees": profile["pitch_degrees"],
                    "height": roof_height,
                    "objects": sorted(roof_objects),
                    "detail_counts": roof_detail_counts,
                    "analysis": config.get("roof_analysis"),
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
