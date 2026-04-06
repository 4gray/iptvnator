# External Wiki Sync

Related:

- [Workspace Shell](./workspace-shell.md)
- [SQLite DB Worker](./sqlite-db-worker.md)

## Summary

- Repo docs are canonical, even when they were originally drafted by an LLM.
- The external Obsidian wiki imports canonical repo docs read-only into `_repo-context/`.
- Higher-level synthesis pages stay outside `_repo-context/` in the wiki's own folders.
- Sync is one-way by default: repo docs -> wiki context.

## Ownership Model

Canonical repo docs include:

1. `docs/architecture/**/*.md`
2. top-level workflow docs such as `README.md`, `GETTING-STARTED.md`, `AGENTS.md`, and `CLAUDE.md`
3. selected module `README.md` files when they describe current code behavior or workflows

The external wiki can add cross-links, feature pages, decision notes, and synthesis pages, but it must not become a second source of truth for the same implementation details.

## Export Scope

The repo-owned exporter writes only to `_repo-context/` inside the external vault.

Current default export scope:

1. `docs/architecture/**/*.md`
2. `README.md`
3. `GETTING-STARTED.md`
4. `AGENTS.md`
5. `CLAUDE.md`
6. selected module `README.md` files

The exporter also generates:

1. `_repo-context/index.md`
2. `_repo-context/repo-map.md`
3. `_repo-context/recent-changes.md`
4. `_repo-context/manifest.json`
5. `_repo-context/state.json`

## Running The Exporter

Set the external vault path in the shell environment:

```bash
export IPTVNATOR_WIKI_VAULT=/absolute/path/to/your/obsidian-vault
```

Then run:

```bash
pnpm wiki:export --mode full
pnpm wiki:export --mode changed
```

You can also override the vault path per command:

```bash
pnpm wiki:export --mode changed --vault /absolute/path/to/your/obsidian-vault
```

If the vault path is missing, the exporter skips cleanly and reports why it did not run.

## Agent Workflow After Changes

After a meaningful implementation change, agents must assess whether canonical repo docs need updates.

Documentation-worthy changes include:

1. new or changed user-visible behavior
2. architecture or data-flow changes
3. non-obvious maintenance workflows
4. new setup, debugging, or operational steps
5. new subsystem contracts or boundaries

Prefer updating an existing authoritative doc before creating a new one:

1. `README.md` for top-level developer or user workflows
2. `docs/architecture/` for architecture, ownership, and behavior contracts
3. the nearest module `README.md` for local usage or behavior

If docs changed and `IPTVNATOR_WIKI_VAULT` is configured, agents should run `pnpm wiki:export --mode changed` before considering the task complete.

## Promotion Workflow

If a wiki page becomes stable enough to be canonical:

1. promote that content back into a repo doc
2. treat the repo doc as the source of truth
3. export again so `_repo-context/` reflects the promoted canonical doc

The wiki page can then either link to the repo-backed generated page or remain as a smaller synthesis page that references the canonical doc.
