import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { EmbeddedMpvControlsAdapter } from './embedded-mpv-controls.adapter';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

const LIVE_PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/live',
    title: 'Live news',
    isLive: true,
};

const VOD_PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/movie',
    title: 'Movie',
    isLive: false,
    contentInfo: {
        contentXtreamId: 42,
        contentType: 'vod',
        playlistId: 'playlist-1',
    },
};

function supported(recording = true): EmbeddedMpvSupport {
    return {
        supported: true,
        platform: 'darwin',
        engine: 'frame-copy',
        capabilities: {
            subtitles: true,
            playbackSpeed: true,
            aspectOverride: true,
            screenshot: false,
            recording,
        },
    };
}

function session(
    overrides: Partial<EmbeddedMpvSession> = {}
): EmbeddedMpvSession {
    return {
        id: 'session-1',
        title: LIVE_PLAYBACK.title,
        streamUrl: LIVE_PLAYBACK.streamUrl,
        status: 'playing',
        positionSeconds: 0,
        durationSeconds: null,
        volume: 1,
        audioTracks: [{ id: 1, selected: true }],
        selectedAudioTrackId: 1,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
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
                RECORDING_FAILED_TO_START: `${prefix}Failed to start recording`,
                RECORDING_FAILED_TO_STOP: `${prefix}Failed to stop recording`,
                SAVED_TO: `${prefix}Saved to {{path}}`,
            },
        },
    };
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('EmbeddedMpvControlsAdapter recording messages and lifecycle', () => {
    let adapter: EmbeddedMpvControlsAdapter;
    let controller: ReturnType<typeof createController>;
    let translate: TranslateService;
    let playback: WritableSignal<ResolvedPortalPlayback>;
    let seriesNavigation: WritableSignal<SeriesPlaybackNavigation | null>;
    let recordingFolder: WritableSignal<string>;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-16T10:00:10.000Z'));

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

        translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', translations());
        translate.setDefaultLang('en');
        translate.use('en');

        adapter = TestBed.inject(EmbeddedMpvControlsAdapter);
        playback = signal(LIVE_PLAYBACK);
        seriesNavigation = signal(null);
        recordingFolder = signal('/recordings');
        adapter.configure({
            playback,
            seriesNavigation,
            recordingFolder,
        });
        TestBed.tick();
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        jest.useRealTimers();
    });

    it('guards recording unless playback is live and recording is supported', async () => {
        playback.set(VOD_PLAYBACK);
        adapter.commands.toggleRecording();
        await flushPromises();
        expect(controller.startRecording).not.toHaveBeenCalled();

        playback.set(LIVE_PLAYBACK);
        controller.support.set(supported(false));
        adapter.commands.toggleRecording();
        await flushPromises();
        expect(controller.startRecording).not.toHaveBeenCalled();

        controller.support.set(supported(true));
        controller.session.set(session({ status: 'error' }));
        adapter.commands.toggleRecording();
        await flushPromises();
        expect(controller.startRecording).not.toHaveBeenCalled();
    });

    it('starts recording with the configured folder and playback title', async () => {
        controller.startRecording.mockResolvedValue({
            active: true,
            startedAt: new Date().toISOString(),
        });

        adapter.commands.toggleRecording();
        await flushPromises();

        expect(controller.startRecording).toHaveBeenCalledWith(
            '/recordings',
            'Live news'
        );
        expect(adapter.state().recording.message).toBeNull();
    });

    it('reports detailed and translated generic recording-start failures', async () => {
        controller.startRecording.mockResolvedValue({
            active: false,
            error: 'Disk is read-only',
        });
        adapter.commands.toggleRecording();
        await flushPromises();
        expect(adapter.state().recording.message).toBe('Disk is read-only');

        controller.startRecording.mockResolvedValue(null);
        adapter.commands.toggleRecording();
        await flushPromises();
        expect(adapter.state().recording.message).toBe(
            'Failed to start recording'
        );
    });

    it('reports a saved path after stop and auto-dismisses it after five seconds', async () => {
        controller.session.set(
            session({
                recording: {
                    active: true,
                    startedAt: '2026-07-16T10:00:00.000Z',
                },
            })
        );
        controller.stopRecording.mockResolvedValue({
            active: false,
            targetPath: '/recordings/live-news.ts',
        });

        adapter.commands.toggleRecording();
        await flushPromises();

        expect(controller.stopRecording).toHaveBeenCalledTimes(1);
        expect(adapter.state().recording.message).toBe(
            'Saved to /recordings/live-news.ts'
        );

        jest.advanceTimersByTime(4999);
        expect(adapter.state().recording.message).toBe(
            'Saved to /recordings/live-news.ts'
        );

        jest.advanceTimersByTime(1);
        expect(adapter.state().recording.message).toBeNull();
    });

    it('reports detailed and translated generic recording-stop failures', async () => {
        controller.session.set(session({ recording: { active: true } }));
        controller.stopRecording.mockResolvedValue({
            active: false,
            error: 'Muxer failed',
        });
        adapter.commands.toggleRecording();
        await flushPromises();
        expect(adapter.state().recording.message).toBe('Muxer failed');

        controller.stopRecording.mockResolvedValue(null);
        adapter.commands.toggleRecording();
        await flushPromises();
        expect(adapter.state().recording.message).toBe(
            'Failed to stop recording'
        );
    });

    it('computes recording elapsed time and refreshes it every second', () => {
        controller.session.set(
            session({
                recording: {
                    active: true,
                    startedAt: '2026-07-16T10:00:00.000Z',
                },
            })
        );
        TestBed.tick();

        expect(adapter.state().recording).toMatchObject({
            active: true,
            elapsedSeconds: 10,
        });

        jest.advanceTimersByTime(1000);
        expect(adapter.state().recording.elapsedSeconds).toBe(11);

        controller.session.set(
            session({
                recording: {
                    active: true,
                    startedAt: 'not-a-date',
                },
            })
        );
        expect(adapter.state().recording.elapsedSeconds).toBe(0);
    });

    it('reacts to active-language changes', () => {
        expect(adapter.state().audioTracks[0].label).toBe('Audio 1');

        translate.setTranslation('de', translations('DE '));
        translate.use('de');

        expect(adapter.state().audioTracks[0].label).toBe('DE Audio 1');
    });

    it('reacts when translations for the active language change', () => {
        expect(adapter.state().audioTracks[0].label).toBe('Audio 1');

        translate.setTranslation('en', translations('Updated '));

        expect(adapter.state().audioTracks[0].label).toBe('Updated Audio 1');
    });

    it('reacts when the default language changes', () => {
        translate.setTranslation('de', translations('DE '));
        translate.use('');
        translate.setDefaultLang('en');
        expect(adapter.state().audioTracks[0].label).toBe('Audio 1');

        translate.setDefaultLang('de');

        expect(adapter.state().audioTracks[0].label).toBe('DE Audio 1');
    });

    it('keeps a newer persistent message when an older saved-message timer expires', async () => {
        controller.session.set(session({ recording: { active: true } }));
        controller.stopRecording.mockResolvedValue({
            active: false,
            targetPath: '/recordings/first.ts',
        });
        adapter.commands.toggleRecording();
        await flushPromises();
        expect(adapter.state().recording.message).toBe(
            'Saved to /recordings/first.ts'
        );

        controller.stopRecording.mockResolvedValue({
            active: false,
            error: 'Newer failure',
        });
        adapter.commands.toggleRecording();
        await flushPromises();
        expect(adapter.state().recording.message).toBe('Newer failure');

        jest.advanceTimersByTime(5000);
        expect(adapter.state().recording.message).toBe('Newer failure');
    });

    it('clears the elapsed interval when recording stops', () => {
        const clearIntervalSpy = jest.spyOn(window, 'clearInterval');
        controller.session.set(
            session({
                recording: {
                    active: true,
                    startedAt: '2026-07-16T10:00:00.000Z',
                },
            })
        );
        TestBed.tick();

        controller.session.set(session({ recording: { active: false } }));
        TestBed.tick();

        expect(clearIntervalSpy).toHaveBeenCalled();
        clearIntervalSpy.mockRestore();
    });

    it('clears message timers on destruction and prevents late mutation', async () => {
        const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
        controller.session.set(session({ recording: { active: true } }));
        controller.stopRecording.mockResolvedValue({
            active: false,
            targetPath: '/recordings/final.ts',
        });
        adapter.commands.toggleRecording();
        await flushPromises();

        const state = adapter.state;
        expect(state().recording.message).toBe('Saved to /recordings/final.ts');

        TestBed.resetTestingModule();
        expect(clearTimeoutSpy).toHaveBeenCalled();
        jest.advanceTimersByTime(5000);

        expect(state().recording.message).toBe('Saved to /recordings/final.ts');
        clearTimeoutSpy.mockRestore();
    });
});
