import { EpgProgram } from '@iptvnator/shared/interfaces';
import { XtreamGuideScheduleCache } from './xtream-guide-schedule-cache';

describe('XtreamGuideScheduleCache', () => {
    it('reuses an empty schedule briefly and requests it again after expiry', async () => {
        const cache = new XtreamGuideScheduleCache(jest.fn());
        const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
        const fetch = jest.fn(async () => []);
        try {
            await cache.load('1', () => undefined, fetch);
            clock.mockReturnValue(60_000);
            await cache.load('1', () => undefined, fetch);
            expect(fetch).toHaveBeenCalledTimes(1);
            clock.mockReturnValue(300_000);
            await cache.load('1', () => undefined, fetch);
            expect(fetch).toHaveBeenCalledTimes(2);
        } finally {
            clock.mockRestore();
        }
    });
    it('coalesces duplicate requests and limits provider work to two slots', async () => {
        const cache = new XtreamGuideScheduleCache(jest.fn());
        const finish: Array<(programs: EpgProgram[]) => void> = [];
        let onThirdStart!: () => void;
        const thirdStarted = new Promise<void>(
            (resolve) => (onThirdStart = resolve)
        );
        const fetch = jest.fn(
            () =>
                new Promise<EpgProgram[]>((resolve) => {
                    finish.push(resolve);
                    if (finish.length === 3) onThirdStart();
                })
        );
        const current = () => undefined;
        const first = cache.load('1', current, fetch);
        const duplicate = cache.load('1', current, fetch);
        const second = cache.load('2', current, fetch);
        const third = cache.load('3', current, fetch);
        expect(fetch).toHaveBeenCalledTimes(2);
        finish[0]([]);
        expect(await first).toEqual([]);
        expect(await duplicate).toEqual([]);
        expect(fetch).toHaveBeenCalledTimes(2);
        await thirdStarted;
        expect(fetch).toHaveBeenCalledTimes(3);
        finish[1]([]);
        finish[2]([]);
        await Promise.all([second, third]);
    });

    it('aborts stalled transport and queued work without delaying a new session', async () => {
        const cancelTransport = jest.fn();
        const cache = new XtreamGuideScheduleCache(cancelTransport);
        const pending = jest.fn<
            Promise<EpgProgram[]>,
            [{ signal: AbortSignal; sessionId?: string }]
        >(() => new Promise<EpgProgram[]>(() => undefined));
        const current = () => undefined;
        const first = cache.load('1', current, pending);
        const second = cache.load('2', current, pending);
        const queued = cache.load('3', current, pending);
        const oldResults = Promise.allSettled([first, second, queued]);
        expect(pending).toHaveBeenCalledTimes(2);
        const oldRequest = pending.mock.calls[0][0];

        cache.clear();
        expect(oldRequest.signal.aborted).toBe(true);
        expect(cancelTransport).toHaveBeenCalledWith(oldRequest.sessionId);
        await expect(cache.load('1', current, async () => [])).resolves.toEqual(
            []
        );
        expect(await oldResults).toEqual(
            Array.from({ length: 3 }, () =>
                expect.objectContaining({
                    status: 'rejected',
                    reason: expect.objectContaining({ name: 'AbortError' }),
                })
            )
        );
        expect(pending).toHaveBeenCalledTimes(2);
    });

    it('releases a slot only after all consumers of that request cancel', async () => {
        const cancelTransport = jest.fn();
        const cache = new XtreamGuideScheduleCache(cancelTransport);
        const pending = jest.fn<
            Promise<EpgProgram[]>,
            [{ signal: AbortSignal; sessionId?: string }]
        >(() => new Promise<EpgProgram[]>(() => undefined));
        const viewport = new AbortController();
        const search = new AbortController();
        const current = () => undefined;
        const viewportResult = expect(
            cache.load('1', current, pending, viewport.signal)
        ).rejects.toMatchObject({ name: 'AbortError' });
        const searchResult = expect(
            cache.load('1', current, pending, search.signal)
        ).rejects.toMatchObject({ name: 'AbortError' });
        const otherResult = expect(
            cache.load('2', current, pending)
        ).rejects.toMatchObject({ name: 'AbortError' });
        const fresh = jest.fn(async () => []);
        const queued = cache.load('3', current, fresh);
        const shared = pending.mock.calls[0][0];
        expect(pending).toHaveBeenCalledTimes(2);

        viewport.abort();
        await viewportResult;
        expect(shared.signal.aborted).toBe(false);
        expect(fresh).not.toHaveBeenCalled();

        search.abort();
        await searchResult;
        expect(shared.signal.aborted).toBe(true);
        expect(cancelTransport).toHaveBeenCalledWith(shared.sessionId);
        await expect(queued).resolves.toEqual([]);
        cache.clear();
        await otherResult;
    });
});
