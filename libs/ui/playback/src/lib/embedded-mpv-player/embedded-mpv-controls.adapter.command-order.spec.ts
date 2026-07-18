import { signal } from '@angular/core';
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

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
}

type RecordingState = EmbeddedMpvSession['recording'] | null;

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
            .fn<Promise<RecordingState>, [string | undefined, string]>()
            .mockResolvedValue({ active: false }),
        stopRecording: jest
            .fn<Promise<RecordingState>, []>()
            .mockResolvedValue({ active: true }),
    };
}

function translations(): object {
    return {
        EMBEDDED_MPV: {
            PLAYER: {
                RECORDING_FAILED_TO_START: 'Failed to start recording',
                RECORDING_FAILED_TO_STOP: 'Failed to stop recording',
                SAVED_TO: 'Saved to {{path}}',
            },
        },
    };
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('EmbeddedMpvControlsAdapter command/session ordering', () => {
    let adapter: EmbeddedMpvControlsAdapter;
    let controller: ReturnType<typeof createController>;

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
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', translations());
        translate.setDefaultLang('en');
        translate.use('en');

        adapter = TestBed.inject(EmbeddedMpvControlsAdapter);
        adapter.configure({
            playback: signal(LIVE_PLAYBACK),
            seriesNavigation: signal(null),
            recordingFolder: signal('/recordings'),
        });
        TestBed.tick();
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        jest.useRealTimers();
    });

    it('accepts a start acknowledgement written immediately before command resolution', async () => {
        const startedRecording = {
            active: true,
            startedAt: '2026-07-16T10:00:02.000Z',
        };
        controller.startRecording.mockImplementation(async () => {
            controller.session.set(session({ recording: startedRecording }));
            return startedRecording;
        });
        controller.stopRecording.mockImplementation(async () => {
            const stoppedRecording = { active: false };
            controller.session.set(session({ recording: stoppedRecording }));
            return stoppedRecording;
        });
        adapter.commands.toggleRecording();
        await flushPromises();
        expect(adapter.state().recording.active).toBe(true);
        adapter.commands.toggleRecording();
        expect(controller.stopRecording).toHaveBeenCalledTimes(1);
        await flushPromises();
        jest.advanceTimersByTime(ACK_TIMEOUT_MS);
        expect(adapter.state().recording.message).toBeNull();
    });

    it('accepts a stop acknowledgement written immediately before command resolution', async () => {
        const targetPath = '/recordings/live.ts';
        const stoppedRecording = { active: false, targetPath };
        controller.session.set(
            session({
                recording: {
                    active: true,
                    targetPath,
                    startedAt: '2026-07-16T10:00:02.000Z',
                },
            })
        );
        controller.stopRecording.mockImplementation(async () => {
            controller.session.set(session({ recording: stoppedRecording }));
            return stoppedRecording;
        });
        controller.startRecording.mockImplementation(async () => {
            const startedRecording = {
                active: true,
                startedAt: '2026-07-16T10:00:03.000Z',
            };
            controller.session.set(session({ recording: startedRecording }));
            return startedRecording;
        });
        adapter.commands.toggleRecording();
        await flushPromises();
        expect(adapter.state().recording.message).toBe(
            `Saved to ${targetPath}`
        );
        adapter.commands.toggleRecording();
        expect(controller.startRecording).toHaveBeenCalledTimes(1);
        await flushPromises();
        jest.advanceTimersByTime(ACK_TIMEOUT_MS);
        expect(adapter.state().recording.message).toBeNull();
    });

    it.each(['start', 'stop'] as const)(
        'latches a buffered %s success through stale settlement',
        async (operation) => {
            const targetPath = '/recordings/live.ts';
            const baselineRecording =
                operation === 'start'
                    ? { active: false }
                    : {
                          active: true,
                          startedAt: '2026-07-16T10:00:02.000Z',
                      };
            const acknowledgedRecording =
                operation === 'start'
                    ? {
                          active: true,
                          targetPath,
                          startedAt: '2026-07-16T10:00:03.000Z',
                      }
                    : { active: false, targetPath };
            const command = deferred<RecordingState>();
            const lateCommand = deferred<RecordingState>();
            const successMessage =
                operation === 'stop' ? `Saved to ${targetPath}` : null;
            const failureMessage = `Failed to ${operation} recording`;
            const setRecording = (recording: RecordingState) =>
                controller.session.set(session({ recording }));
            const originalCommand =
                operation === 'start'
                    ? controller.startRecording
                    : controller.stopRecording;
            const inverseCommand =
                operation === 'start'
                    ? controller.stopRecording
                    : controller.startRecording;
            setRecording(baselineRecording);
            originalCommand
                .mockReturnValueOnce(command.promise)
                .mockReturnValueOnce(lateCommand.promise);
            inverseCommand.mockImplementation(async () => {
                setRecording(baselineRecording);
                return baselineRecording;
            });
            adapter.commands.toggleRecording();
            setRecording(acknowledgedRecording);
            jest.advanceTimersByTime(ACK_TIMEOUT_MS + 1);
            expect(adapter.state().recording.message).toBeNull();
            adapter.commands.toggleRecording();
            expect(originalCommand).toHaveBeenCalledTimes(1);
            expect(inverseCommand).not.toHaveBeenCalled();
            setRecording(baselineRecording);
            command.resolve(baselineRecording);
            await flushPromises();
            expect(adapter.state().recording.message).toBe(successMessage);
            adapter.commands.toggleRecording();
            expect(originalCommand).toHaveBeenCalledTimes(1);
            expect(inverseCommand).not.toHaveBeenCalled();
            setRecording(acknowledgedRecording);
            TestBed.tick();
            adapter.commands.toggleRecording();
            expect(originalCommand).toHaveBeenCalledTimes(1);
            expect(inverseCommand).toHaveBeenCalledTimes(1);
            await flushPromises();
            adapter.commands.toggleRecording();
            jest.advanceTimersByTime(ACK_TIMEOUT_MS);
            expect(adapter.state().recording.message).toBe(failureMessage);
            setRecording(acknowledgedRecording);
            TestBed.tick();
            expect(adapter.state().recording.message).toBe(successMessage);
            adapter.commands.toggleRecording();
            expect(originalCommand).toHaveBeenCalledTimes(2);
            expect(inverseCommand).toHaveBeenCalledTimes(1);
            setRecording(baselineRecording);
            lateCommand.resolve(baselineRecording);
            await flushPromises();
            adapter.commands.toggleRecording();
            expect(originalCommand).toHaveBeenCalledTimes(2);
            expect(inverseCommand).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(ACK_TIMEOUT_MS);
            expect(adapter.state().recording.message).toBe(failureMessage);
            adapter.commands.toggleRecording();
            expect(originalCommand).toHaveBeenCalledTimes(3);
            expect(inverseCommand).toHaveBeenCalledTimes(1);
        }
    );

    it('discards a stored acknowledgement when the session changes before settlement', async () => {
        const targetPath = '/recordings/live.ts';
        const command = deferred<EmbeddedMpvSession['recording'] | null>();
        controller.session.set(session({ recording: { active: true } }));
        controller.stopRecording.mockReturnValue(command.promise);
        adapter.commands.toggleRecording();
        controller.session.set(
            session({ recording: { active: false, targetPath } })
        );
        TestBed.tick();
        controller.session.set(
            session({ id: 'session-2', recording: { active: false } })
        );
        command.resolve({ active: true });
        await flushPromises();
        expect(adapter.state().recording.message).toBeNull();
    });

    it('shows a pre-settlement recording error without unlocking the command', async () => {
        const addonError = '  Addon rejected stream-record  ';
        const command = deferred<EmbeddedMpvSession['recording'] | null>();
        controller.startRecording.mockReturnValue(command.promise);

        adapter.commands.toggleRecording();
        controller.session.set(
            session({
                recording: { active: false, error: addonError },
            })
        );
        TestBed.tick();

        expect(adapter.state().recording.message).toBe(addonError);
        jest.advanceTimersByTime(ACK_TIMEOUT_MS + 1);
        expect(adapter.state().recording.message).toBe(addonError);
        adapter.commands.toggleRecording();
        expect(controller.startRecording).toHaveBeenCalledTimes(1);

        controller.session.set(session({ recording: { active: false } }));
        command.resolve({ active: false });
        await flushPromises();

        expect(adapter.state().recording.message).toBe(addonError);
        adapter.commands.toggleRecording();
        expect(controller.startRecording).toHaveBeenCalledTimes(2);
    });

    it('keeps an unacknowledged timed-out command serialized until its promise settles', async () => {
        const command = deferred<EmbeddedMpvSession['recording'] | null>();
        controller.startRecording.mockReturnValue(command.promise);

        adapter.commands.toggleRecording();
        jest.advanceTimersByTime(ACK_TIMEOUT_MS);

        expect(adapter.state().recording.message).toBe(
            'Failed to start recording'
        );
        adapter.commands.toggleRecording();
        expect(controller.startRecording).toHaveBeenCalledTimes(1);

        command.resolve({ active: false });
        await flushPromises();

        expect(adapter.state().recording.message).toBe(
            'Failed to start recording'
        );
        adapter.commands.toggleRecording();
        expect(controller.startRecording).toHaveBeenCalledTimes(2);
    });

    it('waits for a post-settlement acknowledgement when only baseline snapshots arrive', async () => {
        const command = deferred<EmbeddedMpvSession['recording'] | null>();
        controller.startRecording.mockReturnValue(command.promise);

        adapter.commands.toggleRecording();
        controller.session.set(session({ recording: { active: false } }));
        command.resolve({ active: false });
        await flushPromises();

        adapter.commands.toggleRecording();
        expect(controller.startRecording).toHaveBeenCalledTimes(1);

        controller.session.set(
            session({
                recording: {
                    active: true,
                    startedAt: '2026-07-16T10:00:03.000Z',
                },
            })
        );
        TestBed.tick();
        adapter.commands.toggleRecording();

        expect(controller.stopRecording).toHaveBeenCalledTimes(1);
    });
});
