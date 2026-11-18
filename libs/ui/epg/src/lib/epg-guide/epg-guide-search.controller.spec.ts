import { EpgGuideSearchHit } from './epg-guide-source';
import { EpgGuideSearchController } from './epg-guide-search.controller';

describe('EpgGuideSearchController', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('publishes matches and progress while the provider is still scanning', async () => {
        const match: EpgGuideSearchHit = {
            channelId: 'synthetic',
            program: {
                channel: 'synthetic',
                title: 'Synthetic Programme',
                start: '2026-11-10T10:00:00Z',
                stop: '2026-11-10T11:00:00Z',
                desc: null,
                category: null,
            },
        };
        let finish!: (hits: EpgGuideSearchHit[]) => void;
        const controller = new EpgGuideSearchController((...[, , report]) => {
            report({ matches: [match], checked: 1, total: 4000 });
            return new Promise((resolve) => (finish = resolve));
        });
        controller.setQuery('sample');
        await jest.advanceTimersByTimeAsync(300);
        expect(controller.results()).toEqual([match]);
        expect(controller.progress()).toEqual({ checked: 1, total: 4000 });
        expect(controller.status()).toBe('loading');
        finish([match]);
        await Promise.resolve();
        expect(controller.status()).toBe('idle');
        expect(controller.progress()).toBeNull();
        controller.destroy();
    });

    it('cancels superseded and destroyed searches, including when the same term is typed again', async () => {
        const complete: Array<(hits: EpgGuideSearchHit[]) => void> = [];
        const signals: AbortSignal[] = [];
        const controller = new EpgGuideSearchController((_term, signal) => {
            signals.push(signal);
            return new Promise((resolve) => complete.push(resolve));
        });
        controller.setQuery('sample');
        await jest.advanceTimersByTimeAsync(300);
        controller.setQuery('another');
        controller.setQuery('sample');
        await jest.advanceTimersByTimeAsync(300);
        expect(signals[0].aborted).toBe(true);
        complete[0]([]);
        await Promise.resolve();
        expect(controller.status()).toBe('loading');
        controller.destroy();
        expect(signals[1].aborted).toBe(true);
        complete[1]([]);
        await Promise.resolve();
        expect(controller.results()).toEqual([]);
    });

    it('distinguishes a failed provider search from a successful search with no results', async () => {
        const search = jest
            .fn<Promise<EpgGuideSearchHit[]>, unknown[]>()
            .mockRejectedValue(new Error('synthetic outage'));
        const controller = new EpgGuideSearchController(search);
        controller.setQuery('sample');
        await jest.advanceTimersByTimeAsync(300);
        expect(controller.status()).toBe('error');
        search.mockResolvedValue([]);
        controller.setQuery('sample');
        await jest.advanceTimersByTimeAsync(300);
        expect(controller.status()).toBe('idle');
        expect(controller.results()).toEqual([]);
        controller.destroy();
    });
});
