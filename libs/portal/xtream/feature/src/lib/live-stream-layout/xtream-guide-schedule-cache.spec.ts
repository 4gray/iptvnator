import { EpgProgram } from '@iptvnator/shared/interfaces';
import { XtreamGuideScheduleCache } from './xtream-guide-schedule-cache';

describe('XtreamGuideScheduleCache', () => {
    it('coalesces duplicate requests and limits provider work to two slots', async () => {
        const cache = new XtreamGuideScheduleCache();
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

    it('abandons queued work on cancellation and never reuses an old source response', async () => {
        const cache = new XtreamGuideScheduleCache();
        let finish!: (programs: EpgProgram[]) => void;
        const pending = () =>
            new Promise<EpgProgram[]>((resolve) => (finish = resolve));
        const signal = new AbortController();
        const first = cache.load('1', () => undefined, pending);
        const second = cache.load(
            '2',
            () => undefined,
            async () => []
        );
        const fetchThird = jest.fn(async () => []);
        const third = cache.load(
            '3',
            () => signal.signal.throwIfAborted(),
            fetchThird
        );
        const rejected = expect(third).rejects.toMatchObject({
            name: 'AbortError',
        });
        signal.abort();
        cache.clear();
        finish([]);
        await Promise.all([first, second]);
        await rejected;
        expect(fetchThird).not.toHaveBeenCalled();
        const fresh = jest.fn(async () => []);
        await cache.load('1', () => undefined, fresh);
        expect(fresh).toHaveBeenCalledTimes(1);
    });
});
