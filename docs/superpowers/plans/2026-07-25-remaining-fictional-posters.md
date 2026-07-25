# Remaining Fictional Posters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, review, and save the remaining eight original fictional movie posters in the approved ten-poster collection.

**Architecture:** Each poster is an independent built-in `image_gen` generation with a genre-specific prompt and no visual dependency on existing repository posters. Every native result is inspected, saved as a 512 × 768 RGB PNG, checked for exact title text and originality, then committed separately after spec and visual-quality review. The existing `signal-nine.png` draft is explicitly replaced because the user requested a simpler real-film direction.

**Tech Stack:** Built-in `image_gen`, PNG assets, macOS `sips`, `file`, `shasum`, Git

---

## Shared Execution Contract

For every task:

1. Read the image-generation skill and its shared prompting references.
2. Do not inspect or use existing poster images as visual references.
3. Use one built-in `image_gen` call with the task's exact prompt.
4. Inspect the native result with `view_image`.
5. Regenerate once if the title is misspelled, extra text appears, anatomy is
   malformed, a recognizable actor or franchise motif appears, or the result
   violates the task's simplicity requirement.
6. Do not use CLI fallback. If a transient network error repeats, report
   `BLOCKED`.
7. Copy the accepted native result to the exact task path and run the task's
   `sips` command.
8. Verify the final workspace file with `file`, `shasum -a 256`, and
   `view_image`.
9. Add and commit only the task's poster file after its spec and visual-quality
   reviews pass.

### Task 1: Replace `SIGNAL NINE`

**Files:**
- Replace: `apps/xtream-mock-server/public/marketing/poster/signal-nine.png`

- [ ] **Step 1: Generate the poster**

```text
Use case: ads-marketing
Asset type: original fictional theatrical thriller poster for IPTV mock data, portrait 2:3
Primary request: create a simple believable poster for a contemporary urban conspiracy thriller titled “SIGNAL NINE”; it must look like conventional professionally distributed key art, not hyper-detailed science-fiction concept art
Scene/backdrop: a mostly dark underground train platform reduced to simple soft-focus shapes, one stopped silver train, one circular red signal lamp
Subject: two entirely fictional adult leads with no celebrity resemblance; one large close portrait of a female radio journalist in her late 30s, calm but alert, with a smaller male transit investigator in his early 40s standing near the train in the lower background
Style/medium: realistic commercial movie-poster photography with a restrained clean composite, natural faces, subtle print grain, limited detail
Composition/framing: vertical 2:3; one dominant face taking the upper-right half, one small standing figure below-left, red signal as the only graphic accent, strong black negative space; clear at thumbnail size
Lighting/mood: cool charcoal and steel blue with one muted red light, tense, grounded, contemporary
Text (verbatim): “SIGNAL NINE” exactly once, large condensed uppercase sans-serif in off-white at the bottom, clearly legible
Constraints: original fictional people; title only; no actor names; no tagline; no credits; no logos; no brands; no watermark
Avoid: green code rain, sunglasses, leather trench coats, pills, guns, explosions, futuristic cityscapes, neon overload, superhero poses, multiple face montage, recognizable actors, copied poster layouts, excessive skin detail, extra text, misspelled title
```

- [ ] **Step 2: Save and downscale**

```bash
sips -z 768 512 apps/xtream-mock-server/public/marketing/poster/signal-nine.png
```

- [ ] **Step 3: Verify**

```bash
file apps/xtream-mock-server/public/marketing/poster/signal-nine.png
shasum -a 256 apps/xtream-mock-server/public/marketing/poster/signal-nine.png
```

Expected: RGB PNG, exactly 512 × 768, exact title once, no extra text.

- [ ] **Step 4: Commit after both reviews pass**

```bash
git add -- apps/xtream-mock-server/public/marketing/poster/signal-nine.png
git commit -m "feat(mock-server): add Signal Nine poster"
```

### Task 2: Generate `CHECKOUT AT NOON`

**Files:**
- Create: `apps/xtream-mock-server/public/marketing/poster/checkout-at-noon.png`

- [ ] **Step 1: Generate the poster**

```text
Use case: ads-marketing
Asset type: original fictional theatrical comedy poster for IPTV mock data, portrait 2:3
Primary request: create a simple believable mainstream comedy poster titled “CHECKOUT AT NOON”; bright, human, and professionally photographed rather than glossy concept art
Scene/backdrop: a seamless warm butter-yellow studio background with one simple hotel luggage cart
Subject: three entirely fictional adults with no celebrity resemblance arranged in an awkward group pose around the cart: an exhausted hotel manager in a burgundy blazer, a cheerful traveler sitting on one suitcase, and a stern older guest holding a tiny room key; natural comedic expressions, contemporary ordinary clothing
Style/medium: clean commercial ensemble photography, lightly playful retouching, crisp simple shapes, moderate realism
Composition/framing: vertical 2:3; full and three-quarter figures, triangular ensemble arrangement, luggage cart as one clear prop, generous clean margins; readable as a small catalog tile
Lighting/mood: soft bright studio light, warm, upbeat, gently chaotic
Color palette: butter yellow, burgundy, cobalt blue, cream
Text (verbatim): “CHECKOUT AT NOON” exactly once, large bold cobalt uppercase sans-serif in three compact lines near the top-left, clearly legible
Constraints: three original fictional adults; title only; no actor names; no tagline; no credits; no hotel logo; no brand; no watermark
Avoid: oversized objects, slapstick action, floating luggage, celebrity likenesses, glamour fashion poses, busy hotel lobby, explosions, weapons, copied comedy-poster poses, excessive detail, extra text, misspelled title
```

- [ ] **Step 2: Save and downscale**

```bash
sips -z 768 512 apps/xtream-mock-server/public/marketing/poster/checkout-at-noon.png
```

- [ ] **Step 3: Verify**

```bash
file apps/xtream-mock-server/public/marketing/poster/checkout-at-noon.png
shasum -a 256 apps/xtream-mock-server/public/marketing/poster/checkout-at-noon.png
```

Expected: RGB PNG, exactly 512 × 768, exact title once, three plausible people,
one luggage cart, no extra text.

- [ ] **Step 4: Commit after both reviews pass**

```bash
git add -- apps/xtream-mock-server/public/marketing/poster/checkout-at-noon.png
git commit -m "feat(mock-server): add Checkout at Noon poster"
```

### Task 3: Generate `VESPER CROWN`

**Files:**
- Create: `apps/xtream-mock-server/public/marketing/poster/vesper-crown.png`

- [ ] **Step 1: Generate the poster**

```text
Use case: ads-marketing
Asset type: original fictional theatrical fantasy poster for IPTV mock data, portrait 2:3
Primary request: create a simple believable fantasy-adventure poster titled “VESPER CROWN”; one strong original image rather than an epic character montage
Scene/backdrop: a vast pale salt flat at violet dusk with a thin horizon and one distant dark mountain
Subject: one entirely fictional young female royal archivist in a practical dark plum travel coat, seen from behind in the lower third; above the horizon floats one large weathered copper crown made from seven uneven geometric arcs, softly suspended without flames
Style/medium: restrained live-action fantasy key art, realistic landscape photography with one practical-looking symbolic object, subtle print texture
Composition/framing: vertical 2:3; small lone figure below, large crown silhouette centered in open sky, minimal elements, iconic thumbnail readability
Lighting/mood: violet twilight, cool quiet mystery, thin copper highlights
Color palette: dusty violet, pale salt white, oxidized copper, dark plum
Text (verbatim): “VESPER CROWN” exactly once, elegant uppercase serif in pale copper near the bottom, clearly legible
Constraints: original person, costume, object, and world; title only; no actor names; no tagline; no credits; no logos; no brands; no watermark
Avoid: swords, dragons, thrones, castles, elves, medieval armor, fire, magical energy beams, floating face montage, recognizable fantasy-franchise motifs, overly ornate crown, excessive particles, copied poster layouts, extra text, misspelled title
```

- [ ] **Step 2: Save and downscale**

```bash
sips -z 768 512 apps/xtream-mock-server/public/marketing/poster/vesper-crown.png
```

- [ ] **Step 3: Verify**

```bash
file apps/xtream-mock-server/public/marketing/poster/vesper-crown.png
shasum -a 256 apps/xtream-mock-server/public/marketing/poster/vesper-crown.png
```

Expected: RGB PNG, exactly 512 × 768, exact title once, one figure and one
seven-arc copper crown, no extra text.

- [ ] **Step 4: Commit after both reviews pass**

```bash
git add -- apps/xtream-mock-server/public/marketing/poster/vesper-crown.png
git commit -m "feat(mock-server): add Vesper Crown poster"
```

### Task 4: Generate `LAST DETOUR`

**Files:**
- Create: `apps/xtream-mock-server/public/marketing/poster/last-detour.png`

- [ ] **Step 1: Generate the poster**

```text
Use case: ads-marketing
Asset type: original fictional theatrical road-action poster for IPTV mock data, portrait 2:3
Primary request: create a simple believable road-action thriller poster titled “LAST DETOUR”; grounded and physical, not a blockbuster explosion montage
Scene/backdrop: an empty two-lane mountain road at dry late afternoon, one sharp bend, low scrub, distant gray ridges
Subject: one weathered olive-green 1990s compact hatchback stopped diagonally at the roadside; two entirely fictional adults with no celebrity resemblance stand beside it, an older female mechanic in a faded tan work jacket and a younger male courier in a dark red sweatshirt, both looking back down the road
Style/medium: realistic location photography shaped into clean theatrical key art, subtle grain, restrained action tone
Composition/framing: vertical 2:3; car occupies lower middle, two figures form a simple diagonal, road leads into distance, no montage, readable at thumbnail size
Lighting/mood: hard warm sun and long cool shadows, wary, urgent, grounded
Color palette: sun-bleached tan, olive green, asphalt gray, dark red
Text (verbatim): “LAST DETOUR” exactly once, bold slightly condensed uppercase lettering in warm off-white across the lower road, clearly legible
Constraints: original fictional people and unbranded car; title only; no actor names; no tagline; no credits; no logos; no watermark
Avoid: car brands, luxury sports cars, racing, explosions, guns, helicopters, flying debris, urban skyline, celebrity likenesses, franchise action poses, teal-orange grading, multiple vehicles, excessive detail, extra text, misspelled title
```

- [ ] **Step 2: Save and downscale**

```bash
sips -z 768 512 apps/xtream-mock-server/public/marketing/poster/last-detour.png
```

- [ ] **Step 3: Verify**

```bash
file apps/xtream-mock-server/public/marketing/poster/last-detour.png
shasum -a 256 apps/xtream-mock-server/public/marketing/poster/last-detour.png
```

Expected: RGB PNG, exactly 512 × 768, exact title once, one unbranded hatchback
and two plausible people, no extra text.

- [ ] **Step 4: Commit after both reviews pass**

```bash
git add -- apps/xtream-mock-server/public/marketing/poster/last-detour.png
git commit -m "feat(mock-server): add Last Detour poster"
```

### Task 5: Generate `BORROWED SUMMER`

**Files:**
- Create: `apps/xtream-mock-server/public/marketing/poster/borrowed-summer.png`

- [ ] **Step 1: Generate the poster**

```text
Use case: ads-marketing
Asset type: original fictional theatrical romantic-drama poster for IPTV mock data, portrait 2:3
Primary request: create a simple believable romantic-drama poster titled “BORROWED SUMMER”; intimate naturalistic photography rather than glossy romance advertising
Scene/backdrop: the open window of an old local bus parked beside a quiet lakeside road at golden hour, softly blurred reeds and water beyond
Subject: two entirely fictional adults in their early 30s with no celebrity resemblance; one woman sits inside the bus by the open window while one man stands outside, their faces separated by the window frame, sharing a restrained almost-smile rather than touching
Style/medium: naturalistic live-action film photography, warm grain, gentle lens softness, modest festival-film poster finish
Composition/framing: vertical 2:3; two profiles occupy opposite sides of the window frame, simple geometric separation, lake and sunlight remain soft; clear emotional read at thumbnail size
Lighting/mood: warm low sun, tender, fleeting, bittersweet, unforced
Color palette: honey gold, faded bus green, lake blue-gray, soft skin tones
Text (verbatim): “BORROWED SUMMER” exactly once, modest lowercase-style serif rendered in uppercase letters near the bottom, warm cream and clearly legible
Constraints: two original fictional adults; title only; no actor names; no tagline; no credits; no bus logo; no brand; no watermark
Avoid: kissing, wedding imagery, glamour retouching, dramatic tears, heart shapes, celebrity likenesses, backlit face halos, Korean or other extra text, copied romance-poster poses, montage, excessive detail, misspelled title
```

- [ ] **Step 2: Save and downscale**

```bash
sips -z 768 512 apps/xtream-mock-server/public/marketing/poster/borrowed-summer.png
```

- [ ] **Step 3: Verify**

```bash
file apps/xtream-mock-server/public/marketing/poster/borrowed-summer.png
shasum -a 256 apps/xtream-mock-server/public/marketing/poster/borrowed-summer.png
```

Expected: RGB PNG, exactly 512 × 768, exact title once, two plausible original
profiles separated by the bus window, no extra text.

- [ ] **Step 4: Commit after both reviews pass**

```bash
git add -- apps/xtream-mock-server/public/marketing/poster/borrowed-summer.png
git commit -m "feat(mock-server): add Borrowed Summer poster"
```

### Task 6: Generate `UNDER THE FLOOR`

**Files:**
- Create: `apps/xtream-mock-server/public/marketing/poster/under-the-floor.png`

- [ ] **Step 1: Generate the poster**

```text
Use case: ads-marketing
Asset type: original fictional theatrical horror poster for IPTV mock data, portrait 2:3
Primary request: create a minimal believable supernatural-horror poster titled “UNDER THE FLOOR”; one unsettling image with no monster reveal and no gore
Scene/backdrop: an empty modest child's bedroom at night, faded cream wallpaper, simple iron bed partly visible, old dark wooden floorboards
Subject: one floorboard near the center is lifted by two centimeters, revealing only a narrow black gap; a single thin red sewing thread crosses the floor and disappears into the gap
Style/medium: realistic restrained horror photography, practical set lighting, subtle film grain, minimal graphic design
Composition/framing: vertical 2:3; low camera angle close to floor, lifted board and red thread as the only focal point, large quiet wall area above, instantly readable silhouette
Lighting/mood: cold moonlight from one unseen window, faint warm hallway spill, silent and deeply uneasy
Color palette: blue-gray, aged cream, dark brown, one restrained red accent
Text (verbatim): “UNDER THE FLOOR” exactly once, narrow uppercase serif in faded cream centered high on the wall, clearly legible
Constraints: title only; no people; no actor names; no tagline; no credits; no logos; no brands; no watermark; no visible creature
Avoid: eyes in darkness, hands, dolls, clowns, blood, gore, teeth, faces, pentagrams, haunted-house exterior, jump-scare imagery, famous horror motifs, extreme darkness that hides the floorboard, extra text, misspelled title
```

- [ ] **Step 2: Save and downscale**

```bash
sips -z 768 512 apps/xtream-mock-server/public/marketing/poster/under-the-floor.png
```

- [ ] **Step 3: Verify**

```bash
file apps/xtream-mock-server/public/marketing/poster/under-the-floor.png
shasum -a 256 apps/xtream-mock-server/public/marketing/poster/under-the-floor.png
```

Expected: RGB PNG, exactly 512 × 768, exact title once, one lifted floorboard
and one red thread, no person, creature, gore, or extra text.

- [ ] **Step 4: Commit after both reviews pass**

```bash
git add -- apps/xtream-mock-server/public/marketing/poster/under-the-floor.png
git commit -m "feat(mock-server): add Under the Floor poster"
```

### Task 7: Generate `RED WINTER`

**Files:**
- Create: `apps/xtream-mock-server/public/marketing/poster/red-winter.png`

- [ ] **Step 1: Generate the poster**

```text
Use case: ads-marketing
Asset type: original fictional theatrical space-survival poster for IPTV mock data, portrait 2:3
Primary request: create a simple believable science-fiction survival poster titled “RED WINTER”; minimal, physical, and lonely rather than elaborate space concept art
Scene/backdrop: a frozen exoplanet plain covered in pale red snow, one low black ridge, nearly empty dusty-pink sky, one small pale ringed moon
Subject: one tiny entirely fictional planetary botanist in a practical off-white insulated field suit walking away from camera while dragging a narrow sample sled; no visible face, no weapon
Style/medium: restrained live-action science-fiction key art with realistic location texture, simple matte-composite finish, subtle print grain
Composition/framing: vertical 2:3; person and sled occupy the bottom fifth, long single trail crosses the red snow, moon small in upper sky, strong negative space and thumbnail silhouette
Lighting/mood: diffuse frozen daylight, isolated, resilient, quiet
Color palette: pale brick red, dusty rose, off-white, charcoal
Text (verbatim): “RED WINTER” exactly once, wide uppercase sans-serif in off-white centered in the upper sky, clearly legible
Constraints: original world, suit, and character; title only; no actor names; no tagline; no credits; no mission logo; no brand; no watermark
Avoid: Mars landmarks, orange desert, giant astronaut close-up, space station, spaceship, laser, glowing helmet, explosions, storm debris, famous space-film compositions, excessive stars, excessive detail, extra text, misspelled title
```

- [ ] **Step 2: Save and downscale**

```bash
sips -z 768 512 apps/xtream-mock-server/public/marketing/poster/red-winter.png
```

- [ ] **Step 3: Verify**

```bash
file apps/xtream-mock-server/public/marketing/poster/red-winter.png
shasum -a 256 apps/xtream-mock-server/public/marketing/poster/red-winter.png
```

Expected: RGB PNG, exactly 512 × 768, exact title once, one small botanist, one
sled, one trail, and one small ringed moon, no extra text.

- [ ] **Step 4: Commit after both reviews pass**

```bash
git add -- apps/xtream-mock-server/public/marketing/poster/red-winter.png
git commit -m "feat(mock-server): add Red Winter poster"
```

### Task 8: Generate `SATURDAY CHAMPIONS`

**Files:**
- Create: `apps/xtream-mock-server/public/marketing/poster/saturday-champions.png`

- [ ] **Step 1: Generate the poster**

```text
Use case: ads-marketing
Asset type: original fictional theatrical family sports-comedy poster for IPTV mock data, portrait 2:3
Primary request: create a simple believable family sports-comedy poster titled “SATURDAY CHAMPIONS”; warm ensemble photography with ordinary kids, not an exaggerated sports spectacle
Scene/backdrop: a muddy community soccer field on a bright cloudy Saturday, plain chain-link fence and small neighborhood clubhouse softly blurred behind
Subject: six entirely fictional children aged 10–12 with varied appearances in mismatched unbranded green-and-yellow soccer uniforms posing for an awkward team photo; one child holds a normal scuffed soccer ball, one goalkeeper wears gloves slightly too large, all expressions natural and distinct
Style/medium: cheerful realistic family-film photography, clean theatrical poster composite, modest color polish, no hyperreal detail
Composition/framing: vertical 2:3; two standing rows of three children, simple team-photo geometry with slight comic imperfection, ball visible near center, generous sky for title, clear at thumbnail size
Lighting/mood: soft bright daylight after rain, optimistic, funny, sincere
Color palette: grass green, warm yellow, muddy brown, sky blue-gray
Text (verbatim): “SATURDAY CHAMPIONS” exactly once, large friendly uppercase slab-serif in warm yellow across the upper sky, clearly legible
Constraints: six original fictional children; safe age-appropriate presentation; title only; no actor names; no tagline; no credits; no team badge; no brand; no watermark
Avoid: professional stadium, famous club colors or kits, oversized soccer ball, adults, trophy, fireworks, acrobatic action, celebrity likenesses, glamour poses, copied sports-film ensemble layouts, extra limbs, malformed hands, extra text, misspelled title
```

- [ ] **Step 2: Save and downscale**

```bash
sips -z 768 512 apps/xtream-mock-server/public/marketing/poster/saturday-champions.png
```

- [ ] **Step 3: Verify**

```bash
file apps/xtream-mock-server/public/marketing/poster/saturday-champions.png
shasum -a 256 apps/xtream-mock-server/public/marketing/poster/saturday-champions.png
```

Expected: RGB PNG, exactly 512 × 768, exact title once, exactly six plausible
children, one ball, no badges, brands, or extra text.

- [ ] **Step 4: Commit after both reviews pass**

```bash
git add -- apps/xtream-mock-server/public/marketing/poster/saturday-champions.png
git commit -m "feat(mock-server): add Saturday Champions poster"
```

### Task 9: Validate the Complete Collection

**Files:**
- Inspect: `apps/xtream-mock-server/public/marketing/poster/signal-nine.png`
- Inspect: `apps/xtream-mock-server/public/marketing/poster/orchard-walls.png`
- Inspect: `apps/xtream-mock-server/public/marketing/poster/blue-current.png`
- Inspect: `apps/xtream-mock-server/public/marketing/poster/checkout-at-noon.png`
- Inspect: `apps/xtream-mock-server/public/marketing/poster/vesper-crown.png`
- Inspect: `apps/xtream-mock-server/public/marketing/poster/last-detour.png`
- Inspect: `apps/xtream-mock-server/public/marketing/poster/borrowed-summer.png`
- Inspect: `apps/xtream-mock-server/public/marketing/poster/under-the-floor.png`
- Inspect: `apps/xtream-mock-server/public/marketing/poster/red-winter.png`
- Inspect: `apps/xtream-mock-server/public/marketing/poster/saturday-champions.png`

- [ ] **Step 1: Verify file properties**

```bash
file \
  apps/xtream-mock-server/public/marketing/poster/signal-nine.png \
  apps/xtream-mock-server/public/marketing/poster/orchard-walls.png \
  apps/xtream-mock-server/public/marketing/poster/blue-current.png \
  apps/xtream-mock-server/public/marketing/poster/checkout-at-noon.png \
  apps/xtream-mock-server/public/marketing/poster/vesper-crown.png \
  apps/xtream-mock-server/public/marketing/poster/last-detour.png \
  apps/xtream-mock-server/public/marketing/poster/borrowed-summer.png \
  apps/xtream-mock-server/public/marketing/poster/under-the-floor.png \
  apps/xtream-mock-server/public/marketing/poster/red-winter.png \
  apps/xtream-mock-server/public/marketing/poster/saturday-champions.png
```

Expected: all ten files are 512 × 768, 8-bit RGB PNGs.

- [ ] **Step 2: Verify final hashes**

```bash
shasum -a 256 \
  apps/xtream-mock-server/public/marketing/poster/signal-nine.png \
  apps/xtream-mock-server/public/marketing/poster/orchard-walls.png \
  apps/xtream-mock-server/public/marketing/poster/blue-current.png \
  apps/xtream-mock-server/public/marketing/poster/checkout-at-noon.png \
  apps/xtream-mock-server/public/marketing/poster/vesper-crown.png \
  apps/xtream-mock-server/public/marketing/poster/last-detour.png \
  apps/xtream-mock-server/public/marketing/poster/borrowed-summer.png \
  apps/xtream-mock-server/public/marketing/poster/under-the-floor.png \
  apps/xtream-mock-server/public/marketing/poster/red-winter.png \
  apps/xtream-mock-server/public/marketing/poster/saturday-champions.png
```

Expected: ten non-empty SHA-256 values with no duplicate hashes.

- [ ] **Step 3: Perform pairwise visual review**

Inspect all ten final files. Confirm that the collection communicates ten
different releases through distinct genre, palette, composition, type style,
and medium while retaining small-thumbnail readability. Reject a poster if it
looks like a template reuse, has obvious AI artifacts, or resembles a known
film property.

- [ ] **Step 4: Validate repository scope**

```bash
git status --short
git log --oneline -12
```

Expected: no uncommitted poster assets or plan changes remain. The local
`.superpowers/` visual-companion directory may remain untracked and is excluded
from the asset scope.
