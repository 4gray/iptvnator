# Playback Recovery Recommendations

## Context

Issue #1159 started as a request for more accurate playback errors and useful
guidance when a stream fails in one player but may work in another. The browser
players now emit structured, fail-closed diagnostics for native media,
hls.js, Video.js/VHS, Shaka Player, and mpegts.js. Those boundaries preserve
public engine evidence without retaining provider messages, credentials, or
arbitrary error payloads.

The remaining recovery policy is still embedded in the UI. Every
`PlaybackDiagnostic` carries an `externalFallbackRecommended` boolean, and
`WebPlayerViewComponent` converts that flag into a fixed MPV/VLC section while
always showing Retry and every available alternative-source row. This cannot
explain when a distinct built-in engine is the better next step, rank recovery
actions by evidence, or avoid recommending a target already tried during the
same playback session.

This design introduces one player-neutral recommendation layer. It ranks a
small set of explicit user actions from structured diagnostic evidence and
runtime capabilities. It does not perform automatic failover.

## Goals

- Convert structured playback diagnostics into deterministic, evidence-based
  recovery recommendations.
- Rank one primary recommendation and at most two secondary recommendations.
- Recommend a distinct built-in web engine only when it can plausibly change
  the failing playback path.
- Keep MPV/VLC recommendations for source formats and browser restrictions
  where an external player can receive the required playback data.
- Keep network, HTTP, and unknown failures fail-closed: prefer Retry or an
  alternative source instead of guessing that another decoder will help.
- Let a user temporarily try a recommended built-in player for the current
  content without changing the saved player setting.
- Remember attempted targets only for the current in-memory content session so
  repeated failures produce a more useful next recommendation.
- Establish a pure playback-domain boundary that future structured native
  diagnostics and target capabilities can extend.

## Non-goals

- Automatically switching players or sources.
- Changing the persisted player setting.
- Persistent diagnostic history, cross-session learning, telemetry, or
  correlation.
- A retry scheduler, health monitor, or full failover orchestrator.
- Moving diagnostics or recommendation policy into `PlayerController`.
- Replacing the existing multi-source auto-failover behavior.
- Recommending Embedded MPV as an inline target before it emits an equivalent
  structured diagnostic lifecycle.
- Detecting whether an external MPV/VLC process ultimately played the stream.
- AirPlay, Cast, Document Picture-in-Picture, or remote-device capabilities.
- Redesigning the diagnostic overlay or the player controls.

## Approaches Considered

### Pure ranked policy layer (selected)

Create a pure playback-domain function that receives structured evidence,
source context, target capabilities, and session-local attempts, then returns
an ordered list of typed recommendations. `WebPlayerViewComponent` remains the
owner of UI state and user-triggered switching.

This keeps classification, policy, and rendering independently testable. It
also makes future evidence sources additive without coupling playback engines
to Angular or turning the controls contract into an error orchestrator.

### Extend diagnostic booleans

Add fields such as `retryRecommended`, `builtInFallbackRecommended`, and
`alternativeSourceRecommended` to `PlaybackDiagnostic` and let the component
choose the buttons. This looks small but duplicates ranking logic, makes
diagnostic producers own runtime/UI policy, and cannot cleanly account for
attempted targets. It is rejected.

### Full failover orchestrator

Introduce a state machine that launches players, observes outcomes, mutates
preferences, and manages retries. This could eventually support automatic
recovery, but it is materially larger and would blur the existing ownership of
source selection, settings, and engine lifecycle. It is rejected for v1.

## Architecture And Ownership

### New playback utility project

Create `libs/playback/util` as the pure playback-domain boundary:

- Nx project name: `playback-util`;
- path alias: `@iptvnator/playback/util`;
- tags: `scope:shared`, `domain:playback`, `type:util`;
- public exports through `libs/playback/util/src/index.ts` only.

The project contains contracts, evidence normalization, diagnostic
classification, source/engine-family mapping, target-capability contracts, and
the recommendation policy. It has no Angular, DOM, storage, settings-store, or
Electron IPC dependency. As a `type:util` project it depends only on other
utility projects, including the existing shared interfaces required for
external-player names and resolved playback metadata.

Move the pure diagnostic model and classifiers from
`libs/ui/playback/src/lib/playback-diagnostics/` into this project. Move only
the pure Shaka evidence/classifier helpers from the Shaka area; the Shaka
engine and video session remain in `ui-playback`. Engine components import the
new alias instead of reaching back into UI-owned diagnostic paths.

For one compatibility window, `@iptvnator/ui/playback` re-exports the public
diagnostic contracts from `@iptvnator/playback/util`. Existing consumers can
therefore migrate without deep imports or a flag day. New code imports the
new alias directly, and the compatibility export can be removed in a later
cleanup PR after all consumers have migrated.

### UI owner

`WebPlayerViewComponent` owns:

- the current content-session key;
- the temporary built-in player override;
- the set of targets attempted in the current session;
- the most recent VOD position used for a best-effort engine handoff;
- the binding generation that rejects stale engine events;
- mapping ranked recommendations to translated, accessible UI;
- existing external-player and alternative-source outputs.

UI-specific translation keys, formatting helpers, Material components, styles,
and diagnostic action cards remain in `libs/ui/playback`.

### Controls contract

`PlayerController` remains the engine-neutral state, command, and capability
contract used by shared controls. Diagnostics and recovery policy stay as a
sibling layer. No recommendation state or commands are added to
`PlayerController`.

## Recommendation Contracts

The utility layer exposes a pure
`recommendPlaybackRecovery(context)` function and a discriminated
recommendation union:

```ts
type PlaybackRecommendation =
    | {
          readonly action: 'retry';
          readonly reason: PlaybackRecommendationReason;
          readonly priority: 'primary' | 'secondary';
      }
    | {
          readonly action: 'alternative-source';
          readonly reason: PlaybackRecommendationReason;
          readonly priority: 'primary' | 'secondary';
      }
    | {
          readonly action: 'player';
          readonly target: PlaybackRecommendationTarget;
          readonly reason: PlaybackRecommendationReason;
          readonly priority: 'primary' | 'secondary';
      };
```

`PlaybackRecommendationTarget` is the union of the three built-in diagnostic
players (`videojs`, `html5`, `artplayer`) and the managed external targets
(`mpv`, `vlc`). Embedded MPV is deliberately absent in v1.

Reasons are stable app-owned values, not user-visible prose:

- `retry-transient-failure`;
- `retry-unknown-failure`;
- `alternative-source-available`;
- `different-engine-family`;
- `external-codec-or-container-support`;
- `external-browser-access`;
- `compatible-drm-path`.

Angular maps those values to translations. The model has no numeric confidence
score: the evidence matrix and list order are the contract.

The policy input contains:

- the sanitized `PlaybackDiagnostic`;
- the active target;
- the session-local attempted-target set;
- available target capabilities and their engine family for this source;
- source kind, live/VOD state, and DRM/external-transfer context;
- the count of alternative sources.

The policy output is deterministic, contains at most three entries, and has at
most one primary entry. If the list is non-empty, its first entry is primary
and every later entry is secondary. Current, unavailable, incompatible, and
already attempted targets are excluded before ranking.

`PlaybackDiagnostic.externalFallbackRecommended` is removed. Diagnostic
producers report evidence and classification only; the recommendation policy
decides which actions are safe and useful in the current runtime.

Copy URL and Technical details are utilities rather than recommendations and
are therefore not part of this union.

## Capability And Source Context

The caller supplies explicit capability facts instead of asking the policy to
inspect settings, the DOM, or Electron globals. Each player target records
whether it is available for the current runtime/source and its effective
engine family.

The source context records whether the playback payload can be transferred to
an external player. ClearKey/KODIPROP playback is always non-transferable in
v1: MPV and VLC are excluded because the current external-player request does
not carry an equivalent DRM contract. Header-bearing portal playback is
transferable only when its existing host-specific external launch path forwards
the required resolved playback fields; otherwise the host capability marks it
non-transferable. The policy never infers transferability from an error message
or URL substring.

## Engine-Family Matrix

Recommendations change engines, not merely skins:

| Source path                      | Built-in engine families            | v1 built-in alternative |
| -------------------------------- | ----------------------------------- | ----------------------- |
| HLS in Video.js                  | Video.js/VHS                        | HTML5 using hls.js      |
| HLS in HTML5 or ArtPlayer        | hls.js                              | Video.js/VHS            |
| MPEG-TS in any web player        | mpegts.js                           | None                    |
| DASH in HTML5 or ArtPlayer       | Shaka Player                        | None                    |
| DASH in Video.js                 | not a supported recommendation path | None                    |
| Native MP4/MKV in any web player | browser media element               | None                    |

Only one target represents a distinct engine family in the ranked list. For a
Video.js HLS failure, HTML5 is the canonical hls.js target; ArtPlayer is not a
second independent engine recommendation. If that target is unavailable or
already attempted, the policy proceeds to an external target rather than
presenting a duplicate engine-family guess.

MPEG-TS does not recommend another built-in player because all three use the
same mpegts.js engine. DASH does not recommend Video.js in v1 because it is not
an equivalent supported Shaka path. Native media does not recommend another
web player because all three ultimately depend on the same browser decoder.

## Policy Matrix

The policy builds the following exact candidate order, then filters unavailable,
current, incompatible, and attempted targets and truncates the result to three
entries. “Alternative source” is omitted when its count is zero.

| Evidence                                  | Ordered candidates                                        | Forbidden guess                  |
| ----------------------------------------- | --------------------------------------------------------- | -------------------------------- |
| HTTP, timeout, or generic network failure | Retry → Alternative source                                | Any player change                |
| Unknown playback error                    | Retry → Alternative source                                | Any player change                |
| Browser access/CORS/CSP-class evidence    | MPV → VLC → Alternative source                            | Another browser player           |
| Unsupported codec or container            | MPV → VLC → Alternative source                            | Another browser player           |
| Media/decode/engine processing failure    | Distinct built-in family → MPV → VLC → Alternative source | Same engine family               |
| DRM/encryption failure                    | Compatible built-in path → Alternative source → MPV → VLC | Non-transferable external target |

Network and unknown cases never claim that another decoder is likely to fix
the failure. For DRM, every candidate still passes explicit target and payload
capability checks; ClearKey/KODIPROP therefore never reaches MPV or VLC.

For external actions, MPV precedes VLC to preserve the existing primary
fallback. If MPV is unavailable or attempted, VLC may become primary. When no
ranked recommendation survives, the overlay still exposes Copy URL and
Technical details instead of fabricating a guess.

## Playback Session Lifecycle

### Stable content identity

Every `WebPlayerViewComponent` host supplies a required
`playbackSessionKey`. The key identifies canonical logical content, not the
current URL or selected provider copy:

- an M3U live channel key uses playlist/source identity plus channel identity;
- Xtream and Stalker live keys use provider/account plus content identity;
- movie keys use the owning route/catalog's original source plus movie
  identity;
- episode keys use the owning series route's original source and series plus
  season and episode identity.

An alternative source's `playback.contentInfo` is provider-scoped playback and
resume metadata, not recovery-session identity. Source-owning route and series
hosts derive the key before passing it through the inline player, so replacing
that playback payload cannot replace the recovery session.

Retry and alternative sources for the same channel, movie, or episode keep the
same key. Selecting a different channel, movie, or episode changes it. A key
change synchronously clears the attempted-target set, temporary override,
handoff position, and visible diagnostic, then advances the binding generation
so every callback from the previous content becomes stale.

The state is component-local, so a same-content source change must retain the
`WebPlayerViewComponent` instance and update its inputs. Destroying that
component ends the recovery session even if a later instance receives the same
key. Host tests enforce retained identity for supported multi-source flows.

### Failure and reranking

When the active web engine emits a terminal diagnostic, the component:

1. verifies that the event belongs to the current binding generation and
   active target;
2. records the current target as attempted;
3. stores the diagnostic;
4. emits the existing `playbackFailed` output for source-owner behavior;
5. runs the pure recommendation policy with current capabilities and attempts.

An event from a destroyed or replaced engine is ignored and cannot overwrite
the new session's UI.

### Trying a built-in target

When the user selects a built-in recommendation, the component records that
target as attempted, captures the latest VOD position, clears the diagnostic,
and applies a local override that outranks the host override and saved setting
for this content session. The player host is recreated for the chosen target.
No storage or settings-store mutation occurs.

For VOD and episodes, the new engine receives the latest finite playback
position as a best-effort start time. Live playback restarts at the live edge.
If the target fails, the new diagnostic is reranked with both attempted
targets excluded. If the target proves unavailable before attachment, the
component keeps it attempted and immediately reranks without throwing.

Retry keeps the same content session and attempts, clears the current
diagnostic, and reloads the active target. An alternative-source request also
keeps the same content session and attempts; the source-owning host changes the
resolved playback URL without resetting the recommendation history.

### External targets

MPV/VLC actions continue to emit the existing `PlaybackFallbackRequest` with
the full `ResolvedPortalPlayback` and diagnostic. The selected external target
is recorded as attempted before emission so returning to the overlay can
promote the next useful action. v1 does not infer launch or playback success
and does not persist the result.

## User Interface

Keep the existing diagnostic overlay and its badge, headline, description,
HTTP/container/codec metadata, codec hint, and `role="status"`. This feature
changes the action hierarchy, not the overall visual language.

The overlay renders:

1. one prominent primary recommendation card;
2. at most two compact secondary recommendation cards;
3. the always-available Copy URL and Technical details utilities.

An alternative-source recommendation renders the existing
`VodSourceRow`-based block and occupies one recommendation slot regardless of
the number of visible source rows. Its existing bounded row count and “more
sources” affordance remain.

Retry moves out of the unconditional utility row and appears only when the
policy ranks it. Preserve `playback-retry`, `playback-fallback-mpv`, and
`playback-fallback-vlc`. Built-in actions use
`playback-recommendation-videojs`, `playback-recommendation-html5`, and
`playback-recommendation-artplayer`. Their copy explicitly says that the
change is temporary and does not alter the saved setting.

All actions are native buttons with visible keyboard focus. No autofocus or
focus trap is added to the status overlay. A pending switch disables repeated
activation until the current operation settles. At narrow widths cards stack
vertically, content uses `min-width: 0`, and long translated copy wraps without
forcing horizontal overflow. Existing light/dark application tokens remain
the styling source.

## Error Handling And Safety

- The recommendation function is total and does not throw for missing,
  unknown, or future diagnostic evidence.
- Incomplete or contradictory context fails closed to Retry and an available
  alternative source; it never upgrades uncertainty into a player claim.
- Unknown engine families cannot produce built-in recommendations.
- Unavailable or non-transferable targets are filtered before rendering.
- A binding generation plus exact target identity rejects stale diagnostic,
  async header, and delayed player events after a switch.
- Switching is single-flight from the UI perspective; double clicks cannot
  mount two targets or corrupt the attempt set.
- Session state remains memory-only and contains stable target IDs and a
  numeric playback position, never raw error payloads or credentials.
- Existing structured-evidence redaction guarantees remain unchanged after
  moving the pure files into `playback-util`.

## Testing

Use test-driven development.

### Pure policy and boundary tests

- Add exhaustive table-driven tests in `playback-util` for every policy row,
  source engine family, priority transition, availability combination, attempt
  exclusion, DRM transfer constraint, and three-result limit.
- Prove network and unknown diagnostics never recommend a player.
- Prove MPEG-TS, native media, and Shaka/DASH never offer a same-engine browser
  alternative.
- Prove HLS offers only one distinct built-in engine family.
- Prove ClearKey/KODIPROP excludes MPV/VLC.
- Preserve and migrate all diagnostic/evidence contract tests, including
  package-version locks and redaction assertions.
- Add a module-boundary assertion that the new utility project has no Angular,
  DOM, Electron, storage, or UI dependency.

### Component and host tests

Extend `WebPlayerViewComponent` tests to cover:

- deterministic primary/secondary rendering and stable test IDs;
- a temporary built-in switch without settings mutation;
- attempted-target exclusion and reranking after another failure;
- Retry and alternative-source preservation of session state;
- complete reset on `playbackSessionKey` change;
- VOD position handoff and live-edge behavior;
- stale generation/target event rejection;
- single-flight action handling and unavailable-target reranking;
- DRM and runtime-capability filtering;
- keyboard focus, disabled state, and narrow-layout structure.

Update the closest M3U, Xtream, Stalker, unified live, and portal inline-player
specs to prove that each host supplies a stable content key and preserves it
while switching sources for the same content.

### E2E coverage

- Add a deterministic web Playwright case backed by repository-owned media
  fixtures: trigger an engine-specific HLS failure, assert the distinct
  built-in recommendation, activate it, verify the new player host mounts, and
  verify the persisted player setting remains unchanged.
- Extend the existing web and Electron DASH/ClearKey E2E cases to prove that
  non-transferable DRM never exposes MPV/VLC recommendations.
- Preserve or add an Electron case where an eligible browser/container failure
  still exposes the existing managed MPV/VLC actions and emits the expected
  external fallback request.

Do not add a production-only diagnostic injection hook for E2E. If a browser
cannot deterministically expose the chosen HLS engine event from a bounded
fixture, the implementation plan must select another public, deterministic
engine event and retain component-level coverage of the exact policy branch.

### Validation ladder

Run at minimum:

- `pnpm nx test playback-util`;
- `pnpm nx lint playback-util`;
- `pnpm nx test ui-playback`;
- `pnpm nx lint ui-playback`;
- focused tests for every host whose session-key binding changes;
- the targeted web and Electron E2E atomized targets discovered from Nx;
- affected application typecheck/build targets;
- `pnpm run i18n:validate`;
- `pnpm run release:notes:validate`;
- Nx module-boundary and project-discovery checks.

The implementation plan must use the exact target names reported by the fresh
workspace rather than inventing commands.

## Documentation And Release Note

Update:

- `docs/architecture/embedded-inline-playback.md` with the canonical
  diagnostic-to-recommendation flow and engine-family matrix;
- `docs/architecture/nx-workspace-boundaries.md` with the new
  `playback-util` project and alias;
- `AGENTS.md` and `CLAUDE.md` with the new shared playback recommendation
  ownership and session behavior.

Update `docs/architecture/player-controls-contract.md` with a short boundary
clarification that recovery recommendations remain outside the controls
contract; the controls API itself does not change.

Add a `fix(playback)` note under `.changes/` because users gain new recovery
actions and temporary built-in player switching. The note describes the user
outcome, not the internal policy extraction.

## Future Extensions

The boundary is intentionally extensible where additional evidence changes a
decision:

- structured Embedded MPV/native-view diagnostics and capabilities;
- explicit external-launch failure results;
- richer per-target codec, container, DRM, and header-transfer capabilities;
- session-local outcome adaptation when a target starts successfully;
- source health facts supplied by an existing source owner.

Persistent history, telemetry-driven ranking, and automatic mutation of player
settings remain low-value or high-risk until a concrete user problem justifies
them.
