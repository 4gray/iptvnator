import { NgZone, signal } from '@angular/core';

// Mock the facade module: the wiring only reads the `Events` map (string event
// names) from it, so we provide that and nothing else — this keeps the real
// canvas/worker/WASM module out of the jsdom test environment.
jest.unstable_mockModule('ferrite.js', () => ({
    Events: {
        ERROR: 'error',
        MEDIA_INFO: 'media_info',
        TIME_UPDATE: 'ferrite_time_update',
        LOADING_COMPLETE: 'loading_complete',
        RECOVERED_EARLY_EOF: 'recovered_early_eof',
        DEINT_FAILED: 'ferrite_deint_failed',
    },
}));

type EventCallback = (...args: unknown[]) => void;

/** Minimal FerritePlayer stand-in: captures the callbacks registered via `.on`
 *  so the test can fire facade events synchronously and inspect the sinks. */
class FakeFerritePlayer {
    readonly handlers = new Map<string, EventCallback[]>();
    tier = 'software';
    duration = 0;
    mediaInfo: {
        width?: number;
        height?: number;
        videoCodec?: string;
        audioCodec?: string;
    } | null = null;

    on(event: string, cb: EventCallback): void {
        const list = this.handlers.get(event) ?? [];
        list.push(cb);
        this.handlers.set(event, list);
    }

    emit(event: string, ...args: unknown[]): void {
        for (const cb of this.handlers.get(event) ?? []) {
            cb(...args);
        }
    }
}

describe('wireFerriteEvents', () => {
    let wireFerriteEvents: typeof import('./ferrite-event-wiring').wireFerriteEvents;
    let player: FakeFerritePlayer;
    let zone: NgZone;
    let sinks: ReturnType<typeof createSinks>;
    let issues: unknown[];
    let timeUpdates: Array<{ currentTime: number; duration: number }>;
    let endedCount: number;

    beforeAll(async () => {
        ({ wireFerriteEvents } = await import('./ferrite-event-wiring'));
    });

    function createSinks() {
        issues = [];
        timeUpdates = [];
        endedCount = 0;
        return {
            zone,
            emitIssue: (d: unknown) => issues.push(d),
            emitTimeUpdate: (t: { currentTime: number; duration: number }) =>
                timeUpdates.push(t),
            emitEnded: () => {
                endedCount += 1;
            },
            status: signal(''),
            tier: signal(''),
            format: signal(''),
            clock: signal(''),
            dbgVisible: signal(false),
            deintFailed: signal(false),
        };
    }

    beforeEach(() => {
        // A plain zone whose `run` invokes its callback synchronously is enough
        // for the wiring (which only uses `zone.run` to re-enter for emission).
        zone = { run: (fn: () => unknown) => fn() } as unknown as NgZone;
        player = new FakeFerritePlayer();
        sinks = createSinks();
    });

    it('treats a fatal ERROR as a classified playback issue', () => {
        wireFerriteEvents(player as never, 'http://example.com/live.ts', sinks);

        player.emit('error', 'networkError', 'manifestLoadError', {
            fatal: true,
        });

        expect(sinks.status()).toContain('manifestLoadError');
        expect(issues).toHaveLength(1);
        expect(issues[0]).not.toBeNull();
    });

    it('swallows a non-fatal ERROR (recoverable reconnect) without emitting an issue', () => {
        wireFerriteEvents(player as never, 'http://example.com/live.ts', sinks);

        player.emit('error', 'networkError', 'EarlyEof', { fatal: false });

        expect(sinks.status()).toBe('reconnecting');
        expect(issues).toEqual([]);
    });

    it('treats a missing/undefined fatal flag as fatal', () => {
        wireFerriteEvents(player as never, 'http://example.com/live.ts', sinks);

        player.emit('error', 'mediaError', 'codecUnsupported', undefined);

        expect(issues).toHaveLength(1);
        expect(sinks.status()).toContain('codecUnsupported');
    });

    it('feeds tier/status/format from MEDIA_INFO', () => {
        player.tier = 'software';
        player.mediaInfo = {
            width: 1920,
            height: 1080,
            videoCodec: 'hevc',
            audioCodec: 'aac',
        };
        wireFerriteEvents(player as never, 'http://example.com/live.ts', sinks);

        player.emit('media_info');

        expect(sinks.tier()).toBe('software');
        expect(sinks.status()).toBe('playing');
        expect(sinks.format()).toBe('hevc 1920×1080 / aac');
    });

    it('throttles TIME_UPDATE and re-emits through the zone', () => {
        const nowSpy = jest.spyOn(performance, 'now');
        player.duration = 300;
        wireFerriteEvents(player as never, 'http://example.com/vod.ts', sinks);

        nowSpy.mockReturnValue(1000);
        player.emit('ferrite_time_update', 10);
        // Second update within the 250ms window is dropped.
        nowSpy.mockReturnValue(1100);
        player.emit('ferrite_time_update', 11);
        // Past the window → emitted again.
        nowSpy.mockReturnValue(1400);
        player.emit('ferrite_time_update', 12);

        expect(timeUpdates).toEqual([
            { currentTime: 10, duration: 300 },
            { currentTime: 12, duration: 300 },
        ]);

        nowSpy.mockRestore();
    });

    it('writes the panel clock only when the debug panel is visible', () => {
        const nowSpy = jest.spyOn(performance, 'now');
        sinks.dbgVisible.set(true);
        wireFerriteEvents(player as never, 'http://example.com/vod.ts', sinks);

        nowSpy.mockReturnValue(5000);
        player.emit('ferrite_time_update', 65);

        expect(sinks.clock()).toBe('1:05');
        nowSpy.mockRestore();
    });

    it('emits ended on LOADING_COMPLETE', () => {
        wireFerriteEvents(player as never, 'http://example.com/vod.ts', sinks);

        player.emit('loading_complete');

        expect(endedCount).toBe(1);
    });

    it('drives the deintFailed signal from DEINT_FAILED state', () => {
        wireFerriteEvents(player as never, 'http://example.com/live.ts', sinks);

        player.emit('ferrite_deint_failed', true);
        expect(sinks.deintFailed()).toBe(true);

        player.emit('ferrite_deint_failed', false);
        expect(sinks.deintFailed()).toBe(false);
    });

    it('clears the issue and resumes on RECOVERED_EARLY_EOF', () => {
        wireFerriteEvents(player as never, 'http://example.com/live.ts', sinks);

        player.emit('recovered_early_eof');

        expect(sinks.status()).toBe('playing');
        expect(issues).toEqual([null]);
    });
});
