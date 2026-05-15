---
name: iptvnator-ui-design
description: Repository-specific UI design guidance for IPTVnator channel rows, EPG views, settings surfaces, shared selection styles, and light/dark theme consistency.
---

# IPTVnator UI Design

Use this skill when changing user-visible Angular UI in the IPTVnator app, especially channel lists, EPG panels, settings, playlist surfaces, and portal shared components.

## Principles

- Prefer dense, scannable application UI over marketing-style layouts.
- Preserve existing Material 3 token usage and light/dark theme behavior.
- Keep repeated selection states aligned with existing `--app-selection-*` tokens.
- Use existing shared UI components before adding local one-off markup.
- Avoid large visual rewrites in behavior-focused changes.

## Checklist

1. Inspect the nearest existing component and shared UI library before editing.
2. Check both light and dark theme styles when touching colors, borders, hover states, or selection states.
3. Keep text and controls within fixed-width rows from resizing the layout.
4. Prefer existing components from `@iptvnator/ui/components`, `@iptvnator/portal/shared/ui`, and `@iptvnator/ui/epg`.
5. Add or update focused component tests for changed interaction states.

## Validation

- Run the affected Nx project test target.
- For visible workflow changes, run the closest Playwright E2E target or manually verify through Electron CDP as documented in `AGENTS.md`.
