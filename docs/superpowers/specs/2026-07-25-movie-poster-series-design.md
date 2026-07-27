# Fictional Movie Poster Series Design

## Objective

Create ten original fictional movie posters for IPTVnator mock data and
marketing screenshots. The posters should feel like unrelated real theatrical
releases collected by a streaming service, rather than a coordinated AI art
series.

The existing poster assets are not visual references. The user-provided
streaming-catalog screenshot is a collection-level reference for simplicity,
genre legibility, and commercial poster conventions only. No individual poster
from it may be reproduced or closely imitated.

## Output Contract

- Destination:
  `apps/xtream-mock-server/public/marketing/poster/`
- Format: RGB PNG
- Final dimensions: 512 × 768 pixels
- Typography: the English movie title only
- Exclude actor names, taglines, credit blocks, studios, brands, and watermarks
- Use lowercase kebab-case filenames derived from the title

## Visual Direction

The series uses different visual languages by genre:

- thrillers may use large faces and one restrained environmental cue;
- dramas may use a quiet scene or a single symbolic composition;
- comedies may use bright studio backgrounds and simple ensemble poses;
- animation may use one expressive original character and a clear environment;
- fantasy and science fiction may use one hero or silhouette with one large
  world-building motif.

Every poster should remain readable as a small catalog thumbnail. Prefer one
clear idea, one dominant focal point, a limited palette, and no more than three
prominent characters. Avoid hyper-detailed concept art, excessive cinematic
lighting, glossy AI-style texture, and dense montage unless the genre requires
a restrained ensemble.

All characters, settings, titles, costumes, props, and graphic devices must be
original. Do not use recognizable actors or reproduce franchise characters,
signature symbols, famous poses, or identifiable poster layouts.

## Poster Lineup

1. `SIGNAL NINE` — urban conspiracy thriller; two leads and a subway signal.
2. `ORCHARD WALLS` — humane drama; one character in a quiet landscape.
3. `BLUE CURRENT` — family animation; an original underwater protagonist.
4. `CHECKOUT AT NOON` — comedy; a bright ensemble composition.
5. `VESPER CROWN` — fantasy; one hero and one large symbolic object.
6. `LAST DETOUR` — road action film; a car and two characters.
7. `BORROWED SUMMER` — romantic drama; two people in warm natural light.
8. `UNDER THE FLOOR` — horror; one minimal unsettling image.
9. `RED WINTER` — space survival film; a silhouette and a planet.
10. `SATURDAY CHAMPIONS` — family sports comedy; a colorful team composition.

## Production Sequence

Use the built-in image-generation tool, with one distinct prompt and generation
call per poster. Generate at the tool's native portrait size, inspect the
result, then downscale the selected output to 512 × 768 and save it in the
destination directory.

Begin with two contrasting samples, `ORCHARD WALLS` and `BLUE CURRENT`, so the
user can validate both live-action and animated directions. Generate the
remaining eight only after that review.

## Acceptance Checks

For each poster:

1. Confirm the title is spelled exactly once and remains legible at thumbnail
   size.
2. Confirm the subject, composition, and palette clearly communicate the genre.
3. Reject recognizable actors, existing characters, franchise motifs, copied
   layouts, malformed faces or hands, extra text, logos, and watermarks.
4. Confirm the final file is an RGB PNG at exactly 512 × 768 pixels.
5. Inspect the final downscaled asset, not only the native generated image.

## Repository Impact

This work adds mock-server marketing assets only. It does not change runtime
behavior, architecture, data flow, or public APIs. Canonical repository
documentation, release notes, unit tests, and E2E tests are not required.
Validation is limited to file format, dimensions, visual inspection, and final
workspace status.
