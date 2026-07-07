import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import {
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EmbeddedMpvControlsAdapter } from './embedded-mpv-controls.adapter';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

type FakeController = {
    support: WritableSignal<EmbeddedMpvSupport | null>;
    session: WritableSignal<EmbeddedMpvSession | null>;
    stalled: WritableSignal<boolean>;
    togglePaused: jest.Mock;
    seekTo: jest.Mock;
    seekBy: jest.Mock;
    applyVolume: jest.Mock;
    setAudioTrack: jest.Mock;
    setSubtitleTrack: jest.Mock;
    setSpeed: jest.Mock;
    setAspect: jest.Mock;
    startRecording: jest.Mock;
    stopRecording: jest.Mock;
};

const baseSession = (
    overrides: Partial<EmbeddedMpvSession> = {}
): EmbeddedMpvSession => ({
    id: 'session-1',
    title: 'Movie',
    streamUrl: 'https://example.test/movie.mp4',
    status: 'playing',
    positionSeconds: 30,
    durationSeconds: 120,
    volume: 0.8,
    audioTracks: [],
    selectedAudioTrackId: null,
    subtitleTracks: [],
    selectedSubtitleTrackId: null,
    playbackSpeed: 1,
    aspectOverride: 'no',
    recording: { active: false },
    startedAt: '2026-06-06T12:00:00Z',
    updatedAt: '2026-06-06T12:00:00Z',
    ...overrides,
});

const supported = (
    overrides: Partial<EmbeddedMpvSupport> = {}
): EmbeddedMpvSupport => ({
    supported: true,
    platform: 'darwin',
    capabilities: {
        subtitles: true,
        playbackSpeed: true,
        aspectOverride: true,
        screenshot: false,
        recording: true,
    },
    ...overrides,
});

describe('EmbeddedMpvControlsAdapter', () => {
    let controller: FakeController;
    let adapter: EmbeddedMpvControlsAdapter;

    const vodPlayback: ResolvedPortalPlayback = {
        streamUrl: 'https://example.test/movie.mp4',
        title: 'Movie',
        contentInfo: {
            playlistId: 'p1',
            contentXtreamId: 5,
            contentType: 'movie',
        },
    };

    const livePlayback: ResolvedPortalPlayback = {
        streamUrl: 'https://example.test/live.ts',
        title: 'Channel',
        isLive: true,
    };

    beforeEach(() => {
        controller = {
            support: signal<EmbeddedMpvSupport | null>(supported()),
            session: signal<EmbeddedMpvSession | null>(baseSession()),
            stalled: signal(false),
            togglePaused: jest.fn().mockResolvedValue(undefined),
            seekTo: jest.fn().mockResolvedValue(undefined),
            seekBy: jest.fn().mockResolvedValue(true),
            applyVolume: jest.fn().mockResolvedValue(undefined),
            setAudioTrack: jest.fn().mockResolvedValue(undefined),
            setSubtitleTrack: jest.fn().mockResolvedValue(undefined),
            setSpeed: jest.fn().mockResolvedValue(undefined),
            setAspect: jest.fn().mockResolvedValue(undefined),
            startRecording: jest.fn(),
            stopRecording: jest.fn(),
        };

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
        translate.setTranslation('en', {
            EMBEDDED_MPV: {
                PLAYER: {
                    SAVED_TO: 'Saved to {{path}}',
                    RECORDING_FAILED_TO_STOP: 'Recording failed to stop.',
                    RECORDING_FAILED_TO_START: 'Recording failed to start.',
                    TRACK_DEFAULT: 'Default',
                    AUDIO_TRACK_FALLBACK: 'Audio {{index}}',
                    SUBTITLE_TRACK_FALLBACK: 'Subtitle {{index}}',
                },
            },
        });
        translate.use('en');
        adapter = TestBed.inject(EmbeddedMpvControlsAdapter);
        adapter.playback.set(vodPlayback);
    });

    it('maps capabilities from support + context', () => {
        adapter.seriesNavigation.set({
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        const caps = adapter.capabilities();
        expect(caps.seek).toBe(true);
        expect(caps.volume).toBe(true);
        expect(caps.audioTracks).toBe(true);
        expect(caps.fullscreen).toBe(true);
        expect(caps.subtitles).toBe(true);
        expect(caps.playbackSpeed).toBe(true);
        expect(caps.aspectRatio).toBe(true);
        expect(caps.recording).toBe(true);
        expect(caps.seriesNavigation).toBe(true);
    });

    it('disables series navigation for live playback', () => {
        adapter.playback.set(livePlayback);
        adapter.seriesNavigation.set({
            canPrevious: true,
            canNext: true,
            autoplayEnabled: true,
        });
        expect(adapter.capabilities().seriesNavigation).toBe(false);
        expect(adapter.state().isLive).toBe(true);
    });

    it('builds track lists with labels and reports canSeek/subtitlesEnabled', () => {
        controller.session.set(
            baseSession({
                audioTracks: [
                    { id: 1, language: 'eng', selected: true },
                    { id: 2, language: 'ger', selected: false },
                ],
                subtitleTracks: [{ id: 5, title: 'English', selected: true }],
                selectedSubtitleTrackId: 5,
            })
        );
        const state = adapter.state();
        expect(state.audioTracks[0].label).toContain('eng');
        expect(state.subtitleTracks[0].label).toBe('English');
        expect(state.subtitlesEnabled).toBe(true);
        expect(state.canSeek).toBe(true);
    });

    it('maps statuses including closed -> ended and missing session -> loading', () => {
        controller.session.set(baseSession({ status: 'closed' }));
        expect(adapter.state().status).toBe('ended');

        controller.session.set(null);
        expect(adapter.state().status).toBe('loading');

        controller.session.set(baseSession({ status: 'error', error: 'boom' }));
        expect(adapter.state().status).toBe('error');
        expect(adapter.state().statusMessage).toBe('boom');
    });

    it('delegates commands to the controller', () => {
        adapter.commands.togglePlay();
        adapter.commands.seekTo(42);
        adapter.commands.seekBy(-10);
        adapter.commands.setVolume(0.3);
        adapter.commands.setAudioTrack(2);
        adapter.commands.setSubtitleTrack(-1);
        adapter.commands.setPlaybackSpeed(1.5);
        adapter.commands.setAspectRatio('16:9');

        expect(controller.togglePaused).toHaveBeenCalled();
        expect(controller.seekTo).toHaveBeenCalledWith(42);
        expect(controller.seekBy).toHaveBeenCalledWith(-10);
        expect(controller.applyVolume).toHaveBeenCalledWith(0.3);
        expect(controller.setAudioTrack).toHaveBeenCalledWith(2);
        expect(controller.setSubtitleTrack).toHaveBeenCalledWith(-1);
        expect(controller.setSpeed).toHaveBeenCalledWith(1.5);
        expect(controller.setAspect).toHaveBeenCalledWith('16:9');
    });

    it('starts recording on live playback and surfaces a message on failure', async () => {
        adapter.playback.set(livePlayback);
        controller.session.set(baseSession({ status: 'playing' }));
        controller.startRecording.mockResolvedValue({
            active: false,
            error: 'no folder',
        });

        adapter.commands.toggleRecording();
        await Promise.resolve();
        await Promise.resolve();

        expect(controller.startRecording).toHaveBeenCalled();
        expect(adapter.state().recording.message).toBe('no folder');
    });

    it('stops recording and reports the saved path', async () => {
        adapter.playback.set(livePlayback);
        controller.session.set(
            baseSession({ recording: { active: true } })
        );
        controller.stopRecording.mockResolvedValue({
            active: false,
            targetPath: '/tmp/out.mkv',
        });

        adapter.commands.toggleRecording();
        await Promise.resolve();
        await Promise.resolve();

        expect(controller.stopRecording).toHaveBeenCalled();
        expect(adapter.state().recording.message).toBe('Saved to /tmp/out.mkv');
    });

    it('ignores recording toggles when the capability is off', async () => {
        adapter.playback.set(livePlayback);
        controller.support.set(
            supported({
                capabilities: {
                    subtitles: false,
                    playbackSpeed: false,
                    aspectOverride: false,
                    screenshot: false,
                    recording: false,
                },
            })
        );

        adapter.commands.toggleRecording();
        await Promise.resolve();

        expect(controller.startRecording).not.toHaveBeenCalled();
    });
});
