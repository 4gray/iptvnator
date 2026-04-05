# UX/UI Analysis: Header vs Rail Navigation

Date: 2026-03-22

## Overview

Evaluation of IPTVnator's navigation architecture — specifically the separation between **global actions in the top header** and **playlist-local actions in the left rail sidebar**, assessed from a user understanding perspective.

## Current Architecture

| Region | Intended Scope | Actual Contents |
|--------|---------------|-----------------|
| **Header** (top) | Global / app-wide | Playlist switcher, search, add playlist, global favorites, downloads, **context menu with local actions** |
| **Rail** (left) | Local / playlist-specific | Dashboard (global), Sources (global), **dynamic provider links** (local), Settings (global) |

Neither region is purely global or purely local. Both mix scopes, which muddies the mental model.

## Strengths

- **Playlist switcher in the header** is excellent placement. Acts like a "workspace context selector" — similar to Slack's workspace switcher or VS Code's project selector.
- **Command palette** nails the global-vs-local distinction with explicit "GLOBAL ACTIONS" and "THIS PLAYLIST" section headers. Clearest articulation of scope in the entire UI.
- **Rail dividers** between static workspace links (Dashboard, Sources) and dynamic provider links provide a subtle visual boundary hinting at the scope change.
- **Search bar adapting its placeholder text** per route is good contextual affordance.
- **Settings at the rail bottom** follows a well-established pattern (Slack, Discord, VS Code).

## Confusion Points

### A. Rail Mixes Global and Local Without Explaining Why

When a user selects an Xtream playlist, the rail shows:
```
Dashboard        <- global
Sources          <- global
-----------------
Movies           <- local (Xtream)
Live TV          <- local (Xtream)
Series           <- local (Xtream)
-----------------
Search           <- local (Xtream)
Recently viewed  <- local (Xtream)
Favorites        <- local (Xtream)
-----------------
Settings         <- global
```

When switching to M3U:
```
Dashboard        <- global
Sources          <- global
-----------------
All channels     <- local (M3U)
Groups           <- local (M3U)
Recently viewed  <- local (M3U)
Favorites        <- local (M3U)
-----------------
Settings         <- global
```

**Issue:** The dynamic links change silently. There's no label like "rucolor.tv" or "clean.m3u" above the provider links to indicate *which* playlist these links belong to. Users who switch playlists via the header dropdown may not immediately notice the rail updated.

**Severity:** Medium.

### B. Header's Three-Dot Menu Breaks the "Global Header" Mental Model

The context actions menu in the header contains:
- **Playlist Info** — local to the current playlist
- **Account Info** — local to the current Xtream portal
- **Clear Recently Viewed** — local bulk action

These are playlist-scoped actions living in what should be the "global" header area.

**Severity:** Low-Medium.

### C. "Favorites" Appears in Both Global and Local Contexts

- **Header:** Global Favorites star icon (cross-playlist)
- **Rail:** Favorites link (playlist-specific)

A user clicking the star in the header vs the heart in the rail gets *different* favorites views with *no* clear labeling of "global" vs "this playlist."

**Severity:** Medium-High. Most likely source of user confusion.

### D. Search Bar Scope Is Invisible

The search bar disables itself on some routes and changes behavior on others. The placeholder text changes, but "Search in this section..." doesn't clarify *which* section.

**Severity:** Low.

## Recommendations

### Quick Wins (Low Effort, High Impact)

1. **Add a playlist name label above the dynamic rail links.** Small, muted text showing "clean.m3u" or "rucolor.tv" above the provider-specific navigation.
2. **Differentiate the Global Favorites icon from Local Favorites.** Use different icons, tooltip distinction, or a small globe badge on the global favorites star.
3. **Add a scope label to the search bar** when active: "Searching in Live TV" or "Searching in clean.m3u" instead of generic "Search in this section..."

### Medium Effort

4. **Consider moving the three-dot context menu into the context panel** rather than the header, keeping the header purely global.
5. **Animate the rail transition** when switching playlists — a subtle slide or fade to signal that links changed.

## Overall Assessment

**Score: 7/10 — Good, with clear improvement opportunities.**

The architecture follows patterns users will recognize from Slack, VS Code, and Spotify. The main risks are the **silent dynamic rail** and the **favorites scope ambiguity**. Fixing those two issues would bring this to a 9/10 for navigational clarity.

### Design Principle

The command palette already has the right model: **explicit scope labels**. Apply this same principle to the rail and header. Anywhere an action's scope isn't obvious from its placement, label it.

## Key Files

- `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.html`
- `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.ts`
- `libs/portal/shared/ui/src/lib/navigation/portal-rail-links.component.ts`
- `libs/portal/shared/util/src/lib/navigation/portal-rail-links.ts`
- `libs/playlist/shared/ui/src/lib/playlist-switcher/playlist-switcher.component.ts`
- `libs/workspace/shell/feature/src/lib/workspace-command-palette/workspace-command-palette.component.ts`
