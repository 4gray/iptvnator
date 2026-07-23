import type {
    EmbeddedMpvSession,
    PersistedRecordingItem,
} from '@iptvnator/shared/interfaces';
import type { EmbeddedMpvNativeService } from './embedded-mpv-native.service';
import type { RecordingEngine } from './recording-engine';
import {
    DesktopRecordingEngine,
    EmbeddedMpvRecordingEngine,
} from './recording-engine';

jest.mock('./embedded-mpv-native.service', () => ({
    embeddedMpvNativeService: {},
}));
jest.mock('./store.service', () => ({
    VLC_PLAYER_PATH: 'VLC_PLAYER_PATH',
    store: { get: jest.fn().mockReturnValue('') },
}));

function recording(): PersistedRecordingItem {
    return {
        id: 'recording-1',
        playlistId: 'playlist-1',
        sourceType: 'm3u',
        channelId: 'news',
        channelName: 'News',
        title: 'Evening News',
        streamUrl: 'https://example.com/private-token',
        requestHeaders: { Authorization: 'Bearer secret' },
        scheduledStartAt: '2026-07-14T18:00:00.000Z',
        scheduledEndAt: '2026-07-14T19:00:00.000Z',
        paddingBeforeSeconds: 0,
        paddingAfterSeconds: 0,
        status: 'scheduled',
    };
}

function session(
    recordingState: EmbeddedMpvSession['recording'] = { active: false }
): EmbeddedMpvSession {
    return {
        id: 'private-session',
        title: 'Evening News',
        streamUrl: '',
        status: 'playing',
        positionSeconds: 0,
        durationSeconds: null,
        volume: 0,
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        recording: recordingState,
        startedAt: '2026-07-14T18:00:00.000Z',
        updatedAt: '2026-07-14T18:00:00.000Z',
    };
}

describe('EmbeddedMpvRecordingEngine', () => {
    let mpv: {
        prepareAddon: jest.Mock;
        createMainProcessSession: jest.Mock;
        loadPlayback: jest.Mock;
        startRecording: jest.Mock;
        stopRecording: jest.Mock;
        disposeSession: jest.Mock;
    };
    let engine: EmbeddedMpvRecordingEngine;

    beforeEach(() => {
        mpv = {
            prepareAddon: jest.fn().mockReturnValue({
                supported: true,
                capabilities: { recording: true },
            }),
            createMainProcessSession: jest.fn().mockReturnValue(session()),
            loadPlayback: jest.fn(),
            startRecording: jest.fn().mockReturnValue(
                session({
                    active: true,
                    targetPath: '/recordings/evening-news.ts',
                })
            ),
            stopRecording: jest.fn().mockReturnValue(
                session({
                    active: false,
                    targetPath: '/recordings/evening-news.ts',
                })
            ),
            disposeSession: jest.fn(),
        };
        engine = new EmbeddedMpvRecordingEngine(
            mpv as unknown as EmbeddedMpvNativeService
        );
    });

    it('requires native recording capability', () => {
        mpv.prepareAddon.mockReturnValue({
            supported: true,
            capabilities: { recording: false },
        });

        expect(engine.getSupport()).toEqual(
            expect.objectContaining({ supported: false })
        );
    });

    it('starts a private MPV session with the persisted playback snapshot', async () => {
        await expect(engine.start(recording())).resolves.toEqual({
            fileName: 'evening-news.ts',
            filePath: '/recordings/evening-news.ts',
            bytesRecorded: null,
        });

        expect(mpv.createMainProcessSession).toHaveBeenCalled();
        expect(mpv.loadPlayback).toHaveBeenCalledWith('private-session', {
            streamUrl: 'https://example.com/private-token',
            title: 'Evening News',
            thumbnail: undefined,
            isLive: true,
            headers: { Authorization: 'Bearer secret' },
        });
    });

    it('always disposes the native session after stop failure', async () => {
        await engine.start(recording());
        mpv.stopRecording.mockImplementation(() => {
            throw new Error('Native stop failed');
        });

        await expect(engine.stop('recording-1')).rejects.toThrow(
            'Native stop failed'
        );
        expect(mpv.disposeSession).toHaveBeenCalledWith('private-session');
    });

    it('rejects an empty native recording after a confirmed stop', async () => {
        await engine.start(recording());

        await expect(engine.stop('recording-1')).rejects.toThrow(
            'Embedded MPV recording produced an empty output file'
        );
        expect(mpv.disposeSession).toHaveBeenCalledWith('private-session');
    });
});

describe('DesktopRecordingEngine', () => {
    const powerSaveBlocker = {
        start: jest.fn().mockReturnValue(77),
        stop: jest.fn(),
        isStarted: jest.fn().mockReturnValue(true),
    };

    function mockEngine(supported: boolean): jest.Mocked<RecordingEngine> {
        return {
            getSupport: jest.fn().mockReturnValue({
                supported,
                ...(supported ? {} : { reason: 'Unavailable' }),
            }),
            start: jest.fn().mockResolvedValue({
                fileName: 'recording.ts',
                filePath: '/recordings/recording.ts',
                bytesRecorded: 0,
            }),
            stop: jest.fn().mockResolvedValue({
                fileName: 'recording.ts',
                filePath: '/recordings/recording.ts',
                bytesRecorded: 1024,
            }),
            shutdown: jest.fn(),
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        powerSaveBlocker.start.mockReturnValue(77);
        powerSaveBlocker.isStarted.mockReturnValue(true);
    });

    it('prefers embedded MPV during request-specific preflight', () => {
        const mpv = mockEngine(true);
        const vlc = mockEngine(true);
        vlc.getSupportFor = jest.fn().mockReturnValue({
            supported: false,
            reason: 'Unsupported VLC headers',
        });
        const engine = new DesktopRecordingEngine(mpv, vlc, powerSaveBlocker);

        expect(
            engine.getSupportFor({
                playlistId: 'playlist-1',
                sourceType: 'm3u',
                channelId: 'news',
                channelName: 'News',
                title: 'Evening News',
                scheduledStartAt: '2026-07-14T18:00:00.000Z',
                scheduledEndAt: '2026-07-14T19:00:00.000Z',
                playback: {
                    streamUrl: 'https://example.com/live',
                    title: 'News',
                    headers: { Authorization: 'Bearer secret' },
                },
            })
        ).toEqual({ supported: true });
        expect(vlc.getSupportFor).not.toHaveBeenCalled();
    });

    it('uses VLC request preflight when embedded MPV is unavailable', () => {
        const mpv = mockEngine(false);
        const vlc = mockEngine(true);
        vlc.getSupportFor = jest.fn().mockReturnValue({
            supported: false,
            reason: 'Unsupported VLC headers',
        });
        const engine = new DesktopRecordingEngine(mpv, vlc, powerSaveBlocker);
        const request = {
            playlistId: 'playlist-1',
            sourceType: 'm3u' as const,
            channelId: 'news',
            channelName: 'News',
            title: 'Evening News',
            scheduledStartAt: '2026-07-14T18:00:00.000Z',
            scheduledEndAt: '2026-07-14T19:00:00.000Z',
            playback: {
                streamUrl: 'https://example.com/live',
                title: 'News',
                headers: { Authorization: 'Bearer secret' },
            },
        };

        expect(engine.getSupportFor(request)).toEqual({
            supported: false,
            reason: 'Unsupported VLC headers',
        });
        expect(vlc.getSupportFor).toHaveBeenCalledWith(request);
    });

    it('falls back to VLC when embedded MPV recording is unavailable', async () => {
        const mpv = mockEngine(false);
        const vlc = mockEngine(true);
        const engine = new DesktopRecordingEngine(mpv, vlc, powerSaveBlocker);

        expect(engine.getSupport()).toEqual({ supported: true });
        await engine.start(recording());
        await engine.stop('recording-1');

        expect(mpv.start).not.toHaveBeenCalled();
        expect(vlc.start).toHaveBeenCalled();
        expect(vlc.stop).toHaveBeenCalledWith('recording-1');
        expect(powerSaveBlocker.start).toHaveBeenCalledWith(
            'prevent-app-suspension'
        );
        expect(powerSaveBlocker.stop).toHaveBeenCalledWith(77);
    });

    it('retains a still-active engine and sleep blocker after stop failure', async () => {
        const mpv = mockEngine(false);
        const vlc = mockEngine(true);
        vlc.stop.mockRejectedValueOnce(new Error('VLC did not exit'));
        vlc.hasActiveSession = jest.fn().mockReturnValue(true);
        const engine = new DesktopRecordingEngine(mpv, vlc, powerSaveBlocker);

        await engine.start(recording());
        await expect(engine.stop('recording-1')).rejects.toThrow(
            'VLC did not exit'
        );

        expect(engine.hasActiveSession('recording-1')).toBe(true);
        expect(powerSaveBlocker.stop).not.toHaveBeenCalled();
        await expect(engine.stop('recording-1')).resolves.toEqual(
            expect.objectContaining({ bytesRecorded: 1024 })
        );
        expect(powerSaveBlocker.stop).toHaveBeenCalledWith(77);
    });
});
