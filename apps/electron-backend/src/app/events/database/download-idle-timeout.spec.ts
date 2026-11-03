import { once } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
    DOWNLOAD_IDLE_TIMEOUT_MS,
    watchDownloadInactivity,
} from './download-idle-timeout';

describe('download response inactivity watchdog', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('uses a 30 second idle limit', () => {
        expect(DOWNLOAD_IDLE_TIMEOUT_MS).toBe(30_000);
    });

    it('keeps receiving downloads alive beyond the idle interval and cleans up after completion', async () => {
        const readable = new PassThrough();
        watchDownloadInactivity(readable, 100);

        for (let chunk = 0; chunk < 5; chunk++) {
            jest.advanceTimersByTime(90);
            readable.write('movie bytes');
            expect(readable.destroyed).toBe(false);
        }
        const ended = once(readable, 'end');
        readable.end();
        jest.runAllTicks();
        await ended;

        expect(jest.getTimerCount()).toBe(0);
        expect(readable.listenerCount('data')).toBe(0);
    });

    it('destroys a silent response with the reconnectable ETIMEDOUT code', async () => {
        const readable = new PassThrough();
        const failure = once(readable, 'error');
        watchDownloadInactivity(readable, 100);

        jest.advanceTimersByTime(100);
        jest.runAllTicks();

        await expect(failure).resolves.toEqual([
            expect.objectContaining({ code: 'ETIMEDOUT' }),
        ]);
        expect(readable.destroyed).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('suspends the idle timer while paused and times out a silent reader after resume', async () => {
        const readable = new PassThrough();
        const failure = once(readable, 'error');
        const resumed = once(readable, 'resume');
        watchDownloadInactivity(readable, 100);
        jest.runAllTicks();
        await resumed;

        readable.pause();
        jest.advanceTimersByTime(500);
        expect(readable.destroyed).toBe(false);
        expect(jest.getTimerCount()).toBe(0);

        const resumedAgain = once(readable, 'resume');
        readable.resume();
        jest.runAllTicks();
        await resumedAgain;
        jest.advanceTimersByTime(99);
        expect(readable.destroyed).toBe(false);
        jest.advanceTimersByTime(1);
        jest.runAllTicks();

        await expect(failure).resolves.toEqual([
            expect.objectContaining({ code: 'ETIMEDOUT' }),
        ]);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('does not arm a timer on an already paused reader', () => {
        const readable = new PassThrough();
        readable.on('error', () => undefined);
        readable.pause();
        const stop = watchDownloadInactivity(readable, 100);

        jest.advanceTimersByTime(500);

        expect(readable.destroyed).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
        stop();
        readable.destroy();
    });

    it('does not arm a timer on an already destroyed reader', async () => {
        const readable = new PassThrough();
        const closed = once(readable, 'close');
        readable.destroy();
        jest.runAllTicks();
        await closed;

        const stop = watchDownloadInactivity(readable, 100);

        expect(jest.getTimerCount()).toBe(0);
        expect(readable.listenerCount('data')).toBe(0);
        stop();
    });

    it('lets a slow writable pause the source beyond the idle interval', async () => {
        jest.useRealTimers();
        const readable = Readable.from(['first', 'second']);
        const received: string[] = [];
        const paused = jest.fn();
        readable.on('pause', paused);
        const output = new Writable({
            highWaterMark: 1,
            write(chunk, _encoding, callback) {
                received.push(chunk.toString());
                setTimeout(callback, 80);
            },
        });
        const stop = watchDownloadInactivity(readable, 20);
        try {
            await pipeline(readable, output);
        } finally {
            stop();
        }

        expect(paused).toHaveBeenCalled();
        expect(received).toEqual(['first', 'second']);
        expect(readable.listenerCount('resume')).toBe(0);
    });

    it.each([undefined, new Error('Paused or canceled')])(
        'clears the timer and listeners when a response is destroyed (%s)',
        async (error) => {
            const readable = new PassThrough();
            readable.on('error', () => undefined);
            watchDownloadInactivity(readable, 100);
            const closed = new Promise<void>((resolve) =>
                readable.once('close', resolve)
            );

            readable.destroy(error);
            jest.runAllTicks();
            await closed;

            expect(jest.getTimerCount()).toBe(0);
            expect(readable.listenerCount('data')).toBe(0);
        }
    );

    it('can be stopped repeatedly when the pipeline settles', () => {
        const readable = new PassThrough();
        const stop = watchDownloadInactivity(readable, 100);

        stop();
        stop();
        jest.advanceTimersByTime(1000);

        expect(readable.destroyed).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
        expect(readable.listenerCount('data')).toBe(0);
        expect(readable.listenerCount('resume')).toBe(0);
        expect(readable.listenerCount('pause')).toBe(0);
        readable.destroy();
    });
});
