# IPTVnator Remote Control

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Viewers controlling an already-running IPTVnator desktop player from a phone or
another browser on the local network. The primary task is operating the current
live viewing session without returning to the desktop computer.

## Product Purpose

This is a secondary web companion to the primary Electron/PWA player under
`apps/web`. Product and design decisions should serve that main application;
the remote is not a separate flagship product.

Provide channel navigation, numeric channel selection and current playback
status for the desktop player, with volume commands when the active integration
supports them.

## Positioning

A mobile-friendly companion served directly by the Electron application,
integrated with its M3U, Xtream and Stalker live views and their current status.
It does not have an independent media library or player.

## Operating Context

- This Angular app renders the shared remote-control component from
  `libs/ui/remote-control`. The shell alone is not the complete implementation.
- Users enable remote control in desktop settings, open the local address on
  their phone, and send commands to the running player's active live view.
- Electron serves the web UI and HTTP API; status polling reports the current
  channel, provider, programme and available volume capability.
- This desktop companion is different from `apps/tv-setup`, which configures
  the separate TV application through the web backend.
- For standalone UI development, run `pnpm nx serve remote-control-web` from the
  repository root. Actual command/status validation also needs the desktop
  remote-control backend; the frontend dev server alone cannot control playback.

## Capabilities and Constraints

- Channel up/down and numeric selection follow the active provider's live-view
  integration. Volume support currently belongs to the M3U flow and must be
  shown according to the reported capability.
- Leaving a live view clears now-playing state; avoid displaying stale channels
  or enabled controls for a session that has ended.
- Preserve pending-command feedback, disabled states and visible error recovery.
- The remote depends on the Electron remote-control feature. Browser PWA
  hosting and the separate TV client do not supply that integration.
- Keep translated control labels and document language selection using browser
  language preferences and the project's shared translation assets.
- Broader remote capabilities or unified control of both desktop and TV are
  open product decisions, not current promises.

## Brand Commitments

Use the IPTVnator identity and clear, direct control labels. The maintainer
prohibits decorative vertical side borders or accent strips, including shadow
and pseudo-element imitations.

## Evidence on Hand

- [Canonical remote-control contract](../../docs/architecture/remote-control.md).
- [Shared remote-control implementation](../../libs/ui/remote-control/README.md).
- [Application shell](src/app/app.ts).
- [Main player product context](../web/PRODUCT.md).

The architecture contract and shared component describe current behavior;
older app README examples are not authority for missing or future features.

## Product Principles

1. Keep common live-viewing commands quick to find and operate on a phone.
2. Reflect actual playback state and provider capabilities.
3. Make command progress and failure clear without interrupting viewing.
4. Keep desktop control and TV setup terminology distinct.

## Accessibility & Inclusion

Preserve accessible button names, translated controls and keyboard operability
alongside touch input. Unsupported commands must have understandable states.
No additional accessibility certification target was established during init.
