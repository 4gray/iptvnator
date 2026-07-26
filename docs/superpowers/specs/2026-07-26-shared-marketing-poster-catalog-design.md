# Shared Marketing Poster Catalog Design

## Goal

Add 20 original fictional movie posters in the same approved theatrical style
as the existing poster showcase, then expose the complete showcase through both
the Xtream and Stalker mock servers for deterministic screenshot capture.

## Poster set

The new titles are:

1. Black Harbor — maritime crime thriller
2. The Paper Astronaut — stop-motion family animation
3. Summer Static — coming-of-age drama
4. House of Tides — gothic coastal mystery
5. Open Late — workplace comedy
6. White Room Six — psychological thriller
7. Field Notes — nature documentary
8. A Thousand Steps — mountain sports drama
9. The Small Hours — urban romantic drama
10. Copper Rain — neo-noir
11. Willow Engine — family fantasy
12. Quiet Thunder — contemporary western drama
13. Parallel Kitchens — science-fiction comedy
14. First String — music drama
15. The Long Museum — art mystery
16. Cloud Hotel — family animation
17. Unpaid Overtime — office satire
18. Deep Green — survival adventure
19. November Radio — period drama
20. The Last Orange — Mediterranean family drama

Every poster is an RGB PNG at exactly 512 × 768 pixels. The artwork uses one
clear theatrical key image, a legible English title exactly once, original
fictional people or characters, and no actor names, taglines, credits, brands,
logos, watermarks, or copied franchise imagery.

## Shared fixture boundary

A new pure Nx utility library owns the manually approved movie metadata:

`libs/shared/marketing-fixtures`

Its public API exports the fixture type, the existing 15 showcase movies, the
new 20 movies, and the combined 35-title showcase. The fixture uses provider-
neutral category keys. Xtream and Stalker translate those keys to their own
category identifiers and response shapes.

This keeps one source of truth without making either mock application import
from the other application. The existing 30-title generated artwork manifest
remains separate: it still owns its matched poster/backdrop generation jobs,
while the shared showcase owns manually approved local posters and uses each
server's deterministic backdrop fallback where needed.

## Xtream integration

`marketing.generator.ts` imports the shared showcase and adapts it to
`MarketingMovie`. Showcase movies are ordered before the original generated
artwork movies so their posters appear in initial marketing catalog grids.
The existing `marketing:marketing` credentials remain unchanged.

The existing Xtream artwork route continues to serve PNGs from
`apps/xtream-mock-server/public/marketing/poster/`, even though catalog URLs
end in `.svg` for fallback compatibility.

## Stalker integration

Stalker adds a dedicated `marketing` scenario at MAC
`00:1A:79:00:00:07`. For this scenario, VOD categories and items come from the
shared showcase instead of faker. The list uses ordinary non-series VOD shapes,
stable IDs, local cover URLs, fictional metadata, and deterministic playback
commands.

Stalker also exposes `/assets/marketing/poster/:slug` and reads the same
committed PNG directory. It serves the asset itself rather than depending on
the Xtream server being online. Missing files return 404; the marketing
scenario must never emit a missing poster URL.

## Screenshot visibility

The 20 new movies are first in the combined showcase. Both provider adapters
preserve that order, making new posters visible on the first catalog pages
used for screenshots. All artwork is local and requires no internet access.

## Verification

- Shared fixture tests prove exactly 35 unique titles/slugs, with the 20 new
  entries first and valid provider-neutral category keys.
- All 20 new PNGs are inspected and verified as RGB 512 × 768 images.
- Xtream `marketing:marketing` returns all 35 showcase titles and every new
  poster URL responds with `image/png`.
- Stalker MAC `00:1A:79:00:00:07` returns the same showcase and every new cover
  URL responds with `image/png`.
- Run the shared fixture tests, both mock-server lints, release-note validation,
  and targeted HTTP smoke checks.
