import { signal } from '@angular/core';
import {
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';

export const LIVE_PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/live',
    title: 'Live news',
};

export const VOD_PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/movie',
    title: 'Movie',
    contentInfo: {
        contentXtreamId: 42,
        contentType: 'vod',
        playlistId: 'playlist-1',
    },
};

export function supported(
    overrides: Partial<EmbeddedMpvSupport> = {}
): EmbeddedMpvSupport {
    return {
        supported: true,
        platform: 'darwin',
        engine: 'frame-copy',
        capabilities: {
            subtitles: true,
            playbackSpeed: true,
            aspectOverride: true,
            screenshot: false,
            recording: true,
        },
        ...overrides,
    };
}

export function session(
    overrides: Partial<EmbeddedMpvSession> = {}
): EmbeddedMpvSession {
    return {
        id: 'session-1',
        title: 'Movie',
        streamUrl: VOD_PLAYBACK.streamUrl,
        status: 'playing',
        positionSeconds: 25,
        durationSeconds: 100,
        volume: 0.65,
        audioTracks: [
            {
                id: 1,
                title: 'English',
                selected: true,
                defaultTrack: true,
            },
            { id: 2, selected: false },
        ],
        selectedAudioTrackId: 1,
        subtitleTracks: [
            { id: 3, language: 'de', selected: true },
            { id: 4, selected: false },
        ],
        selectedSubtitleTrackId: 3,
        playbackSpeed: 1.25,
        aspectOverride: '16:9',
        recording: { active: false },
        startedAt: '2026-07-16T10:00:00.000Z',
        updatedAt: '2026-07-16T10:00:01.000Z',
        ...overrides,
    };
}

export function createController() {
    return {
        support: signal<EmbeddedMpvSupport | null>(supported()),
        session: signal<EmbeddedMpvSession | null>(session()),
        stalled: signal(false),
        togglePaused: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
        seekTo: jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined),
        seekBy: jest.fn<Promise<boolean>, [number]>().mockResolvedValue(true),
        applyVolume: jest
            .fn<Promise<void>, [number]>()
            .mockResolvedValue(undefined),
        setAudioTrack: jest
            .fn<Promise<void>, [number]>()
            .mockResolvedValue(undefined),
        setSubtitleTrack: jest
            .fn<Promise<void>, [number]>()
            .mockResolvedValue(undefined),
        setSpeed: jest
            .fn<Promise<void>, [number]>()
            .mockResolvedValue(undefined),
        setAspect: jest
            .fn<Promise<void>, [string]>()
            .mockResolvedValue(undefined),
        startRecording: jest
            .fn<
                Promise<EmbeddedMpvSession['recording'] | null>,
                [string | undefined, string]
            >()
            .mockResolvedValue(null),
        stopRecording: jest
            .fn<Promise<EmbeddedMpvSession['recording'] | null>, []>()
            .mockResolvedValue(null),
    };
}

export function translations(prefix = ''): object {
    return {
        EMBEDDED_MPV: {
            PLAYER: {
                PLAYBACK_FAILED: `${prefix}Playback failed`,
                CHECKING_SUPPORT: `${prefix}Checking support`,
                NOT_AVAILABLE: `${prefix}Not available`,
                LOADING_STREAM: `${prefix}Loading stream`,
                TRACK_DEFAULT: `${prefix}Default`,
                AUDIO_TRACK_FALLBACK: `${prefix}Audio {{index}}`,
                SUBTITLE_TRACK_FALLBACK: `${prefix}Subtitle {{index}}`,
            },
        },
    };
}
