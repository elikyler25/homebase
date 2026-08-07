# Game art & asset pipeline — design spec

**Date:** 2026-08-06
**Status:** research complete, proposal open
**Owner:** Elias

## 1. The actual problem

The complaint is "Claude Code makes bad-looking game assets." The diagnosis is more specific
than that, and it matters, because the wrong diagnosis buys the wrong tool.

**Claude Code has no pixel output.** It cannot render an image. Every "asset" it produces is
code impersonating art — hand-written SVG paths, canvas draw calls, PIL scripts placing
rectangles, `bpy` primitives at guessed coordinates. That is drawing blindfolded.

Three failure modes follow, and only one of them is about drawing ability:

| Failure | What it looks like | Real cause |
|---|---|---|
| **Open loop** | Each asset is a one-shot guess, never looked at | The model never sees its own output. No iteration, no correction. |
| **No style contract** | Assets are individually OK, collectively incoherent | Nothing pins palette, light angle, line weight, or scale across generations. |
| **Wrong medium** | Programmer art — flat, stiff, arbitrary | Asked to *draw* (weak) instead of to *script* and *direct* (strong). |

**Polish is a consistency property, not a per-asset quality property.** A set of merely
competent assets that agree on palette, light direction, and proportion reads as *polished*.
A set of individually gorgeous assets that disagree reads as *asset-flip*. This is the whole
game, and it is the part that is mechanizable.

Nintendo's own leverage is art direction over raw fidelity — strong silhouettes, restricted
palettes, readable-at-a-glance shapes. That is a spec you can write down and enforce, which
is exactly why this is tractable.

## 2. The four layers

The pipeline is four layers. Most people build layer 2 only, and that is why it does not work.

```
  L1  ART BIBLE        machine-readable style contract   ← written once, read by everything
  L2  GENERATION       routed per asset class            ← many tools, not one
  L3  CRITIQUE LOOP    render → SEE → critique → fix     ← the missing piece
  L4  GATES            deterministic consistency checks  ← hooks, not vibes
```

### L1 — The Art Bible

One machine-readable file per game (`art-bible.json` + a prose `ART-DIRECTION.md`), authored
before any asset exists, read by every later step. It pins:

- **Palette** — explicit hex ramps, 8–32 colors, named by role (`shadow.cool`, `skin.mid`,
  `hazard`, `ui.accent`). Not "warm palette." Hexes.
- **Light** — one global direction and elevation. Every asset lit the same way or it reads wrong.
- **Silhouette rules** — shape language (rounded vs. angular), minimum readable feature size,
  the negative-space rule.
- **Scale & grid** — pixels-per-unit, sprite cell size, or for 3D: units-per-meter, target
  tri budget, texel density.
- **Line & edge** — outline weight, whether outlines are colored or black, AA policy.
- **Camera** — projection, angle, FOV. Fixes the axonometric drift that makes tilesets fight.

This is the highest-leverage artifact in the whole pipeline and it costs an hour. It is also
the thing that turns "generate a barrel" into a constrained request instead of a lottery ticket.

### L2 — Generation, routed by asset class

There is no single best tool. Route by what is being made. Claude Code's role here is
**orchestrator and scripter**, not illustrator.

| Asset class | Route to | Why |
|---|---|---|
| Pixel sprites, walk cycles, tilesets | **PixelLab** (has an MCP server — drives from Claude Code directly) | Grid-native, 4/8-directional characters, animation from a static sprite, Wang tilesets, palette forcing |
| Style-locked 2D at volume | **Scenario** (train a style model on your refs) or **Sprixen** (style lock) | Consistency across a whole set is the entire point; one-off generators cannot do this |
| 3D blockout / clean topology | **Tripo** | Quad-based topology with usable edge flow — cheapest path to something riggable |
| 3D hero assets, PBR | **Rodin** (Hyper3D) | 4K PBR, higher fidelity where it earns the cost; reachable *through* Blender MCP |
| HDRIs, textures, materials | **Poly Haven** (CC0) | Free, high quality, and Blender MCP downloads them directly into the scene |
| Greybox / placeholder / jam | **Kenney**, **Quaternius** (CC0) | Internally consistent by construction — instant coherent look while designing |
| Assembly, retopo, UV, rig, batch, render | **Blender MCP** (Claude writes `bpy`) | This is scripting, which is Claude's strong suit, not its weak one |
| Shaders, VFX, particles, procedural variation | **Claude Code directly** | Math-as-art. Genuinely strong: SDFs, gradients, noise, dissolve, hit-flash, trails |

Two notes that decide whether this works:

1. **Raw generator output is never a drop-in asset.** Budget a cleanup pass — background
   removal, palette snap, pixel-grid realignment, edge cleanup, re-export at engine sizes.
   That pass is deterministic Python, which means it is automatable, which means it is L4.
2. **Blender is the hub, not a sibling.** Everything 3D — generated, purchased, or CC0 —
   lands in Blender for normalization against the Art Bible (scale, orientation, material
   convention, texel density) before it reaches the engine. One funnel, one standard.

### L3 — The critique loop (the piece nobody wires)

**Claude Code can see images.** The `Read` tool renders PNG/JPG visually. Almost nobody
exploits this for art, and it is the single largest quality lever available.

The loop:

```
generate/place asset
   → render it (Blender viewport, engine screenshot, or browser canvas)
   → Read the PNG            ← Claude now actually SEES the result
   → critique against art-bible.json, specifically
   → apply the fix
   → repeat until it passes or the budget is spent
```

Per stack, the render step is already solved:

- **Blender** — Blender MCP renders the viewport; Read the output.
- **Godot / Unity** — the engine MCP servers run a scene and capture a screenshot.
- **Web / canvas** — Playwright drives headless Chromium and screenshots the canvas.
  (Chromium is pre-installed in this environment at `/opt/pw-browsers`.)
- **Pygame** — blit to a surface and `image.save()`.

Two loop variants do most of the work:

- **Contact sheet.** Render *every* asset in a set onto one sheet, at real in-game size, on
  the game's actual background. Read that one image. Inconsistency becomes obvious instantly
  — the one prop lit from the wrong side, the sprite two pixels too tall, the off-palette
  hue. Reviewing assets one at a time cannot find these, which is why sets drift.
- **Silhouette pass.** Flatten to solid black on white. If it is not identifiable as a
  black shape, it will not read in motion. This is the Nintendo test, and it is one line
  of PIL.

### L4 — Gates (make consistency mechanical)

Deterministic checks, stdlib Python, run as hooks so they cannot be skipped. Not taste —
taste is L3. These are the rules a tired human stops enforcing at 1am:

- **Palette conformance** — every pixel within tolerance of an Art Bible hex, or fail with
  the offending colors listed.
- **Grid alignment** — sprite dimensions are multiples of the cell; no half-pixel offsets.
- **Alpha hygiene** — no stray semi-transparent fringe, no orphan pixels outside the hull.
- **Silhouette readability** — flattened shape exceeds a minimum distinct-area threshold.
- **3D norms** — scale sanity, applied transforms, non-overlapping UVs, tri budget, texel
  density within range.

Homebase already has the hook machinery (`hooks/hooks.json` + standalone stdlib scripts).
These gates are the same shape as `secret-scan.py` and fail-safe the same way.

## 3. Store & marketing art (banners, capsules, key art)

Distinct enough from §2 to deserve its own treatment: banners are **composition, not
illustration**, and they are judged under conditions in-game assets never face. DESLOT is the
live case — `homebase-design.md` lists it as a Steam product with brand + showcase, which
means the capsule set is a real deliverable, not a hypothetical.

Three things make store art different:

1. **Hard external constraints.** Exact pixel dimensions, per-asset file format, size caps,
   and platform content rules. All machine-checkable — ideal gate material, and the most
   common source of a rejected store page.
2. **Thumbnail-first.** Steam auto-derives 184×69 and 120×45 from the small capsule. Your art
   must survive an ~8× downscale in a crowded storefront. This is the silhouette test from
   §2 L3, harsher: if the logo is not readable at 120×45, the asset has failed regardless of
   how it looks at full size.
3. **Logo legibility is the job.** Valve's own guidance is that the logo should *nearly fill*
   the small capsule. Scene beauty is secondary to the half-second read.

### Steam — required assets

Per [Steamworks store asset docs](https://partner.steamgames.com/doc/store/assets/standard).
Treat these as authoritative and re-check at ship time; Valve changes them.

| Asset | Size | Format | Where it appears |
|---|---|---|---|
| Header capsule | 920 × 430 | JPG | Store page top, Big Picture, "Recommended For You" |
| Small capsule | 462 × 174 | PNG | Search, top sellers, new releases (auto-derives 184×69, 120×45) |
| Main capsule | 1232 × 706 | JPG | Store home page carousel |
| Vertical capsule | 748 × 896 | JPG | Seasonal sales, promo pages |
| Library capsule | 600 × 900 | JPG | In-library grid |
| Page background *(optional)* | 1438 × 810 | JPG | Ambient page backdrop |
| Bundle header *(if bundling)* | 707 × 232 | JPG | Bundle detail page |
| Screenshots | ≥ 1920 × 1080, 16:9 | — | Store page, minimum 5 |

**Content rules that cause rejections:** no marketing copy, review quotes, awards, or
discount badges baked into capsules — title/logo only. Screenshots must show actual gameplay,
not concept art or pre-rendered cinematic stills.

### itch.io

| Asset | Size | Notes |
|---|---|---|
| Cover image | 630 × 500 recommended | min 315 × 250, max 3840 × 2160, ≤ 3 MB |
| Page banner | 960 × 300 (or × 400) | 960px max display width; **replaces the page title**, so the title must be in the art |

### How this runs

The division of labor is unusually clean here, and it plays to Claude's actual strengths:

```
key art        ← generated or commissioned ONCE, high-res, per the Art Bible
   ↓
composition    ← Claude scripts it: crop, safe areas, logo placement, per-format framing
   ↓
derive all     ← one master → every size, deterministically (PIL / ImageMagick)
   ↓
critique loop  ← view each at ACTUAL display size, incl. the 120×45 derive
   ↓
gates          ← dims, format, file size, logo-area threshold, text-free check
```

Claude cannot paint the key art. It *can* do every other step, because they are layout,
scripting, and verification. Two rules that carry most of the value:

- **Never design at full size and hope.** Compose the small capsule *first*, at 120×45, and
  scale the concept up. A design that works at thumbnail almost always works large; the
  reverse is very often false.
- **Review at display size, not asset size.** Rendering a 1232×706 capsule at full width in
  review is flattering and misleading. The contact sheet for store art is every capsule at
  the pixel size a player actually sees it, on the storefront's real background.

## 4. The honest ceiling

Worth stating plainly rather than discovering at month three.

This pipeline reliably reaches **strong indie**. It reaches Nintendo-level *consistency*,
because consistency is mechanizable and this mechanizes it. It does **not** produce
Nintendo-level *invention* — the original shape language, the character appeal, the specific
animation timing that makes a jump feel good. Those come from a human art director.

The correct read: the pipeline's job is to make the mechanical 90% fast, consistent, and
unskippable, so human taste is spent on direction and the hero assets instead of on
re-exporting sprite sheets. A locked Art Bible plus enforced gates plus a real critique loop
beats an unstructured session with a better generator, every time.

Also true: buying a coherent CC0 pack (Kenney, Quaternius) and restyling it to the Art Bible
frequently beats generating from scratch, and does so on day one. Generation is not the
prestige move it looks like.

## 5. Proposal — what to build in homebase

A `game-art` skill, shipped in this plugin, in build order:

1. **`art-bible` command** — interviews for the style contract, emits `art-bible.json` +
   `ART-DIRECTION.md` into the game project. Nothing else works without this. *(Highest value,
   lowest cost — build first, independently useful.)*
2. **Critique-loop skill** — the render → Read → critique → fix loop, with per-stack render
   adapters (Blender / Godot / Unity / web / Pygame) and the contact-sheet + silhouette passes.
   *(This is the quality jump.)*
3. **Gate hooks** — palette, grid, alpha, silhouette, 3D norms. Stdlib, fail-safe, wired into
   `hooks.json` alongside the existing four.
4. **Store-art kit** (§3) — one master key art in, every Steam + itch size out, plus the
   spec gates (dimensions, format, file size, logo-area threshold, baked-text check) and a
   display-size contact sheet down to 120×45. Pure stdlib-plus-Pillow scripting, no network.
   *(Immediately useful for DESLOT, and the most objectively verifiable piece here — the
   requirements are published numbers, so "correct" is not a matter of taste.)*
5. **Generator routing** — thin adapters per L2 tool, MCP where one exists (PixelLab, Blender),
   REST otherwise. Deliberately last: routing is worthless without 1–4, and every added
   integration is a dependency a stranger has to trust.

Sequencing note: 1 → 5 is also decreasing confidence and increasing external dependency.
Steps 1–4 need no third-party account and no network. Step 5 does. If only one thing gets
built, build 1; if only two, build 1 and 4 — the Art Bible makes everything else coherent,
and the store kit has a hard, checkable definition of done.

## 6. Sources

- [Blender MCP](https://blender-mcp.com/) · [Claude + Blender MCP setup](https://blendermcp.org/setup/claude) · [real-world performance & limits](https://www.mindstudio.ai/blog/claude-blender-mcp-real-world-performance)
- [PixelLab MCP](https://www.pixellab.ai/mcp) · [pixellab-code/pixellab-mcp](https://github.com/pixellab-code/pixellab-mcp)
- [Godot MCP (Coding-Solo)](https://github.com/Coding-Solo/godot-mcp) · [Godot MCP + Claude Code guide](https://www.strayspark.studio/blog/godot-mcp-setup-claude-code-2026) · [Godot vs Unity vs Blender MCP](https://mcp.directory/blog/godot-vs-unity-vs-blender-mcp-skills-2026)
- [AI 3D generator comparison — Tripo / Meshy / Rodin](https://www.strayspark.studio/blog/generative-3d-tools-comparison-meshy-rodin-tripo-csm-2026) · [2026 roundup](https://medium.com/ideas-with-wings/best-ai-3d-model-generators-in-2026-tripo-ai-vs-meshy-rodin-kaedim-and-more-7eea7b05eb11)
- [AI sprite generators compared](https://sprixen.com/blog/best-ai-sprite-generators-2026) · [pixel art generators tested](https://www.sprite-ai.art/blog/best-pixel-art-generators-2026)
- [Art direction over raw technology](https://pixune.com/blog/stylized-art-style/) · [game art styles & readability](https://www.argentics.io/understanding-game-art-styles)
- Store art — [Steamworks store graphical assets](https://partner.steamgames.com/doc/store/assets/standard) (authoritative) · [capsule size guide](https://www.steampageanalyzer.com/blog/steam-capsule-sizes) · [itch.io image sizes](https://itch.io/t/474870/whats-up-with-the-recommended-cover-image-resolutions)
