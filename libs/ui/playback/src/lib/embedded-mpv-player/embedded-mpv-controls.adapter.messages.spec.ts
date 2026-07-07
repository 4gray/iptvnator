import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EmbeddedMpvControlsAdapter } from './embedded-mpv-controls.adapter';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

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

describe('EmbeddedMpvControlsAdapter (status messages & feedback)', () => {
    let support: WritableSignal<EmbeddedMpvSupport | null>;
    let session: WritableSignal<EmbeddedMpvSession | null>;
    let stopRecording: jest.Mock;
    let startRecording: jest.Mock;
    let adapter: EmbeddedMpvControlsAdapter;

    const livePlayback: ResolvedPortalPlayback = {
        streamUrl: 'https://example.test/live.ts',
        title: 'Channel',
        isLive: true,
    };

    const flush = async () => {
        await Promise.resolve();
        await Promise.resolve();
    };

    beforeEach(() => {
        support = signal<EmbeddedMpvSupport | null>({
            supported: true,
            platform: 'darwin',
            capabilities: {
                subtitles: true,
                playbackSpeed: true,
                aspectOverride: true,
                screenshot: false,
                recording: true,
            },
        });
        session = signal<EmbeddedMpvSession | null>(baseSession());
        stopRecording = jest.fn();
        startRecording = jest.fn();

        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                EmbeddedMpvControlsAdapter,
                {
                    provide: EmbeddedMpvSessionController,
                    useValue: {
                        support,
                        session,
                        stalled: signal(false),
                        togglePaused: jest.fn(),
                        seekTo: jest.fn(),
                        seekBy: jest.fn(),
                        applyVolume: jest.fn(),
                        setAudioTrack: jest.fn(),
                        setSubtitleTrack: jest.fn(),
                        setSpeed: jest.fn(),
                        setAspect: jest.fn(),
                        startRecording,
                        stopRecording,
                    },
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
                    CHECKING_SUPPORT: 'Checking support…',
                    NOT_AVAILABLE: 'Not available.',
                    LOADING_STREAM: 'Loading stream…',
                    PLAYBACK_FAILED: 'Playback failed.',
                },
            },
        });
        translate.use('en');
        adapter = TestBed.inject(EmbeddedMpvControlsAdapter);
        adapter.playback.set(livePlayback);
    });

    describe('track label fallbacks', () => {
        it('falls back to indexed labels and marks default tracks', () => {
            session.set(
                baseSession({
                    audioTracks: [
                        { id: 1, selected: true, defaultTrack: true },
                        { id: 2, selected: false },
                    ],
                    subtitleTracks: [{ id: 5, selected: false }],
                })
            );

            const state = adapter.state();
            expect(state.audioTracks[0].label).toBe('Audio 1 · Default');
            expect(state.audioTracks[1].label).toBe('Audio 2');
            expect(state.subtitleTracks[0].label).toBe('Subtitle 1');
        });
    });

    describe('status messages', () => {
        it('reports the support probe while support is unknown', () => {
            support.set(null);
            expect(adapter.state().status).toBe('loading');
            expect(adapter.state().statusMessage).toBe('Checking support…');
        });

        it('reports the unsupported reason (with fallback)', () => {
            support.set({ supported: false, platform: 'linux', reason: 'no libmpv' });
            expect(adapter.state().statusMessage).toBe('no libmpv');

            support.set({ supported: false, platform: 'linux' });
            expect(adapter.state().statusMessage).toBe('Not available.');
        });

        it('reports loading while the session spins up and clears when playing', () => {
            session.set(baseSession({ status: 'loading' }));
            expect(adapter.state().statusMessage).toBe('Loading stream…');

            session.set(baseSession({ status: 'playing' }));
            expect(adapter.state().statusMessage).toBe('');
        });

        it('falls back to a generic error message when the session has none', () => {
            session.set(baseSession({ status: 'error' }));
            expect(adapter.state().statusMessage).toBe('Playback failed.');
        });

        it('maps an unsupported idle state to idle status', () => {
            support.set({ supported: false, platform: 'linux' });
            session.set(null);
            expect(adapter.state().status).toBe('idle');
        });

        it('maps playing and paused session statuses one-to-one', () => {
            session.set(baseSession({ status: 'playing' }));
            expect(adapter.state().status).toBe('playing');

            session.set(baseSession({ status: 'paused' }));
            expect(adapter.state().status).toBe('paused');
        });

        it('re-localizes track fallback labels on language change', () => {
            session.set(
                baseSession({ audioTracks: [{ id: 1, selected: true }] })
            );
            expect(adapter.state().audioTracks[0].label).toBe('Audio 1');

            const translate = TestBed.inject(TranslateService);
            translate.setTranslation('de', {
                EMBEDDED_MPV: {
                    PLAYER: {
                        TRACK_DEFAULT: 'Standard',
                        AUDIO_TRACK_FALLBACK: 'Ton {{index}}',
                        SUBTITLE_TRACK_FALLBACK: 'Untertitel {{index}}',
                    },
                },
            });
            translate.use('de');
            expect(adapter.state().audioTracks[0].label).toBe('Ton 1');
        });
    });

    describe('recording feedback', () => {
        it('ignores toggles for non-live playback', async () => {
            adapter.playback.set({
                streamUrl: 'https://example.test/movie.mp4',
                title: 'Movie',
                isLive: false,
            });
            adapter.commands.toggleRecording();
            await flush();
            expect(startRecording).not.toHaveBeenCalled();
            expect(stopRecording).not.toHaveBeenCalled();
        });

        it('keeps quiet when recording starts successfully', async () => {
            startRecording.mockResolvedValue({ active: true });
            adapter.commands.toggleRecording();
            await flush();
            expect(adapter.state().recording.message).toBeNull();
        });

        it('reports a generic start failure without error details', async () => {
            startRecording.mockResolvedValue(null);
            adapter.commands.toggleRecording();
            await flush();
            expect(adapter.state().recording.message).toBe(
                'Recording failed to start.'
            );
        });

        it('reports stop errors and a generic stop failure', async () => {
            session.set(baseSession({ recording: { active: true } }));
            stopRecording.mockResolvedValue({ active: true, error: 'disk full' });
            adapter.commands.toggleRecording();
            await flush();
            expect(adapter.state().recording.message).toBe('disk full');

            stopRecording.mockResolvedValue(null);
            adapter.commands.toggleRecording();
            await flush();
            expect(adapter.state().recording.message).toBe(
                'Recording failed to stop.'
            );
        });

        it('auto-dismisses messages flagged with autoDismiss', () => {
            jest.useFakeTimers();
            adapter.setRecordingMessage('Saved to /tmp/x.mkv', {
                autoDismiss: true,
            });
            expect(adapter.state().recording.message).toBe(
                'Saved to /tmp/x.mkv'
            );

            jest.advanceTimersByTime(5_000);
            expect(adapter.state().recording.message).toBeNull();
            jest.useRealTimers();
        });

        it('a newer message survives the previous auto-dismiss timer', () => {
            jest.useFakeTimers();
            adapter.setRecordingMessage('first', { autoDismiss: true });
            jest.advanceTimersByTime(3_000);
            adapter.setRecordingMessage('second');

            jest.advanceTimersByTime(10_000);
            expect(adapter.state().recording.message).toBe('second');
            jest.useRealTimers();
        });

        it('derives elapsed seconds from startedAt and tolerates bad dates', () => {
            const startedAt = new Date(Date.now() - 65_000).toISOString();
            session.set(
                baseSession({ recording: { active: true, startedAt } })
            );
            expect(
                adapter.state().recording.elapsedSeconds
            ).toBeGreaterThanOrEqual(65);

            session.set(
                baseSession({
                    recording: { active: true, startedAt: 'not-a-date' },
                })
            );
            expect(adapter.state().recording.elapsedSeconds).toBe(0);
        });
    });

    describe('capability & volume fallbacks', () => {
        it('defaults optional capabilities off when support lists none', () => {
            support.set({ supported: true, platform: 'darwin' });
            const caps = adapter.capabilities();
            expect(caps.subtitles).toBe(false);
            expect(caps.playbackSpeed).toBe(false);
            expect(caps.aspectRatio).toBe(false);
            expect(caps.recording).toBe(false);
            // Baseline capabilities stay on.
            expect(caps.seek).toBe(true);
            expect(caps.volume).toBe(true);
        });

        it('falls back to the stored volume while no session exists', () => {
            localStorage.setItem('volume', '0.35');
            session.set(null);
            expect(adapter.state().volume).toBe(0.35);
            localStorage.removeItem('volume');
        });

        it('treats missing playback context as non-live', () => {
            adapter.playback.set(null);
            expect(adapter.state().isLive).toBe(false);
        });
    });
});
