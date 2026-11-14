import { VideoPlayer } from '@iptvnator/shared/interfaces';
import type {
    MultiviewSessionState,
    MultiviewTile,
} from '@iptvnator/playback/multiview/data-access';
import {
    PIP_DOCK_CLEARANCE,
    PIP_INSET,
    pipBox,
    placeTiles,
    stableTileOrder,
} from './pip-geometry';

const STAGE = { width: 1280, height: 720 };

function tile(id: string): MultiviewTile {
    return {
        id,
        playback: { streamUrl: `https://stream.example/${id}.m3u8`, title: id },
        playbackSessionKey: `session:${id}`,
        kind: 'live',
        playlistId: 'playlist-1',
        title: id,
        engine: VideoPlayer.Html5Player,
        status: 'playing',
        lastPosition: 0,
    };
}

describe('pipBox', () => {
    it('defaults to 30 % of the stage, 16:9, bottom-right above the dock', () => {
        expect(pipBox(STAGE, { corner: 'bottom-right', width: null })).toEqual({
            left: 1280 - PIP_INSET - 384,
            top: 720 - PIP_INSET - PIP_DOCK_CLEARANCE - 216,
            width: 384,
            height: 216,
        });
    });

    it.each([
        ['top-left', { left: PIP_INSET, top: PIP_INSET }],
        ['top-right', { left: 1280 - PIP_INSET - 384, top: PIP_INSET }],
        [
            'bottom-left',
            {
                left: PIP_INSET,
                top: 720 - PIP_INSET - PIP_DOCK_CLEARANCE - 216,
            },
        ],
    ] as const)('snaps to the %s corner', (corner, position) => {
        expect(pipBox(STAGE, { corner, width: null })).toMatchObject(position);
    });

    it.each([
        [100, 240],
        [900, 480],
        [300, 300],
    ])('clamps a chosen width of %i px to %i px', (chosen, expected) => {
        expect(
            pipBox(
                { width: 1920, height: 1080 },
                {
                    corner: 'top-left',
                    width: chosen,
                }
            ).width
        ).toBe(expected);
    });

    it('shrinks below the minimum when the stage is too small', () => {
        const box = pipBox(
            { width: 200, height: 400 },
            { corner: 'bottom-right', width: null }
        );

        expect(box.width).toBe(200 - 2 * PIP_INSET);
        expect(box.left).toBe(PIP_INSET);
    });

    it('never grows taller than the room above the dock', () => {
        const box = pipBox(
            { width: 1600, height: 300 },
            { corner: 'bottom-right', width: 480 }
        );

        expect(box.top).toBe(PIP_INSET);
        expect(box.height).toBeLessThanOrEqual(
            300 - 2 * PIP_INSET - PIP_DOCK_CLEARANCE
        );
    });
});

describe('placeTiles', () => {
    it('fills the stage with the main tile and puts the next one in PiP', () => {
        const state: MultiviewSessionState = {
            tiles: [tile('b'), tile('a')],
            layout: 'pip',
            activeTileId: 'b',
            audioTileId: 'b',
            anchorId: 'anchor',
            pip: { corner: 'top-left', width: null },
        };

        const placements = placeTiles(STAGE, state);

        expect(placements.get('b')).toEqual({
            role: 'main',
            box: { left: 0, top: 0, width: 1280, height: 720 },
        });
        expect(placements.get('a')?.role).toBe('pip');
        expect(placements.get('a')?.box.left).toBe(PIP_INSET);
    });
});

describe('stableTileOrder', () => {
    it('keeps creation order when the session reorders tiles', () => {
        const previous = ['a', 'b'];

        expect(stableTileOrder(previous, ['b', 'a'])).toBe(previous);
    });

    it('appends new tiles and drops closed ones', () => {
        expect(stableTileOrder(['a', 'b'], ['b', 'c'])).toEqual(['b', 'c']);
    });
});
