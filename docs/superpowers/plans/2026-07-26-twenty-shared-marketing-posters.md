# Twenty Shared Marketing Posters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate 20 original posters and expose the complete approved poster showcase through both Xtream and Stalker marketing fixtures.

**Architecture:** A new pure Nx library owns provider-neutral poster-showcase metadata. Xtream and Stalker adapt the same ordered fixtures into their respective protocol shapes and independently serve the shared local PNG files.

**Tech Stack:** TypeScript, Nx, Jest, Express, built-in image generation, PNG/sips validation

---

### Task 1: Create the shared fixture library

**Files:**
- Create: `libs/shared/marketing-fixtures/project.json`
- Create: `libs/shared/marketing-fixtures/src/index.ts`
- Create: `libs/shared/marketing-fixtures/src/lib/marketing-movie.fixture.ts`
- Create: `libs/shared/marketing-fixtures/src/lib/marketing-movie.fixture.spec.ts`
- Create: `libs/shared/marketing-fixtures/tsconfig.json`
- Create: `libs/shared/marketing-fixtures/tsconfig.lib.json`
- Create: `libs/shared/marketing-fixtures/tsconfig.spec.json`
- Create: `libs/shared/marketing-fixtures/jest.config.ts`
- Modify: `tsconfig.base.json`

- [ ] Define a provider-neutral fixture type with category key, title, slug,
  description, director, actors, genre, rating, tagline, and year.
- [ ] Move the existing 15 poster-showcase fixtures into the library.
- [ ] Add the 20 approved new fixtures before the existing fixtures.
- [ ] Add Jest coverage for exact counts, unique titles/slugs, ordering, and
  valid category keys.
- [ ] Run `pnpm nx test shared-marketing-fixtures` and
  `pnpm nx lint shared-marketing-fixtures`.

### Task 2: Generate the 20 posters

**Files:**
- Create: `apps/xtream-mock-server/public/marketing/poster/black-harbor.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/the-paper-astronaut.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/summer-static.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/house-of-tides.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/open-late.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/white-room-six.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/field-notes.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/a-thousand-steps.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/the-small-hours.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/copper-rain.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/willow-engine.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/quiet-thunder.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/parallel-kitchens.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/first-string.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/the-long-museum.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/cloud-hotel.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/unpaid-overtime.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/deep-green.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/november-radio.png`
- Create: `apps/xtream-mock-server/public/marketing/poster/the-last-orange.png`

- [ ] Issue one built-in image-generation request per title.
- [ ] Inspect title spelling, composition, originality, and forbidden text.
- [ ] Copy approved outputs into the project and downscale with
  `sips -z 768 512`.
- [ ] Verify every file is an RGB PNG at exactly 512 × 768.
- [ ] Build and inspect a 5 × 4 contact sheet of the final project files.

### Task 3: Adapt Xtream to the shared showcase

**Files:**
- Modify: `apps/xtream-mock-server/src/app/generators/marketing.generator.ts`
- Modify: `apps/xtream-mock-server/README.md`
- Modify: `docs/architecture/xtream-mock-server.md`

- [ ] Replace the local `POSTER_SHOWCASE_MOVIES` metadata with a mapping from
  the shared fixture library.
- [ ] Put showcase movies before generated-artwork movies in `MOVIES`.
- [ ] Keep `listMarketingArtworkFixtures()` limited to the original generated
  artwork pack.
- [ ] Update documented title counts from 45 to 65.
- [ ] Run `pnpm nx lint xtream-mock-server`.

### Task 4: Add the Stalker marketing scenario

**Files:**
- Modify: `apps/stalker-mock-server/src/app/scenarios.ts`
- Modify: `apps/stalker-mock-server/src/app/data-generator.ts`
- Modify: `apps/stalker-mock-server/src/main.ts`
- Modify: `apps/stalker-mock-server/README.md`
- Modify: `docs/architecture/stalker-mock-server.md`

- [ ] Add `marketingFixture?: true` and MAC `00:1A:79:00:00:07`.
- [ ] Build deterministic Stalker VOD categories/items from the shared fixture.
- [ ] Add the local poster asset route backed by the shared PNG directory.
- [ ] Document credentials, offline artwork behavior, and screenshot use.
- [ ] Run `pnpm nx lint stalker-mock-server`.

### Task 5: Verify both providers

**Files:**
- Inspect all files changed above.

- [ ] Run `pnpm nx test shared-marketing-fixtures`.
- [ ] Start both mock servers with Nx.
- [ ] Assert Xtream returns all 35 showcase titles and the 20 new titles first.
- [ ] Assert Stalker marketing VOD returns all 35 showcase titles and the 20 new
  titles first.
- [ ] Fetch every new poster URL from both servers and assert `image/png`.
- [ ] Run `pnpm run release:notes:validate` and `git diff --check`.
- [ ] Confirm docs are updated; skip a release note because mock-server and
  documentation paths are release-gate exempt.
