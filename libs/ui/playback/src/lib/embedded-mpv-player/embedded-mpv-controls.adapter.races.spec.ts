import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EmbeddedMpvControlsAdapter } from './embedded-mpv-controls.adapter';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

const ACK_TIMEOUT_MS = 5000;
const LIVE_PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/live',
    title: 'Live news',
    isLive: true,
};
const REPLACEMENT_PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/replacement',
    title: 'Replacement news',
    isLive: true,
};

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

function support(): EmbeddedMpvSupport {
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
        audioTracks: [],
        selectedAudioTrackId: null,
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
        support: signal<EmbeddedMpvSupport | null>(support()),
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
            .mockResolvedValue({ active: false }),
        stopRecording: jest
            .fn<Promise<EmbeddedMpvSession['recording'] | null>, []>()
            .mockResolvedValue({ active: true }),
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

describe('EmbeddedMpvControlsAdapter recording acknowledgement races', () => {
    let adapter: EmbeddedMpvControlsAdapter;
    let controller: ReturnType<typeof createController>;
    let translate: TranslateService;
    let playback: WritableSignal<ResolvedPortalPlayback>;

    beforeEach(() => {
        jest.useFakeTimers();
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
        adapter.configure({
            playback,
            seriesNavigation: signal(null),
            recordingFolder: signal('/recordings'),
        });
        TestBed.tick();
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        jest.useRealTimers();
    });

    it('waits for a same-session active transition instead of trusting a stale start result', async () => {
        controller.startRecording.mockImplementation(async () => {
            const staleRecording = {
                active: false,
            };
            controller.session.set(session({ recording: staleRecording }));
            return staleRecording;
        });

        adapter.commands.toggleRecording();
        await flushPromises();
        TestBed.tick();

        expect(controller.startRecording).toHaveBeenCalledWith(
            '/recordings',
            LIVE_PLAYBACK.title
        );
        expect(adapter.state().recording.message).toBeNull();
        controller.session.update((current) => ({
            ...(current ?? session()),
            positionSeconds: 1,
            updatedAt: '2026-07-16T10:00:02.000Z',
        }));
        TestBed.tick();
        controller.session.set(
            session({
                recording: {
                    active: true,
                    targetPath: '/recordings/live.ts',
                    startedAt: '2026-07-16T10:00:02.000Z',
                },
            })
        );
        TestBed.tick();
        jest.advanceTimersByTime(ACK_TIMEOUT_MS);

        expect(adapter.state().recording.active).toBe(true);
        expect(adapter.state().recording.message).toBeNull();
    });

    it('waits for an inactive transition before reporting a saved stop', async () => {
        const targetPath = '/recordings/live.ts';
        controller.session.set(
            session({
                recording: {
                    active: true,
                    targetPath,
                    startedAt: '2026-07-16T10:00:02.000Z',
                },
            })
        );
        controller.stopRecording.mockResolvedValue({
            active: true,
            targetPath,
        });

        adapter.commands.toggleRecording();
        await flushPromises();
        expect(adapter.state().recording.message).toBeNull();

        controller.session.set(
            session({ recording: { active: false, targetPath } })
        );
        TestBed.tick();

        expect(adapter.state().recording.message).toBe(
            `Saved to ${targetPath}`
        );
        jest.advanceTimersByTime(ACK_TIMEOUT_MS - 1);
        expect(adapter.state().recording.message).toBe(
            `Saved to ${targetPath}`
        );
        jest.advanceTimersByTime(1);
        expect(adapter.state().recording.message).toBeNull();
    });

    it('uses a same-session recording error present at command settlement', async () => {
        const addonError = '  Addon rejected stream-record  ';
        controller.startRecording.mockImplementation(async () => {
            const failedRecording = { active: false, error: addonError };
            controller.session.set(session({ recording: failedRecording }));
            return failedRecording;
        });
        adapter.commands.toggleRecording();
        await flushPromises();

        expect(adapter.state().recording.message).toBe(addonError);
        translate.setTranslation('en', translations('Updated '));
        expect(adapter.state().recording.message).toBe(addonError);
    });

    it('reports the same addon error again when a retry times out', async () => {
        const addonError = 'Disk is still full';
        controller.session.set(
            session({ recording: { active: false, error: addonError } })
        );
        adapter.commands.toggleRecording();
        await flushPromises();
        controller.session.set(
            session({
                updatedAt: '2026-07-16T10:00:03.000Z',
                recording: { active: false, error: addonError },
            })
        );
        TestBed.tick();
        jest.advanceTimersByTime(ACK_TIMEOUT_MS);

        expect(adapter.state().recording.message).toBe(addonError);
    });

    it('serializes two immediate start toggles while acknowledgement is pending', async () => {
        const command = deferred<EmbeddedMpvSession['recording'] | null>();
        controller.startRecording.mockReturnValue(command.promise);

        adapter.commands.toggleRecording();
        adapter.commands.toggleRecording();
        expect(controller.startRecording).toHaveBeenCalledTimes(1);
        command.resolve({ active: false });
        await flushPromises();
    });

    it('serializes two immediate stop toggles while acknowledgement is pending', async () => {
        controller.session.set(
            session({
                recording: {
                    active: true,
                    targetPath: '/recordings/live.ts',
                },
            })
        );
        const command = deferred<EmbeddedMpvSession['recording'] | null>();
        controller.stopRecording.mockReturnValue(command.promise);

        adapter.commands.toggleRecording();
        adapter.commands.toggleRecording();
        expect(controller.stopRecording).toHaveBeenCalledTimes(1);
        command.resolve({ active: true });
        await flushPromises();
    });

    it.each(['playback', 'session'] as const)(
        'invalidates a pending result after %s identity replacement',
        async (replacement) => {
            const command = deferred<EmbeddedMpvSession['recording'] | null>();
            controller.startRecording.mockReturnValue(command.promise);
            adapter.commands.toggleRecording();

            if (replacement === 'playback') {
                playback.set(REPLACEMENT_PLAYBACK);
            } else {
                controller.session.set(
                    session({
                        id: 'session-2',
                        streamUrl: REPLACEMENT_PLAYBACK.streamUrl,
                    })
                );
            }
            TestBed.tick();
            command.resolve(null);
            await flushPromises();
            jest.advanceTimersByTime(ACK_TIMEOUT_MS);
            expect(adapter.state().recording.message).toBeNull();
        }
    );

    it.each(['playback', 'session'] as const)(
        'clears recording feedback after %s identity changes',
        async (replacement) => {
            adapter.commands.toggleRecording();
            await flushPromises();
            controller.session.set(
                session({
                    recording: {
                        active: false,
                        error: 'Current channel failure',
                    },
                })
            );
            TestBed.tick();
            expect(adapter.state().recording.message).toBe(
                'Current channel failure'
            );

            if (replacement === 'playback') {
                playback.set(REPLACEMENT_PLAYBACK);
            } else {
                controller.session.set(session({ id: 'session-2' }));
            }
            TestBed.tick();

            expect(adapter.state().recording.message).toBeNull();
        }
    );

    it.each(['start', 'stop'] as const)(
        'ignores a deferred %s result after destruction',
        async (operation) => {
            const command = deferred<EmbeddedMpvSession['recording'] | null>();
            if (operation === 'start') {
                controller.startRecording.mockReturnValue(command.promise);
            } else {
                controller.session.set(
                    session({ recording: { active: true } })
                );
                controller.stopRecording.mockReturnValue(command.promise);
            }
            adapter.commands.toggleRecording();
            const state = adapter.state;

            TestBed.resetTestingModule();
            command.resolve(null);
            await flushPromises();
            jest.advanceTimersByTime(ACK_TIMEOUT_MS);
            expect(state().recording.message).toBeNull();
        }
    );
});
