import { PAUSE_VOD_WITHOUT_AUDIO } from './multiview-behaviour.constants';
import type {
    MultiviewSessionState,
    MultiviewTile,
} from './multiview-session.model';

/** The large tile in PiP and focus layouts. */
export function mainTile(state: MultiviewSessionState): MultiviewTile {
    return state.tiles[0];
}

export function findTile(
    state: MultiviewSessionState,
    tileId: string
): MultiviewTile | undefined {
    return state.tiles.find((tile) => tile.id === tileId);
}

/** Every tile but the audio tile is muted (R2). */
export function isTileMuted(
    state: MultiviewSessionState,
    tileId: string
): boolean {
    return state.audioTileId !== tileId;
}

/**
 * A VOD or episode tile without audio stays paused at its last position and
 * resumes from it when audio returns (R4). Live tiles never pause on their
 * own.
 */
export function isTileHeldPaused(
    state: MultiviewSessionState,
    tileId: string
): boolean {
    const tile = findTile(state, tileId);
    return (
        PAUSE_VOD_WITHOUT_AUDIO &&
        tile !== undefined &&
        tile.kind !== 'live' &&
        isTileMuted(state, tileId)
    );
}

/** One-based tile number in screen order, as chips and badges show it. */
export function tileNumberOf(
    state: MultiviewSessionState,
    tileId: string
): number | null {
    const index = state.tiles.findIndex((tile) => tile.id === tileId);
    return index === -1 ? null : index + 1;
}

/** The tile showing a content identity, for "In tile N" and list badges. */
export function tileForSessionKey(
    state: MultiviewSessionState,
    playbackSessionKey: string
): MultiviewTile | undefined {
    return state.tiles.find(
        (tile) => tile.playbackSessionKey === playbackSessionKey
    );
}
