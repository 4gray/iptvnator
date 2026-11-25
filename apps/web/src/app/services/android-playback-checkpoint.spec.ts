import { setActivePersonalScope } from '@iptvnator/services/profiles';
import {
    prepareSourceConnection,
    sourceProfileName,
} from '@iptvnator/services/source-sync/connection';
import { ApplicationInitStatus, DOCUMENT } from '@angular/core';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util/tokens';
import {
    nativePlaybackMayHaveCheckpoint,
    stampNativePlaybackReset,
} from '@iptvnator/services/pwa-native-playback-resets';
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
    let documentWindow: EventTarget &
        Pick<Window, 'iptvnatorAndroidCheckpointRequestId'>;

    beforeEach(async () => {
        localStorage.clear();
        jest.resetAllMocks();
        getPlaybackPosition.mockResolvedValue(null);
        savePlaybackPositionOrThrow.mockResolvedValue(undefined);
        await install();
    });

    async function install() {
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
    }

    function deliver(patch: Record<string, unknown> = {}) {
        documentWindow.dispatchEvent(
            new CustomEvent('iptvnator:android-playback-checkpoint', {
                detail: {
                    id,
                    savedAt,
                    positionMs: 32_210,
                    durationMs: 90_000,
                    content: JSON.stringify({
                        profile: 'iptvnator',
                        ...content,
                        streamUrl: 'https://media.example.test/synthetic.mp4',
                    }),
                    ...patch,
                },
            })
        );
        return new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    it('retains reset markers until Android confirms the latest launch has no pending checkpoint', () => {
        const storageKey = 'xtream-playback-positions';
        const positions = { 'synthetic-source': [{ positionSeconds: 30 }] };
        const stored = {
            ...positions,
            __iptvnator_native_playback_resets__: {
                'synthetic-source': savedAt,
            },
            __iptvnator_native_playback_episode_resets__: {
                'synthetic-source': { '17,19': savedAt },
            },
        };
        const idle = (detail: string) =>
            documentWindow.dispatchEvent(
                new CustomEvent('iptvnator:android-playback-checkpoints-idle', {
                    detail,
                })
            );
        const scope = Object.assign(window, { TvShell: { postMessage } });
        try {
            documentWindow.iptvnatorAndroidCheckpointRequestId =
                'synthetic-current';
            localStorage.setItem(storageKey, JSON.stringify(stored));
            idle('synthetic-previous');
            expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(
                stored
            );

            idle('synthetic-current');
            expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(
                positions
            );
            expect(
                documentWindow.iptvnatorAndroidCheckpointRequestId
            ).toBeNull();
            scope.iptvnatorAndroidCheckpointRequestId =
                documentWindow.iptvnatorAndroidCheckpointRequestId;
            expect(nativePlaybackMayHaveCheckpoint()).toBe(false);
            const markers: Record<string, unknown> = {};
            stampNativePlaybackReset(markers, 'synthetic-next');
            expect(markers).toEqual({});

            scope.iptvnatorAndroidCheckpointRequestId = 'synthetic-next';
            expect(nativePlaybackMayHaveCheckpoint()).toBe(true);
            stampNativePlaybackReset(markers, 'synthetic-next');
            expect(markers).toEqual({
                __iptvnator_native_playback_resets__: {
                    'synthetic-next': expect.any(Number),
                },
            });
        } finally {
            Reflect.deleteProperty(scope, 'TvShell');
            Reflect.deleteProperty(
                scope,
                'iptvnatorAndroidCheckpointRequestId'
            );
        }
    });

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
            {
                ...content,
                positionSeconds: 32,
                durationSeconds: 90,
                nativeCheckpointAt: new Date(savedAt).toISOString(),
            }
        );
        expect(postMessage).toHaveBeenCalledWith(
            JSON.stringify(['acknowledgeNativePlaybackCheckpoint', id])
        );
    });

    it('leaves a checkpoint from another source profile pending without blocking this profile', async () => {
        await deliver({
            content: JSON.stringify({
                ...content,
                profile: 'iptvnator-server:synthetic-instance',
            }),
        });
        expect(getPlaybackPosition).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();

        await deliver();
        expect(savePlaybackPositionOrThrow).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('leaves a checkpoint from another household profile pending', async () => {
        const kids = 'profile:11111111-1111-4111-8111-111111111111';
        try {
            setActivePersonalScope(kids);
            await deliver();
            expect(savePlaybackPositionOrThrow).not.toHaveBeenCalled();
            expect(postMessage).not.toHaveBeenCalled();

            // A launch inside the profile carries its scope and is accepted there.
            await deliver({
                content: JSON.stringify({
                    profile: 'iptvnator',
                    ...content,
                    personalScope: kids,
                }),
            });
            expect(savePlaybackPositionOrThrow).toHaveBeenCalledTimes(1);
            setActivePersonalScope('shared');
            await deliver({
                content: JSON.stringify({
                    profile: 'iptvnator',
                    ...content,
                    personalScope: kids,
                }),
            });
            expect(savePlaybackPositionOrThrow).toHaveBeenCalledTimes(1);
        } finally {
            setActivePersonalScope('shared');
        }
    });

    it('keeps a newer position from the same episode', async () => {
        getPlaybackPosition.mockResolvedValue({
            updatedAt: new Date(savedAt + 1000).toISOString(),
        });
        await deliver();
        expect(savePlaybackPositionOrThrow).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('uses server time when a remote device clock is ahead', async () => {
        getPlaybackPosition.mockResolvedValue({
            activityPlayedAt: new Date(savedAt + 1000).toISOString(),
            updatedAt: new Date(savedAt - 1000).toISOString(),
        });
        await deliver();
        expect(savePlaybackPositionOrThrow).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('lets shared playback decide whether a recovered checkpoint is newer', async () => {
        TestBed.resetTestingModule();
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({
                apiUrl: 'https://synthetic.invalid/api',
                instanceId: 'synthetic-nas',
            })
        );
        localStorage.setItem(
            'iptvnator-server:synthetic-nas:activity-consent-v1',
            JSON.stringify({ enabled: true })
        );
        await prepareSourceConnection();
        try {
            await install();
            getPlaybackPosition.mockResolvedValue({
                updatedAt: new Date(savedAt + 1000).toISOString(),
            });
            await deliver({
                content: JSON.stringify({
                    ...content,
                    profile: sourceProfileName(),
                }),
            });
            expect(getPlaybackPosition).not.toHaveBeenCalled();
            expect(savePlaybackPositionOrThrow).toHaveBeenCalledTimes(1);
            expect(postMessage).toHaveBeenCalledTimes(1);
        } finally {
            localStorage.clear();
            await prepareSourceConnection();
        }
    });

    it('compares restored desktop timestamps in UTC', async () => {
        getPlaybackPosition.mockResolvedValue({
            updatedAt: '2025-01-01 10:00:00',
        });
        await deliver({ savedAt: Date.parse('2025-01-01T10:00:01Z') });
        expect(savePlaybackPositionOrThrow).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('saves a second episode even while the first awaits a retry', async () => {
        const secondId = '00000000-0000-4000-8000-000000000002';
        savePlaybackPositionOrThrow.mockRejectedValueOnce(
            new Error('Synthetic storage failure')
        );
        await Promise.all([
            deliver(),
            deliver({
                id: secondId,
                content: JSON.stringify({
                    ...content,
                    profile: 'iptvnator',
                    contentXtreamId: 18,
                }),
            }),
        ]);
        expect(postMessage.mock.calls).toEqual([
            [JSON.stringify(['acknowledgeNativePlaybackCheckpoint', secondId])],
        ]);
        await deliver();
        expect(postMessage).toHaveBeenLastCalledWith(
            JSON.stringify(['acknowledgeNativePlaybackCheckpoint', id])
        );
    });

    it('keeps a failed newer checkpoint ahead of an older position for the same episode', async () => {
        const newer = {
            id: '00000000-0000-4000-8000-000000000002',
            savedAt: savedAt + 1000,
            positionMs: 54_000,
        };
        savePlaybackPositionOrThrow.mockRejectedValueOnce(
            new Error('Synthetic storage failure')
        );
        await Promise.all([deliver(newer), deliver()]);
        expect(savePlaybackPositionOrThrow).toHaveBeenCalledTimes(1);
        expect(postMessage).not.toHaveBeenCalled();

        await deliver(newer);
        expect(savePlaybackPositionOrThrow).toHaveBeenLastCalledWith(
            content.playlistId,
            expect.objectContaining({ positionSeconds: 54 })
        );
        expect(postMessage).toHaveBeenLastCalledWith(
            JSON.stringify(['acknowledgeNativePlaybackCheckpoint', newer.id])
        );
    });

    it.each([
        ['item clear', JSON.stringify([content.playlistId, 'episode', 17])],
        ['season clear', JSON.stringify([content.playlistId, 'season', 3, 2])],
        ['series clear', JSON.stringify([content.playlistId, 'series', 3])],
        ['playlist restore', content.playlistId],
    ])('discards an older checkpoint on %s', async (_reason, resetKey) => {
        savePlaybackPositionOrThrow.mockRejectedValueOnce(
            new Error('Synthetic storage failure')
        );
        await deliver();
        expect(postMessage).not.toHaveBeenCalled();
        localStorage.setItem(
            'xtream-playback-positions',
            JSON.stringify({
                __iptvnator_native_playback_resets__: {
                    [resetKey]: Date.now(),
                },
            })
        );
        await deliver();
        expect(savePlaybackPositionOrThrow).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith(
            JSON.stringify(['acknowledgeNativePlaybackCheckpoint', id])
        );
        await deliver({
            id: '00000000-0000-4000-8000-000000000003',
            savedAt: Date.now() + 1000,
        });
        expect(savePlaybackPositionOrThrow).toHaveBeenCalledTimes(2);
    });

    it('uses the provider season group rather than the episode label', async () => {
        localStorage.setItem(
            'xtream-playback-positions',
            JSON.stringify({
                __iptvnator_native_playback_resets__: {
                    [JSON.stringify([content.playlistId, 'season', 3, 5])]:
                        savedAt + 1,
                },
            })
        );
        await deliver({
            content: JSON.stringify({
                ...content,
                profile: 'iptvnator',
                seasonGroup: 5,
            }),
        });
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
