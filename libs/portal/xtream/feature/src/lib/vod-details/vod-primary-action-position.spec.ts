import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
    PlaybackPositionData,
    VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';
import {
    createPrimaryActionPosition,
    formatPlaybackPosition,
} from './vod-primary-action-position';

/**
 * Which position the primary button describes.
 *
 * The page loads the ROUTE copy's row, but a pin means the button plays a
 * different copy — with its own row, or none at all. Reading the wrong one
 * makes the button lie about where it will start.
 */

const ROUTE_PLAYLIST = 'playlist-1';
const ROUTE_CONTENT = 650020;

function source(
    overrides: Partial<VodSourceDescriptor> = {}
): VodSourceDescriptor {
    return {
        id: `${ROUTE_PLAYLIST}:xtream:${ROUTE_CONTENT}`,
        playlistId: ROUTE_PLAYLIST,
        playlistName: 'Portal One',
        portalType: 'xtream',
        contentId: ROUTE_CONTENT,
        rawTitle: 'Example',
        matchConfidence: 'exact',
        year: null,
        isActive: true,
        isPinned: false,
        isTried: false,
        probe: { status: 'idle' },
        ...overrides,
    } as VodSourceDescriptor;
}

function position(seconds: number): PlaybackPositionData {
    return {
        playlistId: 'any',
        contentXtreamId: 1,
        contentType: 'vod',
        positionSeconds: seconds,
        durationSeconds: 7200,
    };
}

const ALT = source({
    id: 'playlist-2:xtream:991',
    playlistId: 'playlist-2',
    contentId: 991,
    isPinned: true,
    isActive: false,
});

function setup(
    sources: VodSourceDescriptor[],
    routePosition: PlaybackPositionData | null,
    load: (source: VodSourceDescriptor) => Promise<PlaybackPositionData | null>
) {
    const sourcesSignal = signal(sources);
    const livePosition = signal<PlaybackPositionData | null>(null);
    const api = TestBed.runInInjectionContext(() =>
        createPrimaryActionPosition({
            sources: sourcesSignal,
            routePlaylistId: signal<string | undefined>(ROUTE_PLAYLIST),
            routeContentId: signal(ROUTE_CONTENT),
            routePosition: signal(routePosition),
            livePosition,
            load,
        })
    );
    return { api, sourcesSignal, livePosition };
}

describe('createPrimaryActionPosition', () => {
    it('describes the route copy when nothing is pinned', () => {
        const load = jest.fn();
        const { api } = setup([source()], position(2538), load);
        TestBed.tick();

        expect(api.hasPosition()).toBe(true);
        expect(api.position()?.positionSeconds).toBe(2538);
        expect(load).not.toHaveBeenCalled();
    });

    it('describes the pinned copy once its row is loaded', async () => {
        const { api } = setup([source(), ALT], position(2538), async () =>
            position(4200)
        );
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();

        // Otherwise the button offers to resume at the ROUTE copy's timecode
        // and then starts the pinned copy somewhere else entirely.
        expect(api.position()?.positionSeconds).toBe(4200);
    });

    it('reads Play for a pinned copy that was never watched', async () => {
        const { api } = setup(
            [source(), ALT],
            position(2538),
            async () => null
        );
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();

        // "Never watched" is an answer, not an absence: falling back to the
        // route copy here would show "Resume 42:18" on a copy that starts at 0.
        expect(api.position()).toBeNull();
        expect(api.hasPosition()).toBe(false);
    });

    it('follows the pinned copy while it is being watched', async () => {
        const { api, livePosition } = setup(
            [source(), ALT],
            position(2538),
            async () => position(600)
        );
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();
        expect(api.position()?.positionSeconds).toBe(600);

        // Playing the pinned copy leaves its stored row behind; the button
        // would keep offering the timecode it had before this session.
        livePosition.set({
            playlistId: ALT.playlistId,
            contentXtreamId: ALT.contentId,
            contentType: 'vod',
            positionSeconds: 3000,
            durationSeconds: 7200,
        });
        TestBed.tick();

        expect(api.position()?.positionSeconds).toBe(3000);
    });

    it('ignores live progress from a copy the button will not play', async () => {
        const { api, livePosition } = setup(
            [source(), ALT],
            position(2538),
            async () => position(600)
        );
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();

        livePosition.set({
            playlistId: 'playlist-9',
            contentXtreamId: 5,
            contentType: 'vod',
            positionSeconds: 3000,
            durationSeconds: 7200,
        });
        TestBed.tick();

        expect(api.position()?.positionSeconds).toBe(600);
    });

    it('ignores a pin on the route’s own copy', () => {
        const load = jest.fn();
        const { api } = setup(
            [source({ isPinned: true })],
            position(2538),
            load
        );
        TestBed.tick();

        // Same row: the position the page already loaded IS this copy's.
        expect(api.position()?.positionSeconds).toBe(2538);
        expect(load).not.toHaveBeenCalled();
    });

    it('drops a lookup the pin outran', async () => {
        let resolveFirst: (value: PlaybackPositionData | null) => void = () => {
            /* replaced below */
        };
        const load = jest
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<PlaybackPositionData | null>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValueOnce(position(60));

        const { api, sourcesSignal } = setup(
            [source(), ALT],
            position(2538),
            load
        );
        TestBed.tick();

        const other = source({
            id: 'playlist-3:xtream:77',
            playlistId: 'playlist-3',
            contentId: 77,
            isPinned: true,
            isActive: false,
        });
        sourcesSignal.set([source(), other]);
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();

        // The first lookup lands late, describing a copy the button no longer
        // plays.
        resolveFirst(position(4200));
        await Promise.resolve();
        TestBed.tick();

        expect(api.position()?.positionSeconds).toBe(60);
    });
});

describe('formatPlaybackPosition', () => {
    it('drops the hour when there is none', () => {
        expect(formatPlaybackPosition(position(123))).toBe('02:03');
    });

    it('keeps the hour when there is one', () => {
        expect(formatPlaybackPosition(position(3723))).toBe('01:02:03');
    });

    it('is empty without a position', () => {
        expect(formatPlaybackPosition(null)).toBe('');
    });
});
