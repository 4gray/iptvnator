# Release cover artwork

Use this recipe for IPTVnator announcement covers in the sculptural graphite
style selected for 0.24. It is a reusable visual direction; adapt it when the
user requests another style. Release ordering and publication remain governed
by the [release pipeline](../architecture/release-pipeline.md).

## References and inputs

- [Approved 0.24 cover](../../apps/website/public/blog/v0-24/announce.png):
  composition, material, lighting and typography reference.
- [Application icon](../../apps/website/src/assets/logo.png): identity reference;
  retain the TV outline, short stand, horizontal foot and Wi-Fi symbol.
- [Exact successful 0.24 edit prompt](release-cover-prompt-0.24.txt): archival
  wording. Its Image 1 was an intermediate abstract-ribbon cover. For future
  releases, use the approved final cover above with the reusable prompt below;
  the intermediate image is not required.

Choose a display version and two or three short, verified release highlights.
For 0.24 the labels were “Programme guide”, “Fullscreen browsing” and “Stream
info”. The display version was **0.24**, while the package and tag remained
**0.24.0** and **v0.24.0**. Artwork text never changes the technical version.

## Generate and review

Use the imagegen skill and built-in image generation. Inspect both reference
images first and give each its stated role. Do not silently switch to an API
CLI or substitute a code-generated graphic. Produce one horizontal image.

Fill every placeholder in the prompt; omit the third caption when there are
only two highlights. Preserve the style reference's typography as closely as
possible: the named fonts describe visual character, not an exact font-file
guarantee from the image model.

```text
Use case: identity-preserve
Asset type: one horizontal 2:1 IPTVnator release cover, finished raster artwork.
Image 1: approved previous release cover; style and composition reference.
Image 2: authentic IPTVnator app icon; identity reference.

Create the next release cover in the visual language of Image 1. Use warm
off-white uncoated paper, graphite ink, brushed graphite metal and one restrained
blue accent matching the small application logo. Use subtle directional daylight,
delicate contact shadows, crisp geometry and generous negative space.

The main artwork is an unmistakable sculptural version of the TV-and-Wi-Fi icon.
Keep its broad rectangular TV outline with softly rounded corners, visible short
central stem and horizontal foot. Inside are three clearly separated nested
Wi-Fi arcs above a small diamond-like dot. Build the frame from thin layered
graphite ribbons. Extend the side edges into staggered parallel strips on the
left and a restrained flowing wave on the right. These extensions belong to one
continuous object; the TV, stand and Wi-Fi symbol must remain immediately legible.
Use slight relief depth and a mostly frontal editorial perspective.

Keep the small authentic blue icon and IPTVnator wordmark at upper left. Place
the display version at lower right, in a distinctive heavy compressed industrial
sans with squared mechanical numerals, like Druk or Monument Grotesk. Set the
feature captions as a compact left-aligned stack at lower left, in a precise
JetBrains Mono-like monospaced face. Use a refined Cabinet Grotesk-like wordmark.
All lettering is solid graphite. Keep the central sculpture clear of every label.

Render only these exact strings:
"IPTVnator"
"{{DISPLAY_VERSION}}"
"{{HIGHLIGHT_1}}"
"{{HIGHLIGHT_2}}"
"{{HIGHLIGHT_3}}"

No other words, numbers or pseudo-text. Preserve exact capitalization and spelling.
No generic thin geometric sans, serif, gradient lettering, neon edges, purple/blue
glow, glass cards, floating balls, dashboard, screenshots, literal video content,
landscapes, old CRT knobs or antenna rods. This is conceptual brand artwork,
not an application screenshot. Keep the paper-and-graphite composition breathable,
asymmetric and readable at social-preview size.
```

Review the result for exact text, recognizable icon silhouette, separated Wi-Fi
arcs, visible stand, clear captions, safe margins and the intended type contrast.
Inspect the actual image; prompt compliance alone is not visual verification.

Save candidates non-destructively in the release's asset directory, and retain
the exact filled prompt, input roles and generation mode alongside preparation
materials. Once a cover is selected, copy it to the canonical announcement asset
and update the blog hero reference if the blog uses it. Preserve earlier variants.
The usual path shapes are:

```text
apps/website/public/blog/<vX-Y>/announce-v<N>.png
apps/website/public/blog/<vX-Y>/announce.png
```

An imagegen cover complements the deterministic highlight cards and guarded
screenshots; it does not replace their release-pipeline steps. Cover generation
or selection does not authorize merging, tagging, publication or posting an
announcement.
