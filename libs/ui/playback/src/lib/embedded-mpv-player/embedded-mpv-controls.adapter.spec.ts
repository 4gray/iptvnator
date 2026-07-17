import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    DEFAULT_ASPECT_PRESETS,
    DEFAULT_PLAYER_CAPABILITIES,
    DEFAULT_SPEED_PRESETS,
    createEmptyControlsState,
} from '../player-controls/player-controls-defaults';
import { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { EmbeddedMpvControlsAdapter } from './embedded-mpv-controls.adapter';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

const LIVE_PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/live',
    title: 'Live news',
};

const VOD_PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/movie',
    title: 'Movie',
    contentInfo: {
        contentXtreamId: 42,
        contentType: 'vod',
        playlistId: 'playlist-1',
    },
};

function supported(
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

function session(
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

function createController() {
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

function translations(prefix = ''): object {
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

describe('EmbeddedMpvControlsAdapter', () => {
    let adapter: EmbeddedMpvControlsAdapter;
    let controller: ReturnType<typeof createController>;
    let playback: WritableSignal<ResolvedPortalPlayback>;
    let seriesNavigation: WritableSignal<SeriesPlaybackNavigation | null>;

    beforeEach(() => {
        localStorage.clear();
        controller = createController();
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                EmbeddedMpvControlsAdapter,
                {
                    provide: EmbeddedMpvSessionController,
                    useValue: controller,
                },
            ],
        });

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', translations());
        translate.setDefaultLang('en');
        translate.use('en');

        adapter = TestBed.inject(EmbeddedMpvControlsAdapter);
        playback = signal(VOD_PLAYBACK);
        seriesNavigation = signal({
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        localStorage.clear();
    });

    function configure(localTimeshiftActive = signal(false)): void {
        adapter.configure({
            playback,
            seriesNavigation,
            recordingFolder: signal('/recordings'),
            localTimeshiftActive,
        });
    }

    it('returns safe empty defaults before it is configured', () => {
        expect(adapter.capabilities()).toEqual(DEFAULT_PLAYER_CAPABILITIES);
        expect(adapter.state()).toEqual(createEmptyControlsState());
    });

    it('derives baseline, optional, and VOD series capabilities', () => {
        configure();

        expect(adapter.capabilities()).toEqual({
            seek: true,
            volume: true,
            audioTracks: true,
            subtitles: true,
            playbackSpeed: true,
            aspectRatio: true,
            recording: true,
            fullscreen: true,
            seriesNavigation: true,
        });

        controller.support.set(
            supported({
                capabilities: {
                    subtitles: false,
                    playbackSpeed: false,
                    aspectOverride: false,
                    screenshot: true,
                    recording: false,
                },
            })
        );

        expect(adapter.capabilities()).toEqual({
            seek: true,
            volume: true,
            audioTracks: true,
            subtitles: false,
            playbackSpeed: false,
            aspectRatio: false,
            recording: false,
            fullscreen: true,
            seriesNavigation: true,
        });
    });

    it('uses semantic live detection and only enables live seeking for Timeshift', () => {
        configure();
        expect(adapter.state().isLive).toBe(false);

        playback.set({ ...LIVE_PLAYBACK, isLive: false });
        expect(adapter.state().isLive).toBe(false);

        playback.set({ ...VOD_PLAYBACK, isLive: true });

        expect(adapter.capabilities().seek).toBe(false);
        expect(adapter.capabilities().seriesNavigation).toBe(false);
        expect(adapter.state().isLive).toBe(true);
        expect(adapter.state().durationSeconds).toBeNull();
        expect(adapter.state().canSeek).toBe(false);
        expect(adapter.state().canPreviousEpisode).toBe(false);
        expect(adapter.state().canNextEpisode).toBe(false);
        configure(signal(true));
        expect(adapter.capabilities().seek).toBe(true);
        expect(adapter.capabilities().seriesNavigation).toBe(false);
        expect(adapter.state().canSeek).toBe(true);
    });

    it('maps session state, presets, seekability, stalled state, and reactive series navigation', () => {
        configure();
        controller.stalled.set(true);

        expect(adapter.state()).toMatchObject({
            status: 'playing',
            statusMessage: '',
            stalled: true,
            positionSeconds: 25,
            durationSeconds: 100,
            isLive: false,
            canSeek: true,
            volume: 0.65,
            subtitlesEnabled: true,
            playbackSpeed: 1.25,
            speedPresets: DEFAULT_SPEED_PRESETS,
            aspectRatio: '16:9',
            aspectPresets: DEFAULT_ASPECT_PRESETS,
            canPreviousEpisode: true,
            canNextEpisode: false,
        });

        seriesNavigation.set({
            canPrevious: false,
            canNext: true,
            autoplayEnabled: false,
        });
        expect(adapter.state().canPreviousEpisode).toBe(false);
        expect(adapter.state().canNextEpisode).toBe(true);

        controller.session.set(
            session({ positionSeconds: -5, durationSeconds: 0 })
        );
        expect(adapter.state().positionSeconds).toBe(0);
        expect(adapter.state().canSeek).toBe(false);
    });

    it('uses the stored volume when there is no session', () => {
        localStorage.setItem('volume', '0.35');
        controller.session.set(null);
        controller.support.set(supported());
        configure();

        expect(adapter.state().volume).toBe(0.35);
    });

    it('uses translated existing helpers for audio and subtitle labels', () => {
        configure();

        expect(adapter.state().audioTracks).toEqual([
            {
                id: 1,
                label: 'English · Default',
                selected: true,
            },
            { id: 2, label: 'Audio 2', selected: false },
        ]);
        expect(adapter.state().subtitleTracks).toEqual([
            { id: 3, label: 'de', selected: true },
            { id: 4, label: 'Subtitle 2', selected: false },
        ]);
    });

    it('maps support and session statuses with detailed and translated fallback messages', () => {
        configure();

        controller.support.set(null);
        expect(adapter.state()).toMatchObject({
            status: 'loading',
            statusMessage: 'Checking support',
        });

        controller.support.set({
            supported: false,
            platform: 'linux',
            reason: 'libmpv is missing',
        });
        expect(adapter.state()).toMatchObject({
            status: 'idle',
            statusMessage: 'libmpv is missing',
        });

        controller.support.set({ supported: false, platform: 'linux' });
        expect(adapter.state().statusMessage).toBe('Not available');

        controller.support.set(supported());
        controller.session.set(null);
        expect(adapter.state()).toMatchObject({
            status: 'loading',
            statusMessage: 'Loading stream',
        });

        controller.session.set(session({ status: 'loading' }));
        expect(adapter.state()).toMatchObject({
            status: 'loading',
            statusMessage: 'Loading stream',
        });

        for (const status of ['playing', 'paused', 'idle'] as const) {
            controller.session.set(session({ status }));
            expect(adapter.state()).toMatchObject({
                status,
                statusMessage: '',
            });
        }

        for (const status of ['ended', 'closed'] as const) {
            controller.session.set(session({ status }));
            expect(adapter.state()).toMatchObject({
                status: 'ended',
                statusMessage: '',
            });
        }

        controller.session.set(
            session({ status: 'error', error: 'Decoder exploded' })
        );
        expect(adapter.state()).toMatchObject({
            status: 'error',
            statusMessage: 'Decoder exploded',
        });

        controller.session.set(session({ status: 'error', error: undefined }));
        expect(adapter.state().statusMessage).toBe('Playback failed');
    });

    it('delegates every non-recording shared-controls command', () => {
        configure();

        adapter.commands.togglePlay();
        adapter.commands.seekTo(45);
        adapter.commands.seekBy(-10);
        adapter.commands.setVolume(0.4);
        adapter.commands.setAudioTrack(2);
        adapter.commands.setSubtitleTrack(-1);
        adapter.commands.setPlaybackSpeed(1.5);
        adapter.commands.setAspectRatio('4:3');

        expect(controller.togglePaused).toHaveBeenCalledTimes(1);
        expect(controller.seekTo).toHaveBeenCalledWith(45);
        expect(controller.seekBy).toHaveBeenCalledWith(-10);
        expect(controller.applyVolume).toHaveBeenCalledWith(0.4);
        expect(controller.setAudioTrack).toHaveBeenCalledWith(2);
        expect(controller.setSubtitleTrack).toHaveBeenCalledWith(-1);
        expect(controller.setSpeed).toHaveBeenCalledWith(1.5);
        expect(controller.setAspect).toHaveBeenCalledWith('4:3');
    });
});
