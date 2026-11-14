import { VideoPlayer } from '@iptvnator/shared/interfaces';
import type { MultiviewCommand } from './multiview-session.commands';
import { reduceMultiviewSession } from './multiview-session.reducer';
import type {
    MultiviewSessionState,
    MultiviewTileSource,
} from './multiview-session.model';
import {
    isTileHeldPaused,
    isTileMuted,
    mainTile,
    tileNumberOf,
} from './multiview-session.selectors';

function source(
    key: string,
    kind: MultiviewTileSource['kind'] = 'live',
    extra: Partial<MultiviewTileSource> = {}
): MultiviewTileSource {
    return {
        playback: {
            streamUrl: `https://stream.example/${key}.m3u8`,
            title: `Title ${key}`,
            isLive: kind === 'live',
        },
        playbackSessionKey: `session:${key}`,
        kind,
        playlistId: 'playlist-1',
        title: `Title ${key}`,
        ...extra,
    };
}

const MOVIE = source('movie', 'vod', { position: 3913 });
const MATCH = source('match');
const NEWS = source('news');

function run(
    state: MultiviewSessionState | null,
    ...commands: MultiviewCommand[]
): ReturnType<typeof reduceMultiviewSession> {
    let reduction = { state, effect: null } as ReturnType<
        typeof reduceMultiviewSession
    >;
    for (const command of commands) {
        reduction = reduceMultiviewSession(reduction.state, command);
    }
    return reduction;
}

function started(
    primary: MultiviewTileSource = MOVIE,
    added: MultiviewTileSource = MATCH
): MultiviewSessionState {
    const { state } = run(null, {
        type: 'start',
        anchorId: 'xtream-live',
        primary,
        primaryTileId: 'tile-1',
        primaryEngine: VideoPlayer.VideoJs,
        added,
        addedTileId: 'tile-2',
    });
    if (!state) throw new Error('Expected a session');
    return state;
}

function session(state: MultiviewSessionState | null): MultiviewSessionState {
    if (!state) throw new Error('Expected a session');
    return state;
}

const keys = (state: MultiviewSessionState | null): string[] =>
    state?.tiles.map((tile) => tile.playbackSessionKey) ?? [];

describe('reduceMultiviewSession', () => {
    describe('R1 start', () => {
        it('keeps the playing source as the main tile with its engine and position', () => {
            const state = started();
            const [main, pip] = state.tiles;

            expect(main).toMatchObject({
                id: 'tile-1',
                engine: VideoPlayer.VideoJs,
                lastPosition: 3913,
                status: 'playing',
            });
            expect(pip).toMatchObject({
                id: 'tile-2',
                engine: VideoPlayer.Html5Player,
                status: 'loading',
            });
            expect(state.layout).toBe('pip');
            expect(state.pip).toEqual({ corner: 'bottom-right', width: null });
            expect(state.anchorId).toBe('xtream-live');
        });

        it('starts the added tile muted and leaves audio and focus on the main tile', () => {
            const state = started();

            expect(state.audioTileId).toBe('tile-1');
            expect(state.activeTileId).toBe('tile-1');
            expect(isTileMuted(state, 'tile-2')).toBe(true);
            expect(isTileMuted(state, 'tile-1')).toBe(false);
        });

        it('rejects a second start while a session exists', () => {
            expect(
                reduceMultiviewSession(started(), {
                    type: 'start',
                    anchorId: 'other',
                    primary: NEWS,
                    primaryTileId: 'tile-9',
                    primaryEngine: VideoPlayer.Html5Player,
                    added: MATCH,
                    addedTileId: 'tile-10',
                }).effect
            ).toEqual({ type: 'rejected', reason: 'session-exists' });
        });

        it.each([
            [
                'the playing source is radio',
                source('r', 'live', { radio: true }),
                MATCH,
            ],
            [
                'the added source is radio',
                MOVIE,
                source('r', 'live', { radio: true }),
            ],
        ])('rejects a start when %s', (_label, primary, added) => {
            const reduction = run(null, {
                type: 'start',
                anchorId: 'a',
                primary,
                primaryTileId: 'tile-1',
                primaryEngine: VideoPlayer.VideoJs,
                added,
                addedTileId: 'tile-2',
            });
            expect(reduction.state).toBeNull();
            expect(reduction.effect).toEqual({
                type: 'rejected',
                reason: 'radio',
            });
        });

        it('rejects adding the source that is already playing', () => {
            expect(
                run(null, {
                    type: 'start',
                    anchorId: 'a',
                    primary: MATCH,
                    primaryTileId: 'tile-1',
                    primaryEngine: VideoPlayer.VideoJs,
                    added: MATCH,
                    addedTileId: 'tile-2',
                }).effect
            ).toEqual({ type: 'rejected', reason: 'already-on-screen' });
        });
    });

    describe('R2 audio', () => {
        it('moves audio without changing sizes or focus', () => {
            const { state } = run(started(), {
                type: 'set-audio',
                tileId: 'tile-2',
            });

            expect(state?.audioTileId).toBe('tile-2');
            expect(state?.activeTileId).toBe('tile-1');
            expect(keys(state)).toEqual(['session:movie', 'session:match']);
            expect(isTileMuted(session(state), 'tile-1')).toBe(true);
        });

        it('rejects audio for an unknown tile', () => {
            expect(
                run(started(), { type: 'set-audio', tileId: 'nope' }).effect
            ).toEqual({ type: 'rejected', reason: 'unknown-tile' });
        });
    });

    describe('R3 swap', () => {
        it('exchanges main and PiP and gives the new main the audio', () => {
            const { state } = run(started(), { type: 'swap' });

            expect(keys(state)).toEqual(['session:match', 'session:movie']);
            expect(state?.audioTileId).toBe('tile-2');
            expect(state?.activeTileId).toBe('tile-2');
        });

        it('keeps tile ids so playing players are not re-created', () => {
            const before = started();
            const { state } = run(before, { type: 'swap' });

            expect(state?.tiles.map((tile) => tile.id)).toEqual([
                'tile-2',
                'tile-1',
            ]);
            expect(state?.tiles[1]).toBe(before.tiles[0]);
        });

        it('swaps back to the original arrangement', () => {
            const before = started();
            const { state } = run(before, { type: 'swap' }, { type: 'swap' });

            expect(state).toEqual(before);
        });

        it('gives the new main the audio even when the PiP already had it', () => {
            const { state } = run(
                started(),
                { type: 'set-audio', tileId: 'tile-2' },
                { type: 'swap' }
            );

            expect(state?.audioTileId).toBe('tile-2');
            expect(mainTile(session(state)).id).toBe('tile-2');
        });
    });

    describe('R4 VOD pause', () => {
        it('holds a VOD tile paused at its position once it loses audio', () => {
            const { state } = run(
                started(),
                { type: 'tile-position', tileId: 'tile-1', seconds: 4000 },
                { type: 'swap' }
            );

            expect(isTileHeldPaused(session(state), 'tile-1')).toBe(true);
            expect(
                state?.tiles.find((tile) => tile.id === 'tile-1')?.lastPosition
            ).toBe(4000);
        });

        it('resumes the VOD tile when it gets audio back', () => {
            const { state } = run(
                started(),
                { type: 'swap' },
                { type: 'swap' }
            );

            expect(isTileHeldPaused(session(state), 'tile-1')).toBe(false);
        });

        it('treats an episode like a movie', () => {
            const state = started(MATCH, source('ep', 'episode'));

            expect(isTileHeldPaused(state, 'tile-2')).toBe(true);
        });

        it('never holds a live tile paused', () => {
            const state = started(NEWS, MATCH);

            expect(isTileHeldPaused(state, 'tile-2')).toBe(false);
        });

        it('records the reported engine status separately from the hold', () => {
            const { state } = run(started(), {
                type: 'tile-status',
                tileId: 'tile-2',
                status: 'playing',
            });

            expect(state?.tiles[1].status).toBe('playing');
        });
    });

    describe('R5 replace', () => {
        it('replaces the stream of a tile in place, keeping its id and audio', () => {
            const { state, effect } = run(started(), {
                type: 'replace',
                tileId: 'tile-1',
                source: NEWS,
            });

            expect(effect).toBeNull();
            expect(state?.tiles[0]).toMatchObject({
                id: 'tile-1',
                playbackSessionKey: 'session:news',
                engine: VideoPlayer.VideoJs,
                status: 'loading',
                lastPosition: 0,
            });
            expect(state?.audioTileId).toBe('tile-1');
        });

        it('rejects a source another tile already shows', () => {
            expect(
                run(started(), {
                    type: 'replace',
                    tileId: 'tile-1',
                    source: MATCH,
                }).effect
            ).toEqual({ type: 'rejected', reason: 'already-on-screen' });
        });

        it('ignores replacing a tile with the source it already plays', () => {
            const before = started();
            const reduction = run(before, {
                type: 'replace',
                tileId: 'tile-2',
                source: MATCH,
            });

            expect(reduction).toEqual({ state: before, effect: null });
        });

        it('rejects radio', () => {
            expect(
                run(started(), {
                    type: 'replace',
                    tileId: 'tile-2',
                    source: source('r', 'live', { radio: true }),
                }).effect
            ).toEqual({ type: 'rejected', reason: 'radio' });
        });
    });

    describe('R6 capacity', () => {
        it('replaces the PiP tile when the PiP layout is full (D1)', () => {
            const before = started();
            const { state, effect } = run(before, {
                type: 'add',
                source: NEWS,
                tileId: 'tile-3',
            });

            expect(keys(state)).toEqual(['session:movie', 'session:news']);
            expect(state?.tiles[1].id).toBe('tile-2');
            expect(effect).toEqual({
                type: 'replaced',
                previous: before.tiles[1],
                tileNumber: 2,
            });
        });

        it('starts the replacing tile muted and keeps audio on the main tile', () => {
            const { state } = run(
                started(),
                { type: 'set-audio', tileId: 'tile-2' },
                { type: 'add', source: NEWS, tileId: 'tile-3' }
            );

            expect(state?.audioTileId).toBe('tile-1');
        });

        it('undoes a replacement', () => {
            const before = started();
            const replaced = run(before, {
                type: 'add',
                source: NEWS,
                tileId: 'tile-3',
            });
            if (replaced.effect?.type !== 'replaced') throw new Error();
            const { state } = run(replaced.state, {
                type: 'undo-replace',
                previous: replaced.effect.previous,
            });

            expect(keys(state)).toEqual(['session:movie', 'session:match']);
        });

        it('resumes an undone VOD tile where it was replaced', () => {
            const vod = started(MATCH, source('film', 'vod'));
            const replaced = run(
                vod,
                { type: 'tile-position', tileId: 'tile-2', seconds: 754 },
                { type: 'add', source: NEWS, tileId: 'tile-3' }
            );
            if (replaced.effect?.type !== 'replaced') throw new Error();
            const { state } = run(replaced.state, {
                type: 'undo-replace',
                previous: replaced.effect.previous,
            });

            expect(state?.tiles[1]).toMatchObject({
                playbackSessionKey: 'session:film',
                position: 754,
                lastPosition: 754,
            });
        });

        it('appends below the capacity of a larger layout', () => {
            const grid: MultiviewSessionState = {
                ...started(),
                layout: 'grid',
            };
            const { state, effect } = run(
                grid,
                { type: 'add', source: NEWS, tileId: 'tile-3' },
                { type: 'add', source: source('doc'), tileId: 'tile-4' }
            );

            expect(effect).toBeNull();
            expect(state?.tiles.map((tile) => tile.id)).toEqual([
                'tile-1',
                'tile-2',
                'tile-3',
                'tile-4',
            ]);
            expect(state?.audioTileId).toBe('tile-1');
        });

        it('replaces the active tile once a larger layout is full', () => {
            const grid: MultiviewSessionState = {
                ...started(),
                layout: 'grid',
            };
            const { state, effect } = run(
                grid,
                { type: 'add', source: NEWS, tileId: 'tile-3' },
                { type: 'add', source: source('doc'), tileId: 'tile-4' },
                { type: 'set-active', tileId: 'tile-3' },
                { type: 'add', source: source('extra'), tileId: 'tile-5' }
            );

            expect(effect).toMatchObject({ type: 'replaced', tileNumber: 3 });
            expect(state?.tiles[2]).toMatchObject({
                id: 'tile-3',
                playbackSessionKey: 'session:extra',
            });
        });

        it('rejects adding without a session', () => {
            expect(
                run(null, { type: 'add', source: NEWS, tileId: 'tile-3' })
                    .effect
            ).toEqual({ type: 'rejected', reason: 'no-session' });
        });
    });

    describe('R7 close', () => {
        it('ends the session at one tile and hands the survivor back', () => {
            const before = started();
            const { state, effect } = run(before, {
                type: 'remove',
                tileId: 'tile-2',
            });

            expect(state).toBeNull();
            expect(effect).toEqual({
                type: 'ended',
                reason: 'last-tile',
                survivor: before.tiles[0],
            });
        });

        it('moves audio and focus to the new main tile when the main tile closes', () => {
            const grid: MultiviewSessionState = {
                ...started(),
                layout: 'grid',
            };
            const { state } = run(
                grid,
                { type: 'add', source: NEWS, tileId: 'tile-3' },
                { type: 'remove', tileId: 'tile-1' }
            );

            expect(state?.tiles.map((tile) => tile.id)).toEqual([
                'tile-2',
                'tile-3',
            ]);
            expect(state?.audioTileId).toBe('tile-2');
            expect(state?.activeTileId).toBe('tile-2');
        });

        it('rejects closing an unknown tile', () => {
            expect(
                run(started(), { type: 'remove', tileId: 'nope' }).effect
            ).toEqual({ type: 'rejected', reason: 'unknown-tile' });
        });
    });

    describe('R8 exit', () => {
        it('keeps the audio tile', () => {
            const before = started();
            const { state, effect } = run(
                before,
                { type: 'set-audio', tileId: 'tile-2' },
                { type: 'exit' }
            );

            expect(state).toBeNull();
            expect(effect).toEqual({
                type: 'ended',
                reason: 'exit',
                survivor: before.tiles[1],
            });
        });

        it('ends for an external reason with the audio tile as survivor', () => {
            const before = started();
            expect(
                run(before, { type: 'end', reason: 'anchor-left' }).effect
            ).toEqual({
                type: 'ended',
                reason: 'anchor-left',
                survivor: before.tiles[0],
            });
        });
    });

    describe('parental relock', () => {
        it('removes a withheld tile and moves its audio', () => {
            const grid: MultiviewSessionState = {
                ...started(),
                layout: 'grid',
            };
            const { state } = run(
                grid,
                { type: 'add', source: NEWS, tileId: 'tile-3' },
                { type: 'set-audio', tileId: 'tile-3' },
                { type: 'withhold', tileIds: ['tile-3'] }
            );

            expect(keys(state)).toEqual(['session:movie', 'session:match']);
            expect(state?.audioTileId).toBe('tile-1');
        });

        it('ends the session when one tile is left', () => {
            const before = started();
            expect(
                run(before, { type: 'withhold', tileIds: ['tile-1'] }).effect
            ).toEqual({
                type: 'ended',
                reason: 'withheld',
                survivor: before.tiles[1],
            });
        });

        it('ends without a survivor when every tile is withheld', () => {
            expect(
                run(started(), {
                    type: 'withhold',
                    tileIds: ['tile-1', 'tile-2'],
                }).effect
            ).toEqual({ type: 'ended', reason: 'withheld', survivor: null });
        });

        it('ignores tiles that are not on screen', () => {
            const before = started();
            expect(
                run(before, { type: 'withhold', tileIds: ['nope'] })
            ).toEqual({ state: before, effect: null });
        });
    });

    describe('layout and geometry', () => {
        it('rejects layouts that are not available yet', () => {
            expect(
                run(started(), { type: 'set-layout', layout: 'grid' }).effect
            ).toEqual({ type: 'rejected', reason: 'layout-unavailable' });
        });

        it('keeps the main tile active in PiP', () => {
            const before = started();
            expect(
                run(before, { type: 'set-active', tileId: 'tile-2' })
            ).toEqual({ state: before, effect: null });
        });

        it('remembers the PiP corner and width', () => {
            const { state } = run(started(), {
                type: 'set-pip-geometry',
                geometry: { corner: 'top-left', width: 360 },
            });

            expect(state?.pip).toEqual({ corner: 'top-left', width: 360 });
        });

        it('numbers tiles from one in screen order', () => {
            const { state } = run(started(), { type: 'swap' });

            expect(tileNumberOf(session(state), 'tile-2')).toBe(1);
            expect(tileNumberOf(session(state), 'tile-1')).toBe(2);
            expect(tileNumberOf(session(state), 'nope')).toBeNull();
        });
    });

    it('rejects every tile command without a session', () => {
        for (const command of [
            { type: 'swap' },
            { type: 'exit' },
            { type: 'remove', tileId: 'tile-1' },
            { type: 'set-audio', tileId: 'tile-1' },
        ] as MultiviewCommand[]) {
            expect(run(null, command).effect).toEqual({
                type: 'rejected',
                reason: 'no-session',
            });
        }
    });
});
