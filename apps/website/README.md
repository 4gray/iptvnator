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

`/download/` plus `/download/windows/`, `/download/macos/`, `/download/linux/`
and `/download/docker/` (the self-hosted browser version: quick start, variables,
tags, FAQ, with `docker/README.md` as the reference behind it) are landing pages (`apps/website/src/pages/download/`). They exist for
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

Two of the suites drive the built site in a real browser:
`tools/testing/website-screenshot-showcase.test.mjs` (the home page channel
switcher: autoplay, hover/focus pausing, keyboard navigation, deferred frame
sources) and `tools/testing/website-home-sections.test.mjs` (the hero and
download panel following the visitor's OS, the copy buttons). They share
`tools/testing/website-browser-support.mjs`, which serves `dist/apps/website`
on a loopback port and launches Chromium from the Playwright download or,
failing that, the system Chrome/Chromium channel. Without any Chromium the
browser half is **skipped locally** (the structural checks still run) and
**fails in CI**, so a green local run only proves the interactions when a
browser was found — run `pnpm exec playwright install chromium` once if the
skip shows up in your output.

## Guides

Evergreen how-to posts live in the blog collection next to release notes
(`xtream-codes-setup-guide.mdx`, `stalker-portal-setup-guide.mdx`,
`m3u-playlist-epg-setup-guide.mdx` and `offline-downloads-guide.mdx` in
`apps/website/src/content/blog/`). Three conventions set them apart:

- **`ContentDisclaimer`.** Every guide opens with
  `src/components/blog/ContentDisclaimer.astro` right after its intro: the
  `general` variant states that IPTVnator ships no content, the `offline`
  variant (downloads, recordings) adds what the feature is for and that keeping
  a copy is governed by the provider's terms and local law. Reuse it instead of
  rewriting the notice per post, and keep the surrounding prose to "content you
  already stream", never "download from your provider".

- **`faq` frontmatter.** An optional list of `{ q, a }` entries. `BlogPost.astro`
  renders it as an accordion after the body and emits a `FAQPage` JSON-LD block
  next to the `BlogPosting` one, so the answers can surface as rich results.
- **Screenshots from the capture script.** Guide frames are captured by
  `pnpm release:screenshots --group guides` into
  `apps/website/public/blog/guides/screenshots/<slug>-<theme>.png`; the shots are
  declared in `tools/release/screenshots.manifest.json` with `"group": "guides"`
  and never appear in a release run.
  The download-manager shots need real transfers, so the Xtream mock's
  `marketing` scenario serves movies and episodes from generated local bytes
  (`downloadStreamFixture: 'local-media'`) instead of redirecting to the public
  HLS stub, and the capture stubs Electron's folder dialog so "Change Folder"
  authorizes a folder inside the isolated data dir rather than the real OS
  Downloads folder (`installDownloadFolderDialogStub` in
  `tools/release/capture-app-driver.ts`).

`tools/testing/website-guides.test.mjs` (part of `pnpm nx test website`) checks
each guide for the FAQPage schema, a link to the download hub and the presence
of every referenced screenshot in the build output.

## Blog Tags

Blog tags are a closed vocabulary in `apps/website/src/lib/blog-tags.ts`
(`release`, `guide`, `troubleshooting`, `playback`, `m3u`, `xtream-codes`,
`stalker-portal`, `epg`, `macos`, `security`). The content collection schema
only accepts those slugs, so a typo in a post's `tags:` fails the build. Every
tag with at least one published post gets a hub page at `/blog/tag/<tag>/`
(`src/pages/blog/tag/[tag].astro`, `CollectionPage` + `BreadcrumbList` JSON-LD),
the blog index and the hubs show a "Topics" rail with post counts
(`BlogTagRail.astro`), and every chip on a card or a post header links to its
hub (`BlogTagChip.astro`). The cards are `<article>` elements with the title
link stretched over the whole card, because a card that is one big `<a>` cannot
hold chip links.

Add a tag only when it will hold more than one post for good: each tag is an
indexable page, and a hub with a single post is a thin page. Add the slug to the
registry with a label and a one-sentence description; nothing else needs to
change. `tools/testing/website-blog-tags.test.mjs` checks the rail, every hub,
the chip targets, the sitemap and the absence of nested anchors.

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

## Comparison Pages

`/compare/` plus one page per decision the app asks users to make
(`m3u-vs-xtream-vs-stalker`, `playback-engines`, `desktop-vs-browser`) live in
`apps/website/src/pages/compare/`. They compare IPTVnator's own options against
each other, never other products, so every claim is checkable against this
repository; the registry is `src/lib/comparisons.ts`.

Each page opens with a one-paragraph verdict (`CompareHero`), carries at least
one `ComparisonTable` (cells are `true`, `false` or a qualifying string) and
emits `WebPage` / `FAQPage` / `BreadcrumbList` JSON-LD from
`src/lib/comparison-schema.ts` — deliberately not `SoftwareApplication`, since
these pages are guidance rather than a product listing, and
`tools/testing/website-compare-pages.test.mjs` asserts that.

Naming a competitor on these pages is a product decision, not a technical one.
Phase 3 of `.plans/2026-09-03-marketing-landing-pages.md` covers that and is
still open.
