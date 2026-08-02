# Unofficial Websites Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, validate, and publish a branded 16:9 cover image for the unofficial IPTVnator websites safety post.

**Architecture:** Create one project-bound raster asset with the built-in image-generation tool, then reference it through the blog collection’s existing `heroImage` frontmatter field. Keep the artwork text-free and independent of real services or user data so the same file is safe for the article hero, blog cards, and Open Graph metadata.

**Tech Stack:** Built-in OpenAI image generation, Astro 5 content collections, static assets under `apps/website/public/`, Nx website build.

---

## File Map

- Create `apps/website/public/blog/beware-unofficial-iptvnator-websites.png`: final 16:9 raster cover.
- Modify `apps/website/src/content/blog/beware-unofficial-iptvnator-websites.mdx`: add the public asset URL to `heroImage` frontmatter.
- No production component or schema changes are needed because the existing blog layout, cards, structured data, and Open Graph head already consume `heroImage`.

### Task 1: Generate and select the cover

**Files:**
- Create: `apps/website/public/blog/beware-unofficial-iptvnator-websites.png`

- [ ] **Step 1: Generate one horizontal image with the built-in image tool**

Use this prompt exactly as the base generation brief:

```text
Use case: stylized-concept
Asset type: IPTVnator blog header and social-sharing cover
Primary request: Create a premium editorial illustration that distinguishes the authentic IPTVnator project from unofficial lookalike websites. A crisp, original screen-and-broadcast-signal symbol derived from IPTVnator's established app-icon language is the central protected artifact. Two faint, fragmented browser-like panels recede beyond the left and right canvas edges as unofficial copies. Add one small pale-red warning marker as the only caution accent.
Scene/backdrop: matte near-black graphite field with a restrained technical grid and subtle tactile grain
Subject: central teal television-screen outline with broadcast arcs, concentric signal rings behind it, a small verification check attached to the central artifact, low-contrast broken browser silhouettes at both edges
Style/medium: high-end flat editorial technology illustration, minimalist, precise, lightly tactile, strong silhouette, not a UI screenshot
Composition/framing: horizontal 16:9 hero cover; central subject inside the middle 60 percent safe area; generous negative space; edge browser silhouettes may bleed out of frame; readable as a small blog-card thumbnail
Lighting/mood: calm, authoritative, protective, restrained contrast
Color palette: #0a0a08 graphite, #121210 charcoal, IPTVnator teal #20a8a8 / #38c4c4 / #5ee0e0, pale red #fdebec with muted red #9f2f2d, tiny warm-bone highlights #f0f0eb
Materials/textures: matte surfaces, fine grid, very subtle paper-like grain
Constraints: no text; no named or recognizable unofficial website; no real playlist, channel, stream, account, subscription, or copyrighted media content; no third-party logos; no watermark; keep the core mark original rather than pasting a logo
Avoid: people, hooded figures, padlocks, shields, phishing hooks, generic cybersecurity stock imagery, neon, purple-blue AI gradients, glossy 3D, glassmorphism, heavy shadows, dense dashboards, excessive warning symbols
```

Expected: one coherent 16:9 cover with the official signal dominant and the unofficial browser forms visibly secondary.

- [ ] **Step 2: Inspect the generated image at full size**

Open the generated bitmap with the local image viewer and verify all of the following:

- the canvas is horizontal and close to 16:9;
- the central screen/signal mark is crisp and remains inside the middle safe area;
- no text, watermark, third-party branding, real content, or malformed pseudo-UI appears;
- the teal and pale-red accents match the approved palette;
- the result is flat and editorial rather than glossy, neon, or generic cybersecurity art.

Expected: every check passes. If exactly one visual defect remains, perform one targeted edit that names only that defect and repeats all invariants above, then inspect again.

- [ ] **Step 3: Save the selected asset into the project**

Copy the selected built-in output from its generated-images location to:

```text
apps/website/public/blog/beware-unofficial-iptvnator-websites.png
```

Expected: the project-bound final exists at the exact path and the selected output is not referenced from the generated-images directory.

- [ ] **Step 4: Verify the file and thumbnail legibility**

Run:

```bash
sips -g format -g pixelWidth -g pixelHeight apps/website/public/blog/beware-unofficial-iptvnator-websites.png
sips -Z 480 apps/website/public/blog/beware-unofficial-iptvnator-websites.png --out /tmp/iptvnator-unofficial-sites-cover-thumb.png
```

Expected: PNG format, landscape dimensions close to 16:9, and a 480-pixel thumbnail whose central signal remains clearly readable when inspected.

### Task 2: Connect the cover to the blog post

**Files:**
- Modify: `apps/website/src/content/blog/beware-unofficial-iptvnator-websites.mdx`

- [ ] **Step 1: Add the existing `heroImage` frontmatter field**

Insert this line immediately after `author: 4gray`:

```yaml
heroImage: /iptvnator/blog/beware-unofficial-iptvnator-websites.png
```

Expected: the post uses the same public-URL convention as existing release and guide posts.

- [ ] **Step 2: Verify the frontmatter reference and asset pairing**

Run:

```bash
rg -n "^heroImage: /iptvnator/blog/beware-unofficial-iptvnator-websites\.png$" apps/website/src/content/blog/beware-unofficial-iptvnator-websites.mdx
test -f apps/website/public/blog/beware-unofficial-iptvnator-websites.png
```

Expected: `rg` prints exactly one frontmatter match and `test` exits successfully.

### Task 3: Validate the website integration

**Files:**
- Verify: `apps/website/src/content/blog/beware-unofficial-iptvnator-websites.mdx`
- Verify: `apps/website/public/blog/beware-unofficial-iptvnator-websites.png`

- [ ] **Step 1: Bootstrap Nx discovery if dependencies are absent**

If `node_modules` is missing, run:

```bash
pnpm install --frozen-lockfile
```

Then run:

```bash
pnpm nx show projects
```

Expected: Nx lists workspace projects and includes `website`.

- [ ] **Step 2: Build the website**

Run:

```bash
pnpm nx build website
```

Expected: the Astro build succeeds and emits the blog post under `dist/apps/website/blog/beware-unofficial-iptvnator-websites/`.

- [ ] **Step 3: Verify the built metadata and static asset**

Run:

```bash
rg -n "beware-unofficial-iptvnator-websites\.png" dist/apps/website/blog/beware-unofficial-iptvnator-websites/index.html
test -f dist/apps/website/blog/beware-unofficial-iptvnator-websites.png
```

Expected: the built HTML references the cover in article/Open Graph metadata and the static file exists in the built blog directory.

- [ ] **Step 4: Review scope and release-note policy**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; the final implementation changes only the generated cover and the blog post frontmatter beyond the already-approved design and plan documents. Skip `.changes/` because website content is auto-exempt from the runtime release-note gate. Canonical architecture documentation does not need an update because no runtime behavior, contract, route, or workflow changed.

- [ ] **Step 5: Commit the implementation**

```bash
git add apps/website/public/blog/beware-unofficial-iptvnator-websites.png apps/website/src/content/blog/beware-unofficial-iptvnator-websites.mdx docs/superpowers/plans/2026-08-02-unofficial-websites-cover.md
git commit -m "docs(website): add unofficial sites post cover"
```

Expected: the generated cover, frontmatter integration, and implementation plan are committed together.
