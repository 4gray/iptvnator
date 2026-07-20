# Hide Type Badges in Homogeneous Portal Catalogs

## Context

The shared `GridListComponent` renders catalog items after the user has already
selected Live TV, VOD, or Series in the portal rail. Every item in these grids
has the same content type, so the `LIVE`, `VOD`, and `SERIES` badges repeat
information that is already established by the surrounding navigation.

Mixed-content surfaces such as portal search use `ContentCardComponent`, where
the type badge remains useful for distinguishing results.

## Design

Remove the type-badge markup and its dedicated styles from
`GridListComponent`.

Keep the component's `type` input. It still controls provider-neutral behavior
that is unrelated to the badge:

- choosing artwork placeholder icons;
- limiting country-prefix stripping to live content;
- selecting poster/logo presentation behavior.

Do not change `ContentCardComponent` or any search, favorites, recently added,
or dashboard surface. Their badges remain unchanged.

## Affected Portals and Views

Because Xtream and Stalker both route their category pages through the shared
portal catalog view, removing the badge from `GridListComponent` covers:

- Xtream Live TV, VOD, and Series homogeneous grids;
- Stalker Live TV, VOD, and Series homogeneous grids;
- the Xtream Live TV all-items grid.

## Testing

Update the focused `GridListComponent` tests to prove that no `.type-badge` is
rendered for `live`, `vod`, or `series`, while the `type` input continues to
drive existing title and placeholder behavior.

Run the affected shared portal UI test target and the closest catalog feature
test target. Since this is a visible portal workflow change, run the closest
Xtream and Stalker Playwright coverage when available; otherwise perform the
strongest available targeted validation and document any skipped UI automation.

## Documentation Impact

The canonical UI guideline already says not to add redundant badges or a
second selection system. No canonical documentation change is required beyond
this design record because no route, architecture boundary, setup workflow, or
subsystem contract changes.
