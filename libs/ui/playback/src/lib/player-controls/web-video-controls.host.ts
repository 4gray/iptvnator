import type { PlayerTrack } from './player-controls.model';
import type {
    WebVideoControlsAdapter,
    WebVideoControlsOptions,
} from './web-video-controls.adapter';

/**
 * Minimal glue each web player calls to wire its `<video>` element + engine
 * track accessors onto a {@link WebVideoControlsAdapter}. Keeps the already-large
 * player components from growing: they only describe their engine, not the
 * attach/build-opts boilerplate.
 */
export interface WebVideoControlsHostConfig {
    /** The `<video>` element the active engine is rendering into. */
    video: HTMLVideoElement;
    adapter: WebVideoControlsAdapter;
    /** Engine-specific track accessors; omit what the engine does not expose. */
    options?: WebVideoControlsOptions;
}

/** Attaches the adapter to the video element with the supplied accessors. */
export function attachWebVideoControls(config: WebVideoControlsHostConfig): void {
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
