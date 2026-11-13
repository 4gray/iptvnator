import { ApplicationInitStatus, DOCUMENT } from '@angular/core';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util/tokens';
import { TestBed } from '@angular/core/testing';
import { provideAndroidPlaybackCheckpoint } from './android-playback-checkpoint.providers';

const id = '00000000-0000-4000-8000-000000000001';
const savedAt = 100_000;
const content = {
    playlistId: 'synthetic-playlist',
    contentXtreamId: 17,
    contentType: 'episode',
    seriesXtreamId: 3,
    seasonNumber: 2,
    episodeNumber: 1,
    activitySessionId: 'synthetic-session',
    activityIdentity: {
        provider: 'stalker',
        kind: 'episode',
        mode: 'lazy',
        id: 'synthetic-episode',
        seriesId: 'synthetic-series',
        seasonKey: 'synthetic-season',
        episodeNumber: 1,
    },
};

it('skips checkpoint setup without the Android bridge', async () => {
    const positionsFactory = jest.fn();
    TestBed.configureTestingModule({
        providers: [
            { provide: DOCUMENT, useValue: { defaultView: window } },
            {
                provide: PORTAL_PLAYBACK_POSITIONS,
                useFactory: positionsFactory,
            },
            provideAndroidPlaybackCheckpoint(),
        ],
    });

    await TestBed.inject(ApplicationInitStatus).donePromise;

    expect(positionsFactory).not.toHaveBeenCalled();
});

describe('restoring Android playback checkpoints', () => {
    const getPlaybackPosition = jest.fn();
    const savePlaybackPositionOrThrow = jest.fn();
    const postMessage = jest.fn();
    let documentWindow: EventTarget;

    beforeEach(async () => {
        jest.resetAllMocks();
        getPlaybackPosition.mockResolvedValue(null);
        savePlaybackPositionOrThrow.mockResolvedValue(undefined);
        documentWindow = Object.assign(new EventTarget(), {
            TvShell: { postMessage },
        });
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: DOCUMENT,
                    useValue: {
                        defaultView: documentWindow,
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getPlaybackPosition,
                        savePlaybackPositionOrThrow,
                    },
                },
                provideAndroidPlaybackCheckpoint(),
            ],
        });
        await TestBed.inject(ApplicationInitStatus).donePromise;
    });

    function deliver(patch: Record<string, unknown> = {}) {
        documentWindow.dispatchEvent(
            new CustomEvent('iptvnator:android-playback-checkpoint', {
                detail: {
                    id,
                    savedAt,
                    positionMs: 32_210,
                    durationMs: 90_000,
                    content: JSON.stringify({
                        ...content,
                        streamUrl: 'https://media.example.test/synthetic.mp4',
                    }),
                    ...patch,
                },
            })
        );
        return new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    it('saves the original episode once before acknowledging duplicate delivery', async () => {
        const refreshed = jest.fn();
        window.addEventListener('iptvnator-activity-changed', refreshed, {
            once: true,
        });
        try {
            await Promise.all([deliver(), deliver()]);
            expect(refreshed).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener('iptvnator-activity-changed', refreshed);
        }
        expect(getPlaybackPosition).toHaveBeenCalledWith(
            content.playlistId,
            content.contentXtreamId,
            'episode'
        );
        expect(savePlaybackPositionOrThrow).toHaveBeenCalledTimes(1);
        expect(savePlaybackPositionOrThrow).toHaveBeenCalledWith(
            content.playlistId,
            { ...content, positionSeconds: 32, durationSeconds: 90 }
        );
        expect(postMessage).toHaveBeenCalledWith(
            JSON.stringify(['acknowledgeNativePlaybackCheckpoint', id])
        );
    });

    it('keeps a newer position from the same episode', async () => {
        getPlaybackPosition.mockResolvedValue({
            updatedAt: new Date(savedAt + 1000).toISOString(),
        });
        await deliver();
        expect(savePlaybackPositionOrThrow).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('keeps a nonzero position when the duration is unknown', async () => {
        await deliver({ durationMs: 0 });
        expect(savePlaybackPositionOrThrow).toHaveBeenCalledWith(
            content.playlistId,
            expect.objectContaining({
                positionSeconds: 32,
                durationSeconds: undefined,
            })
        );
    });

    it('retries a failed write when Android delivers the checkpoint again', async () => {
        savePlaybackPositionOrThrow.mockRejectedValueOnce(
            new Error('synthetic storage failure')
        );
        await deliver();
        expect(postMessage).not.toHaveBeenCalled();
        await deliver();
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it.each([
        { positionMs: 91_000 },
        { positionMs: 0, durationMs: 0 },
        { content: '{' },
        { content: JSON.stringify({ ...content, contentType: 'live' }) },
    ])('discards invalid checkpoint %j', async (patch) => {
        await deliver(patch);
        expect(getPlaybackPosition).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledTimes(1);
    });
});
