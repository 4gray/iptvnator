# External Playback Launch Feedback Design

## Goal

Make MPV and VLC recovery actions reversible and understandable. A target stays
available after an attempt, the diagnostic panel reports launch progress and
outcome, and the workspace dock remains the authoritative global view of the
external-player session.

## Current Problem

`WebPlayerViewComponent` records MPV or VLC as attempted before emitting the
fallback request. The recommendation policy then removes attempted targets, so
each button disappears even though IPTVnator only knows that the action was
requested. It does not yet know whether the external player started or played
the stream.

The external-player session already reports `launching`, `opened`, `playing`,
`error`, and `closed`, but the dock hides `error`, renders `opened` and
`playing` as the same “Opened” status, and exposes no dismiss action for an
external-player error.

## Considered Approaches

### 1. Keep actions and show only a local timed spinner

This is the smallest change, but the UI would guess when launching finished
and could disagree with the Electron session. It is rejected because the app
already has structured launch state.

### 2. Add callbacks to every `PlaybackFallbackRequest` host

Every M3U, Xtream, Stalker, and shared host could return its launch promise to
the web-player component. This is explicit but spreads recovery bookkeeping
through many source-owning components and still misses later `playing` and
`error` session updates.

### 3. Correlate the recovery attempt with the shared external session

This is the selected approach. The web-player component keeps source launch
ownership in its existing host output, but observes the app-wide
`PORTAL_EXTERNAL_PLAYBACK.activeSession` signal. A local coordinator accepts
only the next session for the requested target and then only updates for that
exact session ID. No URL, headers, DRM data, credentials, or raw diagnostic
payload enters this ownership state.

## State Model

Each external target has component-local state:

- `idle`: no launch is in flight; a previous successful/closed attempt may
  still be represented by an attempt count;
- `launching`: the request is being handed off or Electron is spawning the
  player;
- `started`: Electron confirmed the process or existing player accepted the
  stream;
- `playing`: MPV/VLC position polling confirmed playback;
- `error`: the launch/session failed.

The state also contains an attempt count and, only after correlation, the exact
external session ID. It never contains the stream URL, headers, credentials,
engine messages, or error details. A fieldless `Symbol` intent plus the current
content-session generation rejects stale completions and timers.

Changing `playbackSessionKey` resets both targets. Destroying the component
invalidates the intent and clears its bounded launch timer. A later session
update is accepted only if it belongs to the correlated session ID.

## Recommendation Behaviour

External attempts no longer remove MPV or VLC from the ranked action list.
Inline engine attempts retain the current family-exclusion rules.

Within an otherwise unchanged policy result:

- an untried external target ranks ahead of an attempted sibling;
- fewer attempts rank ahead of more attempts;
- policy order remains the tie-breaker;
- the first surviving action remains primary and the total remains capped at
  three.

Labels describe the action, while adjacent status copy describes the outcome:

| State                   | Action label       | Status                |
| ----------------------- | ------------------ | --------------------- |
| `idle`, never attempted | Open in MPV/VLC    | none                  |
| `launching`             | Opening MPV/VLC…   | Opening player…       |
| `started`               | Open MPV/VLC again | Player started        |
| `playing`               | Open MPV/VLC again | Playing               |
| `error`                 | Try MPV/VLC again  | External player error |

Buttons remain mounted with stable recommendation keys, preserving layout and
focus. During a launch handshake, recovery actions expose `aria-busy` and
`aria-disabled`; activation handlers enforce the same single-flight guard, so
keyboard or programmatic activation cannot duplicate the request. A small
spinner replaces the external-action icon. State changes are announced through
concise `aria-live="polite"` status text.

Before a recovery action opens another external player, it closes the currently
tracked live external session through `PORTAL_EXTERNAL_PLAYBACK`. If the
session is still live and cannot be closed, the new attempt fails locally
instead of starting a second process. Only after that close settles does the
existing host output emit the new fallback request. MPV and VLC are available
again after the handshake.

If no matching session arrives within a bounded timeout, the target transitions
to `error`. The timeout is feedback for a missing handoff, not evidence about
stream playback.

## Dock Behaviour

`ExternalPlaybackService.visibleSession` keeps error sessions visible until
the user dismisses them or another launch begins. The dock maps session states
without inference:

- `launching` → “Opening player…” with a spinner;
- `opened` → “Player started”;
- `playing` → “Playing”;
- `error` → the existing session error or a localized generic external-player
  failure;
- `closed` remains hidden by the global service.

The dock uses an `aria-live="polite"` status region and `aria-busy` while
launching. A live closable session shows “Close player”; an error shows
“Dismiss”. Dismiss only hides the terminal notification and never stores a
retry payload, so headers and credentials are not retained for a dock retry.

## Error And Privacy Boundaries

The diagnostic action shows only localized, app-owned launch-state copy. It
does not render rejected promise messages or external-player stderr. The dock
may continue to show the existing session error supplied by the Electron
boundary; it does not add new logging or persistence.

Recovery recommendations remain user-selected. There is no automatic retry,
automatic player switch, persistent history, telemetry, or learning.

## Testing

Unit and component coverage will prove:

- external attempts stay visible and rerank without weakening inline
  engine-family exclusion;
- one handshake at a time, duplicate activation rejection, stable DOM keys,
  spinner/labels, and `aria-busy`/`aria-disabled` feedback;
- exact session-ID correlation, stale update/timeout rejection, session-key
  reset, close-before-switch, and unclosable-session failure;
- dock `launching`, `opened`, `playing`, `error`, close, and dismiss states;
- `ExternalPlaybackService` keeps errors visible until dismissal.

Electron E2E will extend the deterministic recovery fixture to assert that the
buttons remain after an MPV attempt, VLC is promoted, the lower dock shows
launch feedback, and an error remains dismissible. Existing playback fixtures
and player stubs must be used; no real playlist, account, or external process is
required.

## Documentation And Release Note

Update the canonical playback recovery architecture in
`docs/architecture/embedded-inline-playback.md`, the shared-player summary in
`AGENTS.md` and `CLAUDE.md`, and add a user-facing `fix(playback)` note under
`.changes/`.

## Out Of Scope

- proving playback for sessions that do not expose position polling;
- retry from the dock;
- retaining playback headers or credentials after the original request;
- automatic failover between MPV and VLC;
- redesigning the diagnostic overlay or dock.
