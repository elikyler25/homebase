# Game art setup sheet

Practical companion to `game-art-pipeline.md` (that one is the *why*, this is the *do*).
Work top to bottom.

---

## 1. Rodin presets

All parameters below are from the [Hyper3D Gen-2.5 API spec](https://developer.hyper3d.ai/api-specification/rodin-gen2.5.md).
Defaults are marked — most "bad paint quality" is a default left alone.

### The four presets

| | **Hero** (close-up) | **Production** (default) | **Blockout** (fast) | **Character to rig** |
|---|---|---|---|---|
| `tier` | `Gen-2.5-Extreme-High` | `Gen-2.5-High` | `Gen-2.5-Low` | `Gen-2.5-High` |
| `texture_mode` | `high` | `high` | `medium` | `high` |
| `hd_texture` | `true` | `true` | `false` | `true` |
| `addons` | `["HighPack"]` | `["HighPack"]` | `[]` | `["HighPack"]` |
| `mesh_mode` | `Quad` | `Quad` | `Raw` | `Quad` |
| `is_micro` | `true` | — | — | — |
| `TAPose` | — | — | — | `true` |
| `geometry_instruct_mode` | `faithful` | `faithful` | `creative` | `faithful` |
| `geometry_file_format` | `glb` | `glb` | `glb` | `glb` |
| `material` | `PBR` | `PBR` | `PBR` | `PBR` |

**Start with Production.** Promote to Hero only when the asset is seen close up —
Extreme-High bills at roughly double, and HighPack + Quad multiplies face count ~16×.

### The three settings that fix "low paint quality"

1. **`texture_mode: high`** — this is almost certainly your problem. It's a *separate quality
   ladder from `tier`* (`legacy` → `extreme-low` → `low` → `medium` → `high`). You can run
   Gen-2.5-High geometry with a weak texture mode and get exactly the good-mesh/flat-paint
   result. Nothing else on this page matters as much.
2. **`addons: ["HighPack"]`** — 4K textures instead of the default 2K. Straight 2× resolution.
3. **`hd_texture: true`** — post-processing pass. Cheap, default is `false`.

### Settings people get wrong

- **`texture_delight`** (default `false`) — strips lighting from the **input image**, not the
  output. Turn it on **only** if your reference photo has strong baked shadows. If you feed
  flat concept art, leaving it on can wash out your own intentional shading.
- **`material`** already defaults to `PBR`. Don't switch to `Shaded` for a Blender/engine
  pipeline — that's baked lighting and it will fight your scene lights.
- **`geometry_instruct_mode`** defaults to `creative`, which will drift from your reference.
  Use `faithful` whenever you're matching concept art. (`creative` is only available on
  Medium/High/Extreme-High tiers.)
- **`mesh_mode`** defaults to `Raw` (triangles). Anything that will be rigged or deformed
  needs `Quad`.
- **`seed`** (0–65535) — set it. Otherwise you can't reproduce a result you liked.

### Export format: use GLB

`glb` is the default and the right answer for Blender. GLB carries colorspace metadata and
packs occlusion/roughness/metallic correctly, so Blender's importer wires it up properly.
FBX and OBJ **do not**, which means you inherit the colorspace bug in §2 and have to fix it
by hand every time. Only use FBX if a specific engine step demands it.

### Multi-view input

`image_label` accepts directional tags matching your upload order:
`F, FL, FR, L, R, B, BL, BR, U, D`.

Feeding 2–4 labeled views beats a single view by a wide margin — the reference pins shape and
proportion, so the model only has to infer what it can't see. If you're generating concept art
first (nano banana / Flux), generate a consistent turnaround and label it.

### The re-texture loop

There's a **separate Generate Texture endpoint** that re-textures an *existing* mesh:
pass a model file (≤10MB) + reference image + optional prompt, with `resolution: High`.
**0.5 credits per call.**

This means you never have to re-roll geometry to fix paint. Keep a mesh you like, iterate on
texture alone. That's the tight loop:

```
generate mesh once  →  re-texture  →  render  →  look at it  →  adjust prompt  →  re-texture
```

---

## 2. Blender setup

### Color management (do this once, per scene or in your startup file)

Blender 4.x defaults to **AgX**, which is deliberately flat. A large share of "my textures
look washed out" is just this — not your textures.

- **Render Properties → Color Management → Look → `AgX - High Contrast`**
- Do **not** switch View Transform to `Standard`. It clips everything above 1.0 to flat white.
- **Raise your light intensity.** AgX expects more light energy; weak lamps park midtones low
  on the curve, which *is* the muddy look.
- Going stylized / hand-painted? **`Filmic`** is often better than AgX — it doesn't shift hues,
  so it preserves the saturation stylized work depends on.

### Lighting

Perceived material quality depends more on the lighting environment than on texture
resolution. A generated asset under one default point light looks bad no matter what.

Grab an HDRI from **[Poly Haven](https://polyhaven.com)** (CC0) and use it as world lighting.
Blender MCP can download these directly into the scene.

### The colorspace bug (FBX/OBJ imports)

Roughness, metallic, and normal maps must be **Non-Color**. On FBX/OBJ import Blender loads
them as **sRGB**, which puts a gamma curve on data that isn't color. Result: uniformly
plasticky surfaces with no roughness variation. It's silent and constant.

GLB usually handles this. The script in §3 fixes it either way.

---

## 3. The fixer script

Paste into Blender's Scripting tab and run with your imported objects selected
(or run on everything — it defaults to all materials).

```python
"""Fix Rodin/GLB/FBX imports: colorspaces, normal map nodes, color management."""
import bpy

COLOR_INPUTS = {"Base Color", "Emission Color"}


def upstream_images(socket, seen=None):
    """Every TEX_IMAGE node feeding this input, following the graph upstream."""
    if seen is None:
        seen = set()
    found = []
    if not socket.is_linked:
        return found
    for link in socket.links:
        node = link.from_node
        if node in seen:
            continue
        seen.add(node)
        if node.type == 'TEX_IMAGE':
            found.append(node)
        else:
            for inp in node.inputs:
                found.extend(upstream_images(inp, seen))
    return found


def fix_colorspaces(mat):
    """Base Color / Emission -> sRGB. Everything else -> Non-Color."""
    changed = []
    for node in mat.node_tree.nodes:
        if node.type != 'BSDF_PRINCIPLED':
            continue
        for inp in node.inputs:
            target = 'sRGB' if inp.name in COLOR_INPUTS else 'Non-Color'
            for tex in upstream_images(inp):
                if not tex.image:
                    continue
                if tex.image.colorspace_settings.name != target:
                    tex.image.colorspace_settings.name = target
                    changed.append(f"{mat.name}: {tex.image.name} -> {target}")
    return changed


def ensure_normal_map(mat):
    """A normal texture wired straight into Normal needs a Normal Map node between."""
    nt = mat.node_tree
    added = []
    for node in nt.nodes:
        if node.type != 'BSDF_PRINCIPLED':
            continue
        inp = node.inputs.get("Normal")
        if not inp or not inp.is_linked:
            continue
        src = inp.links[0].from_node
        if src.type == 'TEX_IMAGE':
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.location = (src.location.x + 250, src.location.y)
            nt.links.new(nm.inputs['Color'], src.outputs['Color'])
            nt.links.new(inp, nm.outputs['Normal'])
            added.append(f"{mat.name}: inserted Normal Map node")
    return added


def set_color_management(scene):
    """AgX with a contrast look. Falls back gracefully across Blender versions."""
    vs = scene.view_settings
    try:
        vs.view_transform = 'AgX'
    except TypeError:
        return ["color management: AgX unavailable, left as-is"]
    for candidate in ('AgX - High Contrast', 'High Contrast', 'AgX - Medium High Contrast'):
        try:
            vs.look = candidate
            return [f"color management: AgX / {candidate}"]
        except TypeError:
            continue
    return ["color management: AgX set, no contrast look matched"]


def run(selected_only=False):
    if selected_only:
        mats = {s.material for o in bpy.context.selected_objects
                for s in o.material_slots if s.material}
    else:
        mats = set(bpy.data.materials)

    report = []
    for mat in mats:
        if not mat or not mat.use_nodes:
            continue
        report += fix_colorspaces(mat)
        report += ensure_normal_map(mat)
    report += set_color_management(bpy.context.scene)

    print("\n".join(report) if report else "nothing to fix")
    return report


if __name__ == "__main__":
    run(selected_only=False)
```

**Verification status, honestly:** the graph-walk logic is tested against a mock `bpy` —
multi-texture chains into Base Color, packed ORM routed through a Separate Color node,
cyclic node graphs, and unlinked sockets all behave. What is **not** tested is anything
touching real Blender: the exact `look` enum strings, node-group edge cases, and whether your
importer names sockets the way 4.x does. There's no Blender in the environment I wrote this
in, so treat the first run as the real test.

Blast radius is small — it only changes colorspaces, inserts Normal Map nodes, and sets color
management, and Ctrl+Z covers all of it. It prints every change it makes; send me the output
if anything looks wrong.

---

## 4. CC0 asset sources

Public domain — no attribution, commercial use fine, no share-alike.

| Source | What | Note |
|---|---|---|
| [Kenney](https://kenney.nl) | 2D sprites, tilesets, UI, 3D low-poly, audio | The big one. Internally consistent by construction |
| [Quaternius](https://quaternius.com) | 3D low-poly, some rigged | Great parts bin for kitbashing |
| [Poly Haven](https://polyhaven.com) | HDRIs, PBR textures, scanned models | Production quality. Your HDRI source |
| [OpenGameArt](https://opengameart.org) | Mixed everything | **Mixed licenses** — CC0/CC-BY/GPL. Verify per asset |

⚠️ "Free" on itch.io and OpenGameArt often means CC-BY (attribution) or GPL (viral).
**Check per asset, not per site.**

### Restyling, in order of impact

**2D:** palette remap (do the nearest-color match in **LAB space, not RGB** — RGB gives muddy
matches) → proportion edits → outline treatment → one signature motif → re-shade to one light.

**3D:** material replacement (~80% of the work) → kitbashing parts into new objects →
non-uniform scaling → your HDRI and grade.

**Split that works:** originals for the hero 10% (player, main enemies, logo), restyled CC0
for the other 90% (props, tiles, UI, set dressing). Restyling does not hide a hero asset.

---

## 5. Store art specs

### Steam — [official source](https://partner.steamgames.com/doc/store/assets/standard)

| Asset | Size | Format |
|---|---|---|
| Header capsule | 920 × 430 | JPG |
| Small capsule | 462 × 174 | **PNG** |
| Main capsule | 1232 × 706 | JPG |
| Vertical capsule | 748 × 896 | JPG |
| Library capsule | 600 × 900 | JPG |
| Page background *(optional)* | 1438 × 810 | JPG |
| Bundle header *(if bundling)* | 707 × 232 | JPG |
| Screenshots | ≥1920 × 1080, 16:9 | min. 5 |

**Rejection causes:** no marketing copy, review quotes, awards, or discount badges baked into
capsules — title/logo only. Screenshots must be actual gameplay, not concept art or
pre-rendered cinematics.

**Steam auto-derives 184×69 and 120×45 from your small capsule.** Compose the small capsule
**first, at 120×45**, then scale the concept up. Thumbnail-first designs work large;
the reverse usually doesn't. Valve's own guidance: the logo should *nearly fill* the small capsule.

### itch.io

| Asset | Size | Note |
|---|---|---|
| Cover image | 630 × 500 | min 315 × 250, max 3840 × 2160, ≤3 MB |
| Page banner | 960 × 300 (or ×400) | **Replaces the page title** — put the title in the art |

---

## 6. The loop that makes it look consistent

Settings get you good assets. This gets you a good *set*.

1. **Write the Art Bible first** — explicit hexes, one light direction, silhouette rules,
   scale/grid, camera. Before any asset exists.
2. **Generate** per §1.
3. **Render → look at it → critique against the Bible → fix.** Claude Code can see images,
   so this is a real loop, not a metaphor.
4. **Contact sheet.** Render every asset onto one image, at real in-game size, on the game's
   actual background. Inconsistency jumps out instantly — the prop lit from the wrong side,
   the off-palette hue. Reviewing one at a time cannot find these.
5. **Silhouette pass.** Flatten to solid black. Not identifiable as a shape? It won't read
   in motion.

Polish is a consistency property. Step 4 catches more of it than steps 1–3 combined.
