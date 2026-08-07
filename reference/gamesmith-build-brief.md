# Build brief — paste this into a fresh Claude Code session

Everything below the line is the prompt. Copy it whole. It is self-contained: the session you
paste it into has none of the conversation that produced it, so the facts it needs are carried
inline. Change the plugin name if you want a different one.

---

Build me a Claude Code **plugin** for game art, design, and asset production. Treat this brief
as the requirements doc, not as finished research — I want you to verify what's here and go
considerably deeper before you write code.

## Mission

Indie developers using Claude Code produce bad-looking game assets. The reason is not that the
model draws badly — it is that **Claude Code has no pixel output**, so every asset is code
impersonating art, generated open-loop with nothing pinning style across generations. This
plugin fixes the process, not the drawing.

The core thesis, which everything should serve: **polish is a consistency property, not a
per-asset quality property.** A set of merely competent assets that agree on palette, light
direction, and proportion reads as polished. Individually gorgeous assets that disagree read
as an asset flip. Consistency is mechanizable; that is the whole opportunity.

Target: get a solo dev from programmer-art to strong-indie, across 2D, 3D, and store art.

## What to build

A plugin named `gamesmith` with two entry points:

- **`/gamedesign`** — the direction side. Establishes and maintains the *style contract*:
  interviews for art direction, emits a machine-readable `art-bible.json` plus a prose
  `ART-DIRECTION.md`, and later audits assets against it. Also covers game feel, readability
  rules, and brand/store direction.
- **`/gameassets`** — the production side. Generates, sources, fixes, verifies, and exports
  actual assets, always reading the art bible first. Routes per asset class rather than using
  one tool for everything.

Match this repo layout (it is the standard Claude Code plugin shape — mirror the conventions
of any plugin already in this repo if one exists):

```
.claude-plugin/plugin.json          # manifest: name, version, description, keywords
.claude-plugin/marketplace.json     # marketplace entry so `/plugin marketplace add` works
commands/gamedesign.md              # frontmatter: description; body enters the skill
commands/gameassets.md
skills/<skill-name>/SKILL.md        # frontmatter: name, description (trigger phrases matter)
skills/<skill-name>/scripts/*.py    # stdlib-first helpers, each with --selftest
hooks/hooks.json + hooks/*.py       # deterministic gates
reference/*.md                      # the authority specs behind the workflow
README.md                           # user-facing install + usage
CLAUDE.md                           # contributor-facing notes
```

A command file is thin — frontmatter `description`, then a body that invokes the skill and
states any must-do-first steps. The skill carries the actual workflow. The skill's
`description` is what triggers it, so write it with the phrases a user would actually say.

## The four layers the plugin must implement

**L1 — Art Bible.** A machine-readable style contract authored *before* any asset exists and
read by every later step. Must pin: palette as explicit hex ramps named by role
(`shadow.cool`, `hazard`, `ui.accent`), one global light direction and elevation, silhouette
and shape-language rules, minimum readable feature size, scale/grid (pixels-per-unit or
units-per-meter + tri budget + texel density), outline weight and policy, and camera
projection/angle. This is the highest-leverage artifact in the system and it costs an hour.

**L2 — Generation routed per asset class.** No single tool wins. Route by what is being made,
and keep Claude's role as *orchestrator and scripter*, not illustrator:

| Asset class | Route to |
|---|---|
| Pixel sprites, walk cycles, tilesets | PixelLab (has an MCP server — drives from Claude Code) |
| Style-locked 2D at volume | Scenario (train a style model on refs), Sprixen style-lock |
| 3D blockout, clean topology | Tripo |
| 3D hero assets, PBR | Rodin / Hyper3D (also reachable through Blender MCP) |
| HDRIs, textures, materials | Poly Haven (CC0) |
| Greybox, placeholder, jam | Kenney, Quaternius (CC0) |
| Assembly, retopo, UV, rig, batch, render | Blender MCP — Claude writes `bpy` |
| Shaders, VFX, particles, procedural variation | Claude directly (math-as-art is a strength) |

Two rules: raw generator output is never a drop-in asset (budget a deterministic cleanup
pass), and Blender is the **hub**, not a sibling — everything 3D funnels through it for
normalization against the art bible before reaching an engine.

**L3 — The critique loop.** This is the piece nobody wires and it matters most.
**Claude Code's `Read` tool renders images visually.** So: generate → render → `Read` the PNG
→ critique against `art-bible.json` → fix → repeat. Build render adapters per stack: Blender
MCP renders the viewport; Godot/Unity MCP servers run a scene and screenshot; web/canvas uses
Playwright + headless Chromium; Pygame blits and `image.save()`s.

Two loop variants do most of the work, and both must ship:
- **Contact sheet** — render *every* asset in a set onto one image, at real in-game size, on
  the game's actual background. Inconsistency becomes obvious instantly. Reviewing assets one
  at a time structurally cannot find set-level drift.
- **Silhouette pass** — flatten to solid black on white. Not identifiable as a shape? It will
  not read in motion. One line of Pillow.

**L4 — Gates.** Deterministic stdlib checks wired as hooks so they cannot be skipped. Not
taste — taste is L3. Palette conformance (every pixel within tolerance of a bible hex, failing
with the offending colors listed), grid alignment, alpha hygiene (no stray semi-transparent
fringe), silhouette readability threshold, and 3D norms (applied transforms, non-overlapping
UVs, tri budget, texel density). Hooks must **fail safe**: a hook that errors degrades to a
no-op, never to a false "blocked" or a crash mid-commit.

## Store & marketing art — a separate discipline

Banners are **composition, not illustration**, and they are judged under conditions in-game
assets never face. Claude cannot paint key art, but layout, per-format derivation, display-size
review, and spec gates are exactly where store art fails — so this is a strong fit.

Ship a store-art kit: one master key art in, every required size out, plus gates on dimensions,
format, file size, logo-area threshold, and a baked-text check.

Steam required assets (verify against
<https://partner.steamgames.com/doc/store/assets/standard> — Valve changes these):

| Asset | Size | Format |
|---|---|---|
| Header capsule | 920 × 430 | JPG |
| Small capsule | 462 × 174 | PNG |
| Main capsule | 1232 × 706 | JPG |
| Vertical capsule | 748 × 896 | JPG |
| Library capsule | 600 × 900 | JPG |
| Page background (optional) | 1438 × 810 | JPG |
| Bundle header | 707 × 232 | JPG |
| Screenshots | ≥1920 × 1080, 16:9, min 5 | — |

itch.io: cover 630 × 500 (min 315 × 250, max 3840 × 2160, ≤3 MB); page banner 960 × 300 or
960 × 400, which **replaces the page title** — so the title must be in the art.

Rules that cause rejections: no marketing copy, review quotes, awards, or discount badges baked
into capsules — title/logo only. Screenshots must be actual gameplay, not concept art or
pre-rendered cinematics.

The rule that matters most: **Steam auto-derives 184×69 and 120×45 from the small capsule.**
Compose the small capsule *first, at 120×45*, and scale the concept up. Thumbnail-first designs
work large; the reverse usually does not. Valve's own guidance is that the logo should nearly
fill the small capsule.

## Rodin / Hyper3D — bake these presets in

Parameters per the Gen-2.5 API spec (<https://developer.hyper3d.ai/api-specification/rodin-gen2.5.md>
— verify, it may have moved):

`tier` (Gen-2.5-Extreme-Low → Extreme-High, required) · `quality` (extra-low → high, default
medium) · `quality_override` (1k–2M) · `geometry_file_format` (glb default) · `mesh_mode`
(Raw default / Quad) · `material` (PBR default / Shaded / All / None) · `texture_mode` (legacy
→ high) · `hd_texture` (default false) · `texture_delight` (default false) · `addons`
(`["HighPack"]` → 4K textures instead of 2K) · `seed` (0–65535) · `geometry_instruct_mode`
(creative default / faithful) · `is_micro` (Extreme-High only) · `TAPose` · `bbox_condition` ·
`image_label` (F, FL, FR, L, R, B, BL, BR, U, D) · `use_original_alpha` · `preview_render`.

Ship four presets — hero, production, blockout, character-to-rig — and encode these traps:

- **`texture_mode` is a separate quality ladder from `tier`.** A high tier with a weak texture
  mode gives good mesh and flat paint. This is the single most common misconfiguration.
- **`texture_delight` acts on the input image, not the output.** Only helps when the reference
  has baked lighting; on flat concept art it can wash out intentional shading.
- **`geometry_instruct_mode` defaults to `creative`** and drifts from reference. Use `faithful`
  when matching concept art.
- **`mesh_mode` defaults to `Raw`** (triangles). Anything rigged or deformed needs `Quad`.
- **Export GLB, not FBX/OBJ.** GLB carries colorspace metadata and packs ORM correctly.
- There is a **separate Generate Texture endpoint** that re-textures an existing mesh
  (model + reference image + prompt, ~0.5 credits). Wire this as the tight iteration loop —
  never re-roll geometry to fix paint.

## Blender import fixes to automate

- **Colorspace bug:** roughness, metallic, and normal maps must be **Non-Color**. FBX/OBJ
  imports load them as sRGB, putting a gamma curve on non-color data — the result is uniformly
  plasticky surfaces. Walk the node graph from the Principled BSDF: textures feeding Base Color
  and Emission get sRGB, everything else gets Non-Color. Handle packed ORM routed through a
  Separate Color node, and guard against cyclic graphs.
- **Missing Normal Map node** between a normal texture and the Normal input.
- **Color management:** Blender 4.x defaults to AgX, which reads flat and desaturated. The fix
  is Look → `AgX - High Contrast`, **not** switching View Transform to Standard (which clips
  highlights above 1.0 to flat white). For stylized/hand-painted work Filmic is often better,
  since it does not shift hues. Also raise light intensity — AgX expects more light energy, and
  weak lamps are what actually produce the muddy look.
- **HDRI world lighting** from Poly Haven. Perceived material quality depends more on lighting
  environment than texture resolution.

## CC0 sourcing and restyling

Kenney (2D + 3D + UI + audio), Quaternius (3D low-poly), Poly Haven (HDRIs, PBR, scans) are
CC0. **OpenGameArt mixes licenses** — CC0, CC-BY, and GPL together — so verify per asset, not
per site. Same trap on itch.io.

The value is that a pack was made by one person under one set of rules, so hundreds of assets
already agree. That coherence is the expensive thing. The cost is that they look like
themselves, which reads as asset-flip.

Restyling, in impact order — 2D: palette remap (nearest-color match in **LAB space, not RGB**;
RGB distance gives muddy results) → proportion edits → outline treatment → one signature motif
→ re-shade to one light. 3D: material replacement (~80% of the work) → kitbashing parts into
new objects → non-uniform scaling → your HDRI and grade.

Ship this as tooling, and encode the honest split: **originals for the hero 10%** (player, main
enemies, logo), **restyled CC0 for the other 90%**. Restyling does not hide a hero asset.

## Research assignments — go deeper than this brief

Treat everything above as a starting point with a knowledge cutoff, not as truth. This tooling
space moves fast. Research before building, and prefer primary sources — vendor API docs over
comparison blogs. One secondary source consulted for this brief had the Steam small-capsule
format wrong, so cross-check anything load-bearing.

Consider running these in parallel subagents:

1. **Verify every number and parameter in this brief** against primary docs. Correct what
   drifted and note what you changed.
2. **Current AI asset generation landscape** — 2D and 3D. Which tools have MCP servers or clean
   REST APIs (that determines what can be automated at all). Include pricing tiers.
3. **Image-to-3D vs text-to-3D.** Image-to-3D wins because it narrows the modality gap — the
   reference pins shape, proportion, and color, so the model only infers what it cannot see.
   Multi-view (2–4 labeled views) beats single-view. Research the current best chain, including
   using a strong image model for concept art first, then converting.
4. **Engine MCP servers** — Godot, Unity, Unreal. What each exposes, and specifically whether
   it can run a scene and capture a screenshot, since that gates the L3 loop.
5. **Game feel / juice** — the animation, timing, and readability principles that separate
   polished from competent. Squash/stretch, anticipation, hit-stop, screen shake, particle
   budgets, coyote time. This should inform `/gamedesign`.
6. **Accessibility** — colorblind-safe palettes, contrast ratios, readability at distance,
   motion sensitivity. Bake these into the art bible as checkable constraints, not advice.
7. **Sprite/atlas pipelines** — packing, trimming, 9-slice, mipmap and filtering policy for
   pixel art (nearest, no mips), per-engine import settings that ruin pixel art by default.
8. **Audio** — if there is a comparable consistency story for SFX and music, scope it. If not,
   say so and leave it out rather than shipping something thin.

Anything you find that beats what is in this brief, use it and tell me what changed and why.

## Ground rules

1. **Portable.** No hardcoded machine paths. Resolve `$HOME` / `$CLAUDE_*` at runtime. This is
   infrastructure a stranger installs on a laptop you will never see. Test the assumption that
   nothing about your environment is special.
2. **Ship no user data.** Any registry or project list starts blank and lives outside the repo,
   per user. The plugin discovers; it never bundles.
3. **Hooks fail safe.** A hook that errors degrades to a no-op. Never a false "blocked", never
   a crash mid-commit.
4. **Reversible.** Any change the plugin makes to a user's project must be undoable in one
   command. Snapshot before destructive edits.
5. **Stdlib over dependencies; reuse over rewrite; the shortest thing that works.** Pillow is
   an acceptable dependency for image work — justify anything beyond it. Every added line is a
   line a stranger has to trust.
6. **Secrets.** API keys for Rodin, PixelLab, Scenario etc. come from environment variables.
   Never write a key to disk, never log one, never commit one.
7. **Licenses.** Anything that ingests third-party assets must surface the license and refuse to
   silently treat CC-BY or GPL as CC0.
8. Mark deliberate shortcuts with a `# ponytail:` comment naming the ceiling and the upgrade path.

## Definition of done

- `/gamedesign` and `/gameassets` both work end to end on a real scratch project.
- Every script has a `--selftest` that passes, and you have **run** them. A change with no run
  behind it is unshipped.
- Every hook has been exercised with the JSON payload Claude Code feeds hooks on stdin,
  asserting exit 0 and the expected decision — including the error path proving it fails safe.
- Anything you could not verify is labelled as unverified **in the docs**, not quietly assumed.
  I would rather have an honest gap than a confident wrong answer.
- `README.md` (user-facing) and `CLAUDE.md` (contributor-facing) both written and in sync.
- Version matches across `plugin.json` and the `marketplace.json` entry.
- Committed on a feature branch with a draft PR.

## How to work

Plan before building and show me the plan. Where you hit a real fork — scope, dependency,
architecture — surface it as a decision with a recommendation rather than picking silently.

Build in this order, which is decreasing confidence and increasing external dependency:
**art bible → critique loop → gates → store-art kit → generator routing.** The first four need
no third-party account and no network. Only the last one does. If you run out of room, having
one through four finished and working beats all five half-built.
