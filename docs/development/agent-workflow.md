# Agent development workflow

Common startup rules live in [AGENTS.md](../../AGENTS.md). This document holds
procedures and conventions to read when they apply, not extra startup imports.

## Maintaining canonical knowledge

After meaningful changes, assess documentation before declaring completion.
Meaningful changes include user-visible behavior, architecture/data flow,
maintenance/setup/debugging workflows, and subsystem contracts. Formatting,
behavior-preserving refactors and isolated test changes need no doc update.
Prefer the existing authoritative architecture doc or nearest module README;
README.md owns top-level user/developer entry points. Update stale routes,
paths, commands and contracts you encounter, or explicitly flag unresolved
claims in the final summary. Repo docs remain canonical regardless of authorship.

Keep AGENTS.md limited to repository-wide constraints and task routing. Do not
add feature histories, method lists, schema inventories or troubleshooting
procedures to it. CLAUDE.md imports AGENTS.md; do not mirror common prose by hand.
Use [the context map](../maintenance/agent-context-map.md) for the owning document
and relevant skill. Read multiple contracts for cross-domain work. Add a new
canonical document only when no existing owner fits; link it from the map.

When relocating knowledge, compare both sources and the destination, retain
unique exceptions and rationale, and record corrections with code evidence.
The [2026-09 migration ledger](../maintenance/agent-guidance-migration.md) records
the initial move; it is an audit artifact, not required reading for feature work.
Later normal edits maintain the canonical docs, not duplicate historical prose.

Run `pnpm run agents:validate` after guidance changes. It checks line/byte budgets,
root imports and local navigation links/anchors, including migration destinations.
Line budgets count LF, CRLF and standalone CR endings consistently.
Markdown navigation is parsed with the already-declared `marked` dependency;
undefined explicit references (including shortcut images) are errors, and code examples are excluded.
Backticked concrete paths in root guidance and the context map are checked from
the repository root, including unknown top-level directories and filenames.
Write generic filenames as prose; commands, templates, globs, URLs, package
aliases and dotted code symbols are excluded. Bare dotted names with conventional
file suffixes (such as .md, .json or .ts) are treated as filenames. Use a `./`
prefix or Markdown link for other ambiguous filenames that resemble code symbols.
Explicit relative literals denote paths, including spaces, filesystem punctuation and hyphenated words.
Put executable command examples in fenced code when their syntax also looks like a path.
Multi-part dotfiles are path candidates too.
Conventional extensionless filenames such as Dockerfile, Makefile and LICENSE
are also path candidates; use an explicit `./` prefix for other extensionless files.
Link paths and fragments are decoded separately so encoded filename delimiters
stay in the filename. Fenced and indented examples
do not count as root guidance imports or satisfy the required Claude import.
The required Claude import must be an unformatted standalone line in a top-level
paragraph; headings, quotes and list items do not satisfy it.
The parsed HTML tree also verifies that this paragraph is outside HTML containers,
including templates split across Markdown tokens. Generated HTML is inspected
in memory only; it is never executed or emitted.
Heading anchors decode HTML character references in text and use `github-slugger`
for GitHub-compatible character filtering and duplicate suffixes.
Only headings present outside inert HTML containers contribute slugs or duplicate counters.
Explicit HTML anchors use `parse5`, excluding comments, scripts, styles and template contents.
Rendered HTML anchor and image-map area hrefs and image sources use the same local-reference checks
as Markdown links, including decoded attributes and fragment validation.
URL attributes remove ASCII tabs/newlines throughout and discard surrounding
ASCII control/space characters before resolution.
Iframe/embed sources and object data attributes are document references and retain Markdown-target anchor checks.
Inline iframe srcdoc documents are traversed too, with their own fragment anchors.
Explicit srcset attributes must contain at least one parsed candidate.
Image and media references require nonempty targets that resolve to files, not directories.
Image references check file existence without interpreting image fragments as
Markdown headings; document links keep anchor checks even when sharing a target.
HTML video, audio, source and track `src` assets and video posters use the same
existence checks as images. Entity decoding uses full HTML text/attribute rules,
including references whose semicolon may be omitted.
Inline guidance imports are rejected after punctuation as well as whitespace.
At-signs inside external URLs are excluded from the import scan.
Extensionless inline candidates are also imports when they resolve to repository files,
checking the full filename before prefixes at ASCII/Unicode prose separators.
Declared scoped dependencies, scope wildcards and matching TypeScript path aliases
are recognized as package/alias mentions. Traversal and document-file imports are
rejected before those exemptions, including document paths with fragments or queries.
All recognized Markdown extensions share the document-import guard; reStructuredText
and AsciiDoc, PDF, Word, OpenDocument, RTF, Org and TeX documents are also excluded
from package exemptions. Recognized extensionless guidance names (including AGENTS,
CLAUDE, INSTRUCTIONS and README) are excluded in package subpaths too. URL-encoded
paths do not receive package exemptions. TypeScript configuration is parsed as JSONC.
Declared packages also permit safe subpaths; exact aliases stay exact.
Declared package mentions may include a version (including semver comparators and wildcard ranges) or dist-tag qualifier.
Qualifier handling includes unscoped names; terminal sentence punctuation is
removed before matching a declared package, as are straight/curly apostrophe possessives.
Unicode punctuation and ASCII commas, semicolons, colons, question/exclamation marks
separate package mentions from adjacent prose.
Markdown destinations decode HTML entities before URI parsing, matching rendered links.
Heading-anchor lookup is limited to Markdown targets. Source-file line fragments,
PDF page fragments and other non-Markdown fragments retain file-existence checks.
The import scan separates HTML block/table elements and includes visible text and literal backticks; it excludes parsed code nodes and non-rendered containers.
Navigation uses the parsed rendered tree too. Temporary in-memory markers retain
definition, unresolved-reference and literal-path metadata, so Markdown inside
inert templates is excluded consistently with raw HTML navigation.
Image source sets use `parse-srcset` to check each candidate URL. Root-relative
literals never suppress source-relative definition checks.
The Nx test hash includes `marked`, `parse5`, `github-slugger`, `parse-srcset` and `typescript`
so dependency changes invalidate parser coverage.
It cannot prove semantic equivalence; review changed contracts as well.

## Protected Markdown edits

Never run whole-file `prettier --write` on AGENTS.md, CLAUDE.md or docs/**.
Upstream formatting is not uniformly Prettier-clean: whole-file writes can
corrupt nested list indentation or change a literal continuation into a bullet.
Format only intended new lines. If accidental formatting occurred, reconstruct
from the pre-edit version and reapply only intended changes; preserve unrelated
user edits. Use the merge-base version only if it actually represents that
pre-edit state. Review the diff rather than blindly restoring an older branch.

## Plans and completion reports

Save only finalized plans in `.plans/YYYY-MM-DD-short-topic.md`; use numeric
suffixes for collisions. Do not save drafts or questions there. If an active
mode forbids writes, save the approved plan on entering execution.
Completion reports list changed docs, tests added/updated, commands and results,
skipped validation with reasons, and release-note status. A docs-only task needs
Markdown/link validation, not app unit/E2E tests. Tooling changes need their own tests.

## Repository skills

Repository skills live under `.codex/skills/`. Descriptions are trigger-only,
begin with `Use when`, and each skill is at most 500 words. Frontmatter owns
trigger descriptions; avoid copying them into navigation prose. Skills provide
workflow and links to authoritative contracts, not a second contract copy.
`release-cut` and `release-notes` have byte-identical `.claude/skills/` mirrors.
Run `pnpm run skills:validate` after changing a committed skill or a literal
path it documents. New guidance tooling belongs to the existing
`repository-skills` Nx project; no new project is needed for another validator.

## Angular conventions

Use signal-based queries (`viewChild`, `viewChildren`, `contentChild`,
`contentChildren`) and inputs/outputs (`input`, `output`). For required queries,
use `viewChild.required`. Unwrap signals when passing values in templates:

```typescript
readonly menu = viewChild.required<MatMenu>('menuRef');
readonly title = input.required<string>();
readonly size = input<number>(10);
readonly clicked = output<void>();
readonly count = signal(0);
readonly doubled = computed(() => this.count() * 2);
```

```html
<button [matMenuTriggerFor]="menu()">Open Menu</button>
```

Use `signal`, `computed`, `effect` and `linkedSignal` for reactive state. Existing
host bindings/listeners use `@HostBinding` and `@HostListener`; this relocation
does not change that convention. Prefer `@if`, `@for` (with a stable `track`),
and `@switch` over the legacy structural directives. A signal is a function;
passing `menu` instead of `menu()` to Material supplies the wrong value.

## Adding behavior across layers

For IPC, define the handler in the appropriate Electron events module,
register it in the event bootstrap, expose a typed preload method, and consume
it through the renderer service. Keep channel contracts typed in
`ElectronBridgeApi`; use the database worker contract for heavy database work.
See [Electron security](../architecture/electron-security.md) and
[DB worker ownership](../architecture/sqlite-db-worker.md).

For a playlist source, extend the shared playlist type, add the backend event
handler, add the import UI under `libs/playlist/import/feature`, and update
state actions/effects. Preserve runtime capabilities and migration behavior.
NgRx owns M3U global state; portal/feature state uses composed NgRx Signal Store;
component-local state uses Angular signals. Avoid expanding large classes:
extract components/services or `with*` store features before exceeding limits;
shared types belong in their own contract modules. The hard production limit
is 400 (not a variable 350–400); target under 300. See
[Nx file-size policy](../architecture/nx-workspace-boundaries.md#typescript-file-size).

## Build and serve commands

Use local `pnpm nx` for underlying project targets. Package scripts are the
supported entry points for composed tasks:

| Task | Command |
| --- | --- |
| Web development | `pnpm run serve:frontend` |
| PWA development | `pnpm nx serve web --configuration=pwa` |
| Electron development | `pnpm run serve:backend` |
| Electron frontend | `pnpm run build:frontend` |
| PWA frontend | `pnpm run build:frontend:pwa` |
| Electron backend | `pnpm run build:backend` |
| Package without installers | `pnpm run package:app` |
| Create installers | `pnpm run make:app` |

Electron backend build depends on the web build; outputs live under
`dist/apps/electron-backend` and `dist/apps/web` and packaging combines them.
Use [the validation map](../architecture/validation-map.md) for test/lint tasks
and [the release pipeline](../architecture/release-pipeline.md) for packaging.
