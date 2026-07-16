import type { PlayerTrack } from './player-controls.model';
import type {
    WebVideoControlsAdapter,
    WebVideoControlsOptions,
} from './web-video-controls.adapter';

/**
 * Minimal glue a follow-up web-player integration can call to wire its `<video>`
 * element and engine track accessors onto a {@link WebVideoControlsAdapter}.
 * No existing player calls this helper in #1148.
 */
export interface WebVideoControlsHostConfig {
    /** The `<video>` element the active engine is rendering into. */
    video: HTMLVideoElement;
    adapter: WebVideoControlsAdapter;
    /** Engine-specific track accessors; omit what the engine does not expose. */
    options?: WebVideoControlsOptions;
}

/** Attaches the adapter to the video element with the supplied accessors. */
export function attachWebVideoControls(
    config: WebVideoControlsHostConfig
): void {
    config.adapter.attach(config.video, config.options ?? {});
}

/**
 * Maps a list of `{ id, label, selected }`-like entries to {@link PlayerTrack}.
 * Engines that already expose plain track lists can reuse this to avoid
 * duplicating the projection.
 */
export function toPlayerTracks(
    entries: ReadonlyArray<{
        id: number;
        label: string;
        selected: boolean;
    }>
): PlayerTrack[] {
    return entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        selected: entry.selected,
    }));
}
