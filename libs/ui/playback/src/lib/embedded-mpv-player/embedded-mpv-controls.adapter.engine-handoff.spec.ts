import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    EmbeddedMpvEngine,
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { TranslateModule } from '@ngx-translate/core';
import { EmbeddedMpvControlsAdapter } from './embedded-mpv-controls.adapter';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

const PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.test/live.ts',
    title: 'Live news',
    isLive: true,
};

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

function support(engine: EmbeddedMpvEngine): EmbeddedMpvSupport {
    return {
        supported: true,
        platform: 'darwin',
        engine,
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
        title: PLAYBACK.title,
        streamUrl: PLAYBACK.streamUrl,
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
        support: signal<EmbeddedMpvSupport | null>(support('frame-copy')),
        session: signal<EmbeddedMpvSession | null>(session()),
        stalled: signal(false),
        togglePaused: jest.fn().mockResolvedValue(undefined),
        seekTo: jest.fn().mockResolvedValue(undefined),
        seekBy: jest.fn().mockResolvedValue(true),
        applyVolume: jest.fn().mockResolvedValue(undefined),
        setAudioTrack: jest.fn().mockResolvedValue(undefined),
        setSubtitleTrack: jest.fn().mockResolvedValue(undefined),
        setSpeed: jest.fn().mockResolvedValue(undefined),
        setAspect: jest.fn().mockResolvedValue(undefined),
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

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('EmbeddedMpvControlsAdapter engine handoff', () => {
    afterEach(() => {
        TestBed.resetTestingModule();
        jest.useRealTimers();
    });

    it('cancels frame-copy recording work before a native session can reconcile it', async () => {
        jest.useFakeTimers();
        const controller = createController();
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
        const adapter = TestBed.inject(EmbeddedMpvControlsAdapter);
        adapter.configure({
            playback: signal(PLAYBACK),
            seriesNavigation: signal(null),
            recordingFolder: signal('/recordings'),
        });
        TestBed.tick();
        const command = deferred<EmbeddedMpvSession['recording'] | null>();
        controller.startRecording.mockReturnValueOnce(command.promise);

        adapter.commands.toggleRecording();
        expect(controller.startRecording).toHaveBeenCalledTimes(1);

        controller.support.set(support('native'));
        TestBed.tick();
        controller.session.set(
            session({
                recording: {
                    active: false,
                    error: 'Late native recording failure',
                },
            })
        );
        TestBed.tick();
        command.resolve({ active: false });
        await flushPromises();
        jest.advanceTimersByTime(5000);
        TestBed.tick();

        expect(adapter.state().recording.message).toBeNull();

        controller.session.set(session());
        controller.support.set(support('frame-copy'));
        TestBed.tick();
        adapter.commands.toggleRecording();

        expect(controller.startRecording).toHaveBeenCalledTimes(2);
    });
});
