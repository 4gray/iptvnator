# Unofficial IPTVnator Websites Blog Cover Design

## Goal

Create one horizontal 16:9 cover image for the blog post “Beware of Unofficial IPTVnator Websites and IPTV Services.” The image should make the distinction between the authentic IPTVnator project and unofficial lookalike websites immediately understandable without repeating the article title inside the artwork.

## Approved Direction

The approved concept is **Official Signal**. A crisp IPTVnator screen-and-broadcast mark is the central artifact. Concentric signal rings establish authenticity and continuity, while two faint, fragmented browser-like panels recede beyond the left and right edges as unofficial copies. A small pale-red warning marker supplies the only caution color. The composition remains legible when cropped into an aspect-ratio blog card.

## Visual System

- Canvas: 16:9 landscape, suitable for a 2200 × 1238 source image.
- Background: matte IPTVnator graphite (`#0a0a08`) with a restrained technical grid and light grain.
- Primary accent: IPTVnator teal (`#20a8a8`, `#38c4c4`, and `#5ee0e0`).
- Warning accent: pale red (`#fdebec`) with muted red detail (`#9f2f2d`).
- Main subject: a screen and broadcast-signal symbol derived from the established IPTVnator app-icon language, rendered as an original illustration rather than a pasted logo.
- Supporting forms: two low-contrast browser silhouettes with broken or dashed edges, clearly secondary to the official signal.
- Material character: flat, editorial, and lightly tactile; no gradients, glass effects, or heavy shadows.
- Text: none inside the final image.

## Composition

The official signal occupies the central safe area, with enough surrounding negative space to remain readable in both the article hero and smaller listing cards. Signal rings form a controlled circular rhythm behind it. The unofficial panels are partly cropped by the canvas edges and carry lower contrast, preventing them from competing with the main mark. The pale-red warning marker sits off-axis as the single second-read detail.

## Constraints

- Do not reproduce or name any unofficial website.
- Do not depict real playlist, channel, stream, account, or subscription content.
- Do not add people, hooded figures, padlocks, shields, phishing hooks, or generic cybersecurity stock imagery.
- Do not use neon, purple-blue AI gradients, glassmorphism, glossy 3D rendering, or dense dashboard UI.
- Do not add text, watermarks, unrelated logos, or trademarked third-party graphics.
- Keep all key elements inside the center-safe crop while allowing the secondary browser silhouettes to bleed beyond the frame.

## Deliverable and Integration

Generate a single project-bound raster cover with the built-in image-generation tool. Save the selected asset under `apps/website/public/blog/` using a descriptive, non-versioned filename. Add its `/iptvnator/blog/...` URL as `heroImage` in `apps/website/src/content/blog/beware-unofficial-iptvnator-websites.mdx`.

Validate the saved dimensions and file type, inspect the final image at full size and as a small thumbnail, run the website build, and verify that the post’s social metadata resolves to the new cover. No release note is required because this is website content and is auto-exempt from the runtime release-note gate.
