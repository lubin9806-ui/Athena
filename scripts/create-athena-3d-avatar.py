import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "avatar" / "athena-3d-default" / "model"
OUT_FILE = OUT_DIR / "athena-3d-default.glb"


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def mat(name, color, roughness=0.72):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    try:
        material.use_nodes = True
        bsdf = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            if "Base Color" in bsdf.inputs:
                bsdf.inputs["Base Color"].default_value = color
            if "Roughness" in bsdf.inputs:
                bsdf.inputs["Roughness"].default_value = roughness
    except Exception:
        material.use_nodes = False
    return material


def add_uv_sphere(name, location, scale, material, segments=48, ring_count=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=ring_count, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    return obj


def add_cube(name, location, scale, material):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    bevel = obj.modifiers.new("soft bevel", "BEVEL")
    bevel.width = 0.06
    bevel.segments = 5
    obj.modifiers.new("soft shade", "WEIGHTED_NORMAL")
    return obj


def add_cylinder(name, location, radius, depth, material, vertices=32, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    obj.modifiers.new("soft shade", "WEIGHTED_NORMAL")
    return obj


def add_cone(name, location, radius1, radius2, depth, material, vertices=48, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    obj.modifiers.new("soft shade", "WEIGHTED_NORMAL")
    return obj


def create_avatar():
    reset_scene()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    skin = mat("warm_skin", (0.98, 0.78, 0.64, 1))
    blush = mat("soft_blush", (1.0, 0.45, 0.46, 1))
    hair = mat("soft_black_hair", (0.015, 0.014, 0.016, 1))
    white = mat("white_blouse", (0.94, 0.95, 0.98, 1))
    navy = mat("deep_navy_skirt", (0.015, 0.035, 0.075, 1))
    cyan = mat("athena_cyan_accent", (0.1, 0.72, 0.95, 1))
    silver = mat("silver_hair_clip", (0.72, 0.74, 0.76, 1))
    eye = mat("dark_eye", (0.025, 0.02, 0.018, 1))
    mouth = mat("soft_mouth", (0.75, 0.22, 0.23, 1))

    # Body.
    add_uv_sphere("ATH_HEAD", (0, 0, 2.85), (0.42, 0.36, 0.5), skin)
    add_cylinder("ATH_NECK", (0, 0, 2.31), 0.16, 0.28, skin)
    add_uv_sphere("ATH_TORSO_BLOUSE", (0, 0, 1.85), (0.55, 0.34, 0.58), white)
    add_cone("ATH_SKIRT", (0, 0, 1.25), 0.68, 0.42, 0.56, navy)

    # Pleats and accents.
    for index, x in enumerate([-0.45, -0.25, 0.0, 0.25, 0.45]):
        pleat = add_cube(f"ATH_SKIRT_PLEAT_{index+1:02d}", (x, -0.56, 1.23), (0.035, 0.035, 0.28), navy)
        pleat.rotation_euler[2] = math.radians(x * 10)
    add_cube("ATH_SKIRT_CYAN_ACCENT", (0.46, -0.59, 1.24), (0.08, 0.018, 0.16), cyan)

    # Arms and hands.
    for side, sign in [("L", -1), ("R", 1)]:
        add_cylinder(f"ATH_ARM_UPPER_{side}", (sign * 0.58, 0, 1.86), 0.085, 0.58, skin, rotation=(0, math.radians(18 * sign), 0))
        add_cylinder(f"ATH_ARM_LOWER_{side}", (sign * 0.63, 0, 1.36), 0.075, 0.58, skin, rotation=(0, math.radians(-5 * sign), 0))
        add_uv_sphere(f"ATH_HAND_{side}", (sign * 0.63, 0, 1.03), (0.095, 0.06, 0.12), skin)
        add_cylinder(f"ATH_BLOUSE_SLEEVE_{side}", (sign * 0.47, 0, 2.0), 0.11, 0.22, white, rotation=(0, math.radians(88), 0))

    # Legs, socks, shoes.
    for side, sign in [("L", -1), ("R", 1)]:
        add_cylinder(f"ATH_LEG_{side}", (sign * 0.2, 0, 0.62), 0.095, 1.0, skin)
        add_cylinder(f"ATH_SOCK_{side}", (sign * 0.2, 0, 0.13), 0.102, 0.17, white)
        add_cube(f"ATH_SHOE_{side}", (sign * 0.2, -0.06, -0.02), (0.16, 0.3, 0.065), white)
        add_cube(f"ATH_SHOE_ACCENT_{side}", (sign * 0.2, -0.36, -0.005), (0.11, 0.018, 0.025), cyan)

    # Hair mass and layered strands.
    add_uv_sphere("ATH_HAIR_BACK", (0, 0.06, 2.82), (0.47, 0.4, 0.54), hair)
    add_cube("ATH_HAIR_FRONT_BANGS", (0, -0.34, 3.1), (0.36, 0.06, 0.18), hair)
    for index, x in enumerate([-0.28, -0.12, 0.08, 0.25]):
        strand = add_cone(f"ATH_HAIR_BANG_STRAND_{index+1}", (x, -0.39, 2.9), 0.045, 0.01, 0.42, hair, vertices=16)
        strand.rotation_euler[0] = math.radians(8)
        strand.rotation_euler[2] = math.radians(x * -18)
    for side, sign in [("L", -1), ("R", 1)]:
        side_hair = add_cone(f"ATH_HAIR_SIDE_{side}", (sign * 0.36, -0.07, 2.58), 0.11, 0.04, 0.72, hair, vertices=24)
        side_hair.rotation_euler[2] = math.radians(12 * sign)

    # Face.
    for side, sign in [("L", -1), ("R", 1)]:
        add_uv_sphere(f"ATH_EYE_{side}", (sign * 0.15, -0.34, 2.91), (0.055, 0.018, 0.04), eye, segments=24, ring_count=12)
        add_uv_sphere(f"ATH_BLUSH_{side}", (sign * 0.24, -0.35, 2.78), (0.06, 0.012, 0.03), blush, segments=24, ring_count=8)
    add_cube("ATH_MOUTH_NEUTRAL", (0, -0.37, 2.66), (0.11, 0.01, 0.018), mouth)

    # Outfit details.
    add_cube("ATH_BLOUSE_COLLAR_L", (-0.13, -0.29, 2.2), (0.14, 0.025, 0.06), white)
    add_cube("ATH_BLOUSE_COLLAR_R", (0.13, -0.29, 2.2), (0.14, 0.025, 0.06), white)
    add_cube("ATH_BLOUSE_CYAN_TRIM_L", (-0.18, -0.32, 2.22), (0.12, 0.012, 0.015), cyan)
    add_cube("ATH_BLOUSE_CYAN_TRIM_R", (0.18, -0.32, 2.22), (0.12, 0.012, 0.015), cyan)
    add_cube("ATH_TIE", (0, -0.36, 2.05), (0.055, 0.025, 0.16), navy)
    add_cube("ATH_TIE_PIN", (0, -0.39, 2.17), (0.065, 0.018, 0.045), silver)
    add_cube("ATH_HAIR_CLIP_A", (0.31, -0.32, 3.08), (0.11, 0.018, 0.018), silver)
    clip_b = add_cube("ATH_HAIR_CLIP_B", (0.31, -0.321, 3.08), (0.11, 0.018, 0.018), silver)
    clip_b.rotation_euler[2] = math.radians(55)

    # Rig-friendly empties used by runtime as semantic targets.
    for name, location in {
        "ATH_TARGET_HEAD": (0, -0.42, 2.92),
        "ATH_TARGET_HAIR_CLIP": (0.31, -0.42, 3.08),
        "ATH_TARGET_FACE": (0, -0.42, 2.76),
        "ATH_TARGET_HAND_L": (-0.63, -0.08, 1.03),
        "ATH_TARGET_HAND_R": (0.63, -0.08, 1.03),
    }.items():
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = "SPHERE"
        empty.empty_display_size = 0.08
        empty.location = location
        bpy.context.collection.objects.link(empty)

    # Lighting and camera metadata are useful for manual inspection.
    bpy.ops.object.light_add(type="AREA", location=(0, -3, 4))
    light = bpy.context.object
    light.name = "ATH_PREVIEW_KEY_LIGHT"
    light.data.energy = 450
    light.data.size = 5
    bpy.ops.object.camera_add(location=(0, -5.2, 2.0), rotation=(math.radians(75), 0, 0))
    bpy.context.scene.camera = bpy.context.object

    bpy.ops.export_scene.gltf(
        filepath=str(OUT_FILE),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
    )
    print(f"ATHENA_3D_AVATAR_EXPORTED {OUT_FILE}")


if __name__ == "__main__":
    create_avatar()
