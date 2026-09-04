# IPTVnator Website

The website is an Astro static site deployed to GitHub Pages at `https://4gray.github.io/iptvnator/`.

## Blog Comments

Blog posts render Giscus comments from `apps/website/src/components/GiscusComments.astro`.
Giscus stores comments in GitHub Discussions for `4gray/iptvnator` and maps each page to a discussion by `pathname`, including the GitHub Pages base path such as `/iptvnator/blog/why-external-players-help/`.

The embed is wired to the dedicated `Blog comments` discussion category:

- Repository id: `MDEwOlJlcG9zaXRvcnkyMTMxOTQ3Mzg=`
- Category id: `DIC_kwDODLUX8s4C9eBJ`
- Mapping: `pathname`
- Theme: `transparent_dark`

If the category is recreated, query the new category id:

```bash
gh api graphql \
  -f owner=4gray \
  -f name=iptvnator \
  -f query='query($owner:String!, $name:String!) { repository(owner:$owner, name:$name) { discussionCategories(first:25) { nodes { id name slug isAnswerable } } } }'
```

Then update `data-category-id` in `GiscusComments.astro`.

Moderation happens in GitHub Discussions. Maintainers can hide, delete, lock, or move discussions and comments from the repository Discussions UI.

## Download Pages

`/download/` plus `/download/windows/`, `/download/macos/` and `/download/linux/`
are per-OS landing pages (`apps/website/src/pages/download/`). They exist for
search visibility on "IPTVnator <OS> download" style queries and to spare users
the 27-asset GitHub release page; each carries OS-specific install steps,
requirements, an FAQ and `SoftwareApplication` / `FAQPage` / `BreadcrumbList`
structured data. Shared pieces live in `src/components/download/` and reuse the
blog components (`StepRail`, `Alert`, `FaqAccordion`, `CopyCommand`).

### Latest-release resolution

Direct asset links need the release version, so `src/lib/downloads.ts`
resolves it at build time:

1. `GET https://api.github.com/repos/4gray/iptvnator/releases/latest` (8 s
   timeout). The asset list from the *published* release is authoritative:
   options whose file is missing are dropped, sizes and the publish date come
   from the API. `deploy-website.yml` passes `GITHUB_TOKEN` to the build so
   the call is authenticated.
2. Fallback: the root `package.json` version with the asset naming pattern
   from `electron-builder.json`. This is deterministic but cannot prove the
   files exist yet (a version bump lands on `master` before the release is
   published), so a warning is printed. Set `WEBSITE_SKIP_RELEASE_FETCH=1` to
   force it for offline or reproducible builds.

Both paths produce the same page structure. Adding an artifact means adding a
`DownloadOption` (matcher + fallback name) in `downloads.ts`; the pages and the
hub pick it up. The homepage `SoftwareApplication` schema reads the same
resolved version.

`pnpm nx test website` builds the site and runs
`tools/testing/website-download-pages.test.mjs`, which checks titles,
canonicals, direct asset links, JSON-LD, cross-links and sitemap entries
without depending on a specific version.

## Guides

Evergreen how-to posts live in the blog collection next to release notes
(`xtream-codes-setup-guide.mdx`, `stalker-portal-setup-guide.mdx` and
`m3u-playlist-epg-setup-guide.mdx` in `apps/website/src/content/blog/`).
Two conventions set them apart:

- **`faq` frontmatter.** An optional list of `{ q, a }` entries. `BlogPost.astro`
  renders it as an accordion after the body and emits a `FAQPage` JSON-LD block
  next to the `BlogPosting` one, so the answers can surface as rich results.
- **Screenshots from the capture script.** Guide frames are captured by
  `pnpm release:screenshots --group guides` into
  `apps/website/public/blog/guides/screenshots/<slug>-<theme>.png`; the shots are
  declared in `tools/release/screenshots.manifest.json` with `"group": "guides"`
  and never appear in a release run.

`tools/testing/website-guides.test.mjs` (part of `pnpm nx test website`) checks
each guide for the FAQPage schema, a link to the download hub and the presence
of every referenced screenshot in the build output.

## Feature Pages

`/features/` plus one page per feature (`m3u-player`, `xtream-codes-player`,
`stalker-portal-player`, `epg`, `remote-control`) live in
`apps/website/src/pages/features/`. They target "<feature> player" style
searches, reuse the download-page sections, and each carries
`SoftwareApplication` (with `featureList`) / `FAQPage` / `BreadcrumbList`
structured data. The registry in `src/lib/features.ts` drives the hub, the
per-page switcher, the homepage feature cards and
`tools/testing/website-feature-pages.test.mjs`; adding a page means adding one
registry entry and one `.astro` file. Screenshots come only from the
mock-backed guide and release captures, never from the older homepage
screenshots that show real channel names.
