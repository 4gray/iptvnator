import { VideoPlayer } from '@iptvnator/shared/interfaces';
import {
    DEFAULT_PIP_GEOMETRY,
    MULTIVIEW_AVAILABLE_LAYOUTS,
    MULTIVIEW_LAYOUT_CAPACITY,
} from './multiview-behaviour.constants';
import type {
    MultiviewEndReason,
    MultiviewReduction,
    MultiviewRejection,
    MultiviewSessionState,
    MultiviewTile,
    MultiviewTileSource,
    MultiviewTileStatus,
} from './multiview-session.model';
import type { MultiviewCommand } from './multiview-session.commands';
import { findTile, tileForSessionKey } from './multiview-session.selectors';

const reject = (
    state: MultiviewSessionState | null,
    reason: MultiviewRejection
): MultiviewReduction => ({ state, effect: { type: 'rejected', reason } });

const unchanged = (
    state: MultiviewSessionState | null
): MultiviewReduction => ({
    state,
    effect: null,
});

const next = (state: MultiviewSessionState): MultiviewReduction => ({
    state,
    effect: null,
});

function end(
    reason: MultiviewEndReason,
    survivor: MultiviewTile | null
): MultiviewReduction {
    return { state: null, effect: { type: 'ended', reason, survivor } };
}

function toTile(
    source: MultiviewTileSource,
    id: string,
    engine: VideoPlayer,
    status: MultiviewTileStatus
): MultiviewTile {
    return {
        ...source,
        id,
        engine,
        status,
        lastPosition: source.position ?? 0,
    };
}

/** Why a source cannot be shown in place of `exceptTileId`, if it cannot. */
function sourceRejection(
    state: MultiviewSessionState,
    source: MultiviewTileSource,
    exceptTileId: string | null
): MultiviewRejection | null {
    if (source.radio) return 'radio';
    const showing = tileForSessionKey(state, source.playbackSessionKey);
    return showing && showing.id !== exceptTileId ? 'already-on-screen' : null;
}

function replaceTile(
    state: MultiviewSessionState,
    tile: MultiviewTile
): MultiviewSessionState {
    return {
        ...state,
        tiles: state.tiles.map((current) =>
            current.id === tile.id ? tile : current
        ),
    };
}

/**
 * Drops tiles and re-points audio and focus at the main tile when their
 * tile is gone. Ends the session once fewer than two tiles remain (R7).
 */
function withoutTiles(
    state: MultiviewSessionState,
    tileIds: ReadonlySet<string>,
    reason: MultiviewEndReason
): MultiviewReduction {
    const tiles = state.tiles.filter((tile) => !tileIds.has(tile.id));
    if (tiles.length < 2) return end(reason, tiles[0] ?? null);

    const main = tiles[0].id;
    const keeps = (tileId: string): boolean => !tileIds.has(tileId);
    return next({
        ...state,
        tiles,
        audioTileId: keeps(state.audioTileId) ? state.audioTileId : main,
        activeTileId:
            state.layout !== 'pip' && keeps(state.activeTileId)
                ? state.activeTileId
                : main,
    });
}

function start(
    command: Extract<MultiviewCommand, { type: 'start' }>
): MultiviewReduction {
    if (command.primary.radio || command.added.radio) {
        return reject(null, 'radio');
    }
    if (
        command.primary.playbackSessionKey === command.added.playbackSessionKey
    ) {
        return reject(null, 'already-on-screen');
    }
    const primary = toTile(
        command.primary,
        command.primaryTileId,
        command.primaryEngine,
        'playing'
    );
    const added = toTile(
        command.added,
        command.addedTileId,
        VideoPlayer.Html5Player,
        'loading'
    );
    return next({
        tiles: [primary, added],
        layout: 'pip',
        activeTileId: primary.id,
        audioTileId: primary.id,
        anchorId: command.anchorId,
        pip: DEFAULT_PIP_GEOMETRY,
    });
}

/** R1 append below capacity; R6 / D1 replace a tile once the layout is full. */
function add(
    state: MultiviewSessionState,
    source: MultiviewTileSource,
    tileId: string
): MultiviewReduction {
    const rejection = sourceRejection(state, source, null);
    if (rejection) return reject(state, rejection);

    if (state.tiles.length < MULTIVIEW_LAYOUT_CAPACITY[state.layout]) {
        const tile = toTile(source, tileId, VideoPlayer.Html5Player, 'loading');
        return next({ ...state, tiles: [...state.tiles, tile] });
    }

    // PiP replaces the small tile; other layouts replace the active one.
    const target =
        state.layout === 'pip'
            ? state.tiles[1]
            : (findTile(state, state.activeTileId) ?? state.tiles[1]);
    const replaced = replaceTile(state, {
        ...toTile(source, target.id, target.engine, 'loading'),
    });
    // A tile added by the user always starts muted (R2).
    const audioTileId =
        state.audioTileId === target.id
            ? (replaced.tiles.find((tile) => tile.id !== target.id)?.id ??
              target.id)
            : state.audioTileId;
    return {
        state: { ...replaced, audioTileId },
        effect: {
            type: 'replaced',
            previous: target,
            tileNumber: state.tiles.indexOf(target) + 1,
        },
    };
}

function swap(state: MultiviewSessionState): MultiviewReduction {
    const [main] = state.tiles;
    const other =
        state.layout === 'pip'
            ? state.tiles[1]
            : findTile(state, state.activeTileId);
    if (!other || other.id === main.id) return reject(state, 'not-swappable');

    const tiles = state.tiles.map((tile) =>
        tile.id === main.id ? other : tile.id === other.id ? main : tile
    );
    // In PiP the large tile is the active one and gets the audio (R3).
    return next(
        state.layout === 'pip'
            ? { ...state, tiles, activeTileId: other.id, audioTileId: other.id }
            : { ...state, tiles }
    );
}

function reduceTileCommand(
    state: MultiviewSessionState,
    command: Exclude<MultiviewCommand, { type: 'start' }>
): MultiviewReduction {
    switch (command.type) {
        case 'add':
            return add(state, command.source, command.tileId);
        case 'replace': {
            const tile = findTile(state, command.tileId);
            if (!tile) return reject(state, 'unknown-tile');
            if (tile.playbackSessionKey === command.source.playbackSessionKey) {
                return unchanged(state);
            }
            const rejection = sourceRejection(state, command.source, tile.id);
            if (rejection) return reject(state, rejection);
            return next(
                replaceTile(
                    state,
                    toTile(command.source, tile.id, tile.engine, 'loading')
                )
            );
        }
        case 'undo-replace': {
            const { previous } = command;
            if (!findTile(state, previous.id)) {
                return reject(state, 'unknown-tile');
            }
            const rejection = sourceRejection(state, previous, previous.id);
            if (rejection) return reject(state, rejection);
            // Resume where the replaced stream was, not where it started.
            return next(
                replaceTile(state, {
                    ...previous,
                    status: 'loading',
                    position: previous.lastPosition,
                })
            );
        }
        case 'remove':
            return findTile(state, command.tileId)
                ? withoutTiles(state, new Set([command.tileId]), 'last-tile')
                : reject(state, 'unknown-tile');
        case 'swap':
            return swap(state);
        case 'set-audio':
            return findTile(state, command.tileId)
                ? next({ ...state, audioTileId: command.tileId })
                : reject(state, 'unknown-tile');
        case 'set-active':
            if (!findTile(state, command.tileId)) {
                return reject(state, 'unknown-tile');
            }
            // In PiP the main tile is always the active one.
            return state.layout === 'pip'
                ? unchanged(state)
                : next({ ...state, activeTileId: command.tileId });
        case 'set-layout':
            return MULTIVIEW_AVAILABLE_LAYOUTS.includes(command.layout) &&
                state.tiles.length <= MULTIVIEW_LAYOUT_CAPACITY[command.layout]
                ? next({ ...state, layout: command.layout })
                : reject(state, 'layout-unavailable');
        case 'set-pip-geometry':
            return next({ ...state, pip: command.geometry });
        case 'tile-status':
        case 'tile-position': {
            const tile = findTile(state, command.tileId);
            if (!tile) return reject(state, 'unknown-tile');
            return next(
                replaceTile(
                    state,
                    command.type === 'tile-status'
                        ? { ...tile, status: command.status }
                        : { ...tile, lastPosition: command.seconds }
                )
            );
        }
        case 'withhold': {
            const withheld = new Set(
                command.tileIds.filter((tileId) => findTile(state, tileId))
            );
            return withheld.size === 0
                ? unchanged(state)
                : withoutTiles(state, withheld, 'withheld');
        }
        case 'exit':
            return end('exit', findTile(state, state.audioTileId) ?? null);
        case 'end':
            return end(
                command.reason,
                findTile(state, state.audioTileId) ?? null
            );
    }
}

/** Pure session rules R1–R8 of the multiview spec. */
export function reduceMultiviewSession(
    state: MultiviewSessionState | null,
    command: MultiviewCommand
): MultiviewReduction {
    if (command.type === 'start') {
        return state ? reject(state, 'session-exists') : start(command);
    }
    return state
        ? reduceTileCommand(state, command)
        : reject(null, 'no-session');
}
