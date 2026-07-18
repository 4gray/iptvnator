# Web-Player Shared Controls Setting Design

## Context

The shared `app-player-controls` presentation is already integrated with four
playback paths:

- Embedded MPV frame-copy uses it unconditionally because its video is rendered
  into a DOM canvas.
- HTML5, Video.js, and ArtPlayer can use it behind the default-off
  `WEB_PLAYER_SHARED_CONTROLS` rollout token.

The web-player token currently resolves from the compile-time
`WEB_PLAYER_SHARED_CONTROLS_ENABLED = false` constant. Enabling the integrations
therefore requires a code change, rebuild, and application restart. The
integrations are ready for opt-in testing, so the rollout choice should be a
persisted user setting instead.

The Settings route does not keep an active player mounted. The setting can
therefore be applied when the next playback session is created; changing an
already-running engine or preserving an active playback position is not
required.

## Goals

- Add an experimental Playback checkbox for opting HTML5, Video.js, and
  ArtPlayer into the shared controls.
- Persist the choice in the canonical `SettingsStore`.
- Apply the saved choice to the next web-player session without restarting or
  reloading the application.
- Keep the controls mode immutable for the lifetime of a player session.
- Preserve default-off behavior and compatibility with existing stored
  settings.
- Keep Embedded MPV and external-player behavior unchanged.

## Non-goals

- Make shared web controls the default.
- Change an active player between legacy and shared controls.
- Add separate preferences for HTML5, Video.js, and ArtPlayer.
- Make Embedded MPV native-view use a DOM overlay.
- Allow frame-copy Embedded MPV to fall back to the legacy controls dock.
- Control the native UI of external MPV or VLC processes.

## Embedded MPV Semantics

The new checkbox is intentionally web-player-specific.

Embedded MPV has two rendering paths:

- **Frame-copy:** video is uploaded to a renderer canvas. It always uses
  `app-player-controls`; a second controls toggle would only duplicate an
  already-required part of this engine.
- **Native-view:** video is hosted in a platform-native surface. DOM controls
  cannot reliably stack above that surface, so the compositor-safe legacy dock
  remains required.

The existing `embeddedMpvFrameCopy` setting continues to select the rendering
engine and continues to require an application restart. It is independent from
the new web-player controls preference.

External MPV and VLC processes continue to own their own controls UI.

## Considered Approaches

### 1. Conditional global web-player preference

Selected.

One setting controls HTML5, Video.js, and ArtPlayer together. Its checkbox is
shown only while one of those players is selected. This matches the existing
single rollout token, keeps the Settings UI relevant to the selected player,
and avoids suggesting that the option changes Embedded MPV or external
players.

### 2. Always-visible "shared controls where available" preference

Rejected because it would be a no-op for frame-copy Embedded MPV, unsupported
for native-view, and outside the app for external players. The resulting
conditional semantics would be harder to explain than a web-player-specific
label.

### 3. Separate preference for every playback engine

Rejected because the three web integrations deliberately share one rollout
contract. Per-engine preferences would add settings and test combinations
without a current product requirement.

## Settings Contract

Add an optional boolean to the shared settings interface:

```ts
webPlayerSharedControls?: boolean;
```

The canonical default is `false`. Loading an older settings object without the
field must normalize to `false`, and saving settings must write the complete
resolved value back to storage.

The settings form adds a `webPlayerSharedControls` control with a `false`
default. Form hydration, serialization, reset behavior, backup/export, and the
existing Save workflow continue to use the normal complete `Settings` object.
This is renderer-only state; Electron main-process behavior and preload IPC do
not need a new command.

## Runtime Data Flow

The existing `WEB_PLAYER_SHARED_CONTROLS` injection token remains the
immutable, test-overridable session seam used by the three engine components.
The compile-time constant remains only as the default-off fallback for direct
component use and focused tests.

Normal runtime resolution moves to `WebPlayerViewComponent`:

1. `SettingsStore` loads `webPlayerSharedControls`, defaulting to `false`.
2. The Settings page updates and persists it through the existing Save action.
3. Leaving Settings destroys that route; no player is active during the
   change.
4. The next `WebPlayerViewComponent` resolves a component-scoped boolean
   snapshot from `SettingsStore`.
5. HTML5, Video.js, or ArtPlayer receives that snapshot through
   `WEB_PLAYER_SHARED_CONTROLS` and constructs exactly one controls system.
6. The snapshot does not change until that player host is destroyed and a new
   playback session is created.

This preserves the construction-time requirements of Video.js and ArtPlayer:
vendor controls, hotkeys, gestures, plugins, source bridges, and the shared
adapter are configured atomically. A reactive boolean must not flip only the
template while leaving the engine configured for the other mode.

Embedded MPV does not consume the setting. Its component continues to choose
shared controls for `engine === 'frame-copy'` and the legacy dock for the
native-view engine.

## Settings UI

Add one standard `setting-item` to the Playback section, using the existing
Material checkbox and layout styles.

- Label meaning: **Use unified controls for web players (experimental)**.
- Description meaning: use IPTVnator's common controls in HTML5, Video.js, and
  ArtPlayer.
- Visibility: selected player is `videojs`, `html5`, or `artplayer`.
- Hidden for Embedded MPV, external MPV, and VLC.
- Add a stable test selector to the row and checkbox.
- Add the label and description keys to every locale file so the i18n key sets
  remain aligned.

No new colors, spacing rules, or one-off UI components are required.

## Failure and Compatibility Behavior

- Missing or malformed non-boolean stored values resolve to `false`.
- A storage write failure is reported through the existing
  `SettingsStore.updateSettings()` rejection and must not require
  player-specific recovery.
- Legacy mode remains the safe fallback whenever the setting cannot be
  resolved.
- Direct engine tests can continue overriding
  `WEB_PLAYER_SHARED_CONTROLS` with `true` or `false`.
- The setting does not relax Electron sandboxing and does not alter the
  frame-copy engine opt-in.

## Testing Strategy

### Shared interfaces and settings store

- Default is `false`.
- Older stored settings without the field load as `false`.
- A stored `true` value is restored.
- `updateSettings()` persists the complete resolved value.

### Settings form and UI

- Form creation and serialization include the new field.
- The checkbox hydrates from stored settings and is included in the Save
  payload.
- The row is visible for HTML5, Video.js, and ArtPlayer.
- The row is hidden for Embedded MPV, external MPV, and VLC.
- Translation key parity remains valid across all locales.

### Playback host

- A newly created HTML5, Video.js, or ArtPlayer session receives the saved
  boolean snapshot.
- `false` preserves the existing vendor/native UI.
- `true` mounts the shared controls path.
- Embedded MPV selection ignores the web-player preference.
- One session never renders or initializes both controls systems.

### Validation

- Run focused Settings form/component and `SettingsStore` tests.
- Run the complete `ui-playback` test target because all three web engines
  share the rollout seam.
- Run affected lint targets and the workspace typecheck.
- Run the settings E2E flow for checkbox visibility, persistence, and use after
  returning to playback.
- Run the closest Electron playback smoke/E2E coverage because the same
  Settings surface is used in the desktop app.

## Documentation Impact

Update `docs/architecture/player-controls-contract.md` and the shared-controls
sections of `AGENTS.md` and `CLAUDE.md` to replace the compile-time-only
default-off rollout description with the persisted experimental preference.
The Embedded MPV architecture documentation only needs clarification if its
existing distinction between frame-copy shared controls and the native-view
legacy dock would otherwise become ambiguous.
