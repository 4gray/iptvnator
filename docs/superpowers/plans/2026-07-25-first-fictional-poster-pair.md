# First Fictional Poster Pair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and validate two contrasting fictional movie posters that establish the approved live-action drama and family-animation directions before producing the remaining eight.

**Architecture:** Each poster is generated independently with the built-in image-generation tool and an exact genre-specific prompt. The selected native portrait output is copied into the mock-server poster directory, downscaled to 512 × 768, and visually inspected at final size. The two files remain uncommitted until the user approves the visual direction.

**Tech Stack:** Built-in `image_gen`, PNG assets, macOS `sips`, `file`, `shasum`

---

### Task 1: Generate `ORCHARD WALLS`

**Files:**
- Create: `apps/xtream-mock-server/public/marketing/poster/orchard-walls.png`

- [ ] **Step 1: Generate the native portrait image**

Use the built-in `image_gen` tool once with this exact prompt:

```text
Use case: ads-marketing
Asset type: original fictional theatrical movie poster for IPTV mock data, portrait 2:3
Primary request: create a simple believable poster for a quiet contemporary drama titled “ORCHARD WALLS”; it must look like an ordinary professionally distributed live-action film rather than cinematic concept art
Scene/backdrop: a modest rural apple orchard in early autumn, one low weathered stone wall, pale overcast sky, soft distant hills
Subject: one entirely fictional man in his late 50s wearing plain faded work clothes, seated on the wall beneath a fruit tree and looking toward the empty orchard; natural posture, restrained expression, no celebrity resemblance
Style/medium: straightforward realistic movie-poster photography, modest independent-film polish, natural texture, slightly muted print color, no hyperreal detail
Composition/framing: vertical 2:3; the man occupies about one third of the image; one tree and one wall form the whole composition; generous quiet sky; strong silhouette readable at thumbnail size
Lighting/mood: soft cloudy daylight with a small patch of warm late-afternoon light, humane, reflective, hopeful but unsentimental
Color palette: faded olive, stone gray, muted rust, pale cream
Text (verbatim): “ORCHARD WALLS” exactly once, large restrained uppercase serif lettering centered in the upper sky, clearly legible
Constraints: original fictional person and setting; title only; no actor names; no tagline; no credit block; no logos; no brands; no watermark
Avoid: prison corridors, uniforms, guards, electric chairs, supernatural light, famous actors, glossy face montage, dramatic teal-orange grading, volumetric rays, excessive detail, copied movie-poster layouts, malformed hands, extra text, misspelled title
```

Expected result: a restrained one-character drama poster with the exact title
`ORCHARD WALLS`, no other text, and no recognizable person or existing-film
motif.

- [ ] **Step 2: Inspect the generated image before saving**

Use `view_image` on the exact absolute path returned by `image_gen`.

Reject and regenerate if the title is misspelled, any extra text appears, the
person resembles a recognizable actor, the hands are visibly malformed, or the
image reads as elaborate concept art instead of a simple drama poster.

- [ ] **Step 3: Save and downscale the selected image**

Copy the exact generated path returned by the successful tool call to:

```text
apps/xtream-mock-server/public/marketing/poster/orchard-walls.png
```

Then run:

```bash
sips -z 768 512 apps/xtream-mock-server/public/marketing/poster/orchard-walls.png
```

Expected result: `orchard-walls.png` is rewritten at 512 × 768.

- [ ] **Step 4: Verify the final asset**

Run:

```bash
file apps/xtream-mock-server/public/marketing/poster/orchard-walls.png
shasum -a 256 apps/xtream-mock-server/public/marketing/poster/orchard-walls.png
```

Expected `file` output includes:

```text
PNG image data, 512 x 768, 8-bit/color RGB
```

Use `view_image` on the final workspace file and confirm the title remains
legible after downscaling.

### Task 2: Generate `BLUE CURRENT`

**Files:**
- Create: `apps/xtream-mock-server/public/marketing/poster/blue-current.png`

- [ ] **Step 1: Generate the native portrait image**

Use the built-in `image_gen` tool once with this exact prompt:

```text
Use case: ads-marketing
Asset type: original fictional animated-family-movie poster for IPTV mock data, portrait 2:3
Primary request: create a simple believable poster for an original family animation titled “BLUE CURRENT”; it should resemble professional theatrical animation marketing in clarity and charm without imitating any studio or existing film
Scene/backdrop: open blue ocean with two broad curved current ribbons, a softly lit sandy shelf far below, and only a few simple sea plants
Subject: one entirely original young royal-blue nudibranch sea slug with leaf-shaped golden frills, a compact rounded body, two expressive eyes, and a curious determined expression; it swims diagonally upward while carrying one tiny smooth white pebble
Style/medium: polished but simple stylized 3D family animation, appealing clear shapes, moderate detail, soft materials, not photorealistic and not concept art
Composition/framing: vertical 2:3; one large character centered slightly below the middle; current ribbons create a clean upward curve; uncluttered background; readable at very small thumbnail size
Lighting/mood: bright filtered daylight from above, cheerful, adventurous, gentle
Color palette: ocean blue, turquoise, golden yellow, small white accent
Text (verbatim): “BLUE CURRENT” exactly once, large friendly rounded uppercase lettering centered at the top, clearly legible
Constraints: wholly original character design; title only; no actor names; no tagline; no credit block; no studio logo; no brand; no watermark
Avoid: clownfish, orange-and-white striped fish, parent-and-child fish pairs, sea turtles, forgetful blue fish, coral-reef ensemble casts, recognizable animation-studio character styling, copied poster layouts, hyper-detailed underwater scenery, scary teeth, extra text, misspelled title
```

Expected result: a bright one-character animated poster with the exact title
`BLUE CURRENT`, no other text, and a protagonist unrelated to recognizable
underwater-film characters.

- [ ] **Step 2: Inspect the generated image before saving**

Use `view_image` on the exact absolute path returned by `image_gen`.

Reject and regenerate if the title is misspelled, extra text or a studio mark
appears, the protagonist resembles a known character, the design is too
detailed, or the image contains an ensemble instead of one clear protagonist.

- [ ] **Step 3: Save and downscale the selected image**

Copy the exact generated path returned by the successful tool call to:

```text
apps/xtream-mock-server/public/marketing/poster/blue-current.png
```

Then run:

```bash
sips -z 768 512 apps/xtream-mock-server/public/marketing/poster/blue-current.png
```

Expected result: `blue-current.png` is rewritten at 512 × 768.

- [ ] **Step 4: Verify the final asset**

Run:

```bash
file apps/xtream-mock-server/public/marketing/poster/blue-current.png
shasum -a 256 apps/xtream-mock-server/public/marketing/poster/blue-current.png
```

Expected `file` output includes:

```text
PNG image data, 512 x 768, 8-bit/color RGB
```

Use `view_image` on the final workspace file and confirm the title and
protagonist remain readable after downscaling.

### Task 3: Present the Review Checkpoint

**Files:**
- Inspect: `apps/xtream-mock-server/public/marketing/poster/orchard-walls.png`
- Inspect: `apps/xtream-mock-server/public/marketing/poster/blue-current.png`

- [ ] **Step 1: Verify the two-file scope**

Run:

```bash
git status --short -- apps/xtream-mock-server/public/marketing/poster
```

Expected result: the two new sample files appear. The earlier
`signal-nine.png` draft may also remain untracked but must not be modified by
this plan.

- [ ] **Step 2: Report the generation details**

Show both final workspace images to the user. Report:

- the two absolute workspace paths;
- the exact final dimensions and PNG color mode;
- that the built-in image-generation path was used;
- that the two prompts above were used;
- whether any output required regeneration and why.

- [ ] **Step 3: Pause for visual approval**

Do not generate the remaining eight posters and do not commit the two sample
assets until the user approves both the live-action and animated directions.
