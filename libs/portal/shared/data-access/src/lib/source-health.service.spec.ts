import { TestBed } from '@angular/core/testing';
import {
    RuntimeCapabilitiesService,
    SourceHealthEvidenceService,
} from '@iptvnator/services';
import { PlaylistMeta, SourceHealthResult } from '@iptvnator/shared/interfaces';
import { SourceHealthService } from './source-health.service';
import { SourceHealthProbesService } from './source-health-probes.service';
const active: SourceHealthResult = {
    state: 'active',
    reason: 'available',
    confirmedInactive: false,
};
const playlist = (id: string, host = id): PlaylistMeta => ({
    _id: id,
    url: `https://${host}.test/list`,
});

describe('SourceHealthService', () => {
    let service: SourceHealthService;
    let probe: jest.Mock;
    beforeEach(() => {
        probe = jest.fn().mockResolvedValue(active);
        TestBed.configureTestingModule({
            providers: [
                SourceHealthService,
                SourceHealthEvidenceService,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsSourceHealth: true },
                },
                {
                    provide: SourceHealthProbesService,
                    useValue: { check: probe },
                },
            ],
        });
        window.electron = {
            cancelSourceProbe: jest.fn().mockResolvedValue(undefined),
        } as unknown as typeof window.electron;
        service = TestBed.inject(SourceHealthService);
    });
    it('deduplicates both surfaces and serves the cached result', async () => {
        await Promise.all([
            service.check(playlist('a')),
            service.check(playlist('a')),
        ]);
        await service.check(playlist('a'));
        expect(probe).toHaveBeenCalledTimes(1);
    });
    it('limits concurrent probes and updates fast sources independently', async () => {
        const resolve: Array<(r: SourceHealthResult) => void> = [];
        probe.mockImplementation(() => new Promise((r) => resolve.push(r)));
        const checks = ['a', 'b', 'c', 'd', 'e'].map((id) =>
            service.check(playlist(id))
        );
        expect(probe).toHaveBeenCalledTimes(4);
        resolve[1](active);
        await checks[1];
        expect(service.get(playlist('b'))?.state).toBe('active');
        expect(service.get(playlist('a'))?.state).toBe('checking');
        expect(probe).toHaveBeenCalledTimes(5);
        resolve.forEach((r) => r(active));
        await Promise.all(checks);
    });
    it('limits same-origin concurrency to two', async () => {
        probe.mockImplementation(() => new Promise(() => undefined));
        for (const id of ['a', 'b', 'c'])
            void service.check({ ...playlist(id, 'shared'), userAgent: id });
        expect(probe).toHaveBeenCalledTimes(2);
        ['a', 'b', 'c'].forEach((id) => service.invalidate(id));
        await Promise.resolve();
    });
    it('does not cancel another consumer when a menu closes', async () => {
        let resolve!: (r: SourceHealthResult) => void;
        probe.mockImplementation(
            () =>
                new Promise((r) => {
                    resolve = r;
                })
        );
        const controller = new AbortController();
        const a = service.check(playlist('a'), { signal: controller.signal });
        const b = service.check(playlist('a'));
        controller.abort();
        expect(window.electron.cancelSourceProbe).not.toHaveBeenCalled();
        resolve(active);
        await Promise.all([a, b]);
    });
    it('invalidates a pending response after deletion', async () => {
        let resolve!: (r: SourceHealthResult) => void;
        probe.mockImplementation(
            () =>
                new Promise((r) => {
                    resolve = r;
                })
        );
        const check = service.check(playlist('a'));
        service.invalidate('a');
        resolve(active);
        await check;
        expect(service.get(playlist('a'))).toBeUndefined();
    });
    it('bounds a stalled probe and cancels its transport at the total deadline', async () => {
        jest.useFakeTimers();
        try {
            probe.mockImplementation(() => new Promise(() => undefined));
            const check = service.check(playlist('slow'));
            jest.advanceTimersByTime(5000);
            expect(await check).toMatchObject({
                reason: 'timeout',
                confirmedInactive: false,
            });
            expect(probe.mock.calls[0][2].aborted).toBe(true);
            expect(window.electron.cancelSourceProbe).toHaveBeenCalledWith(
                probe.mock.calls[0][1].requestId
            );
        } finally {
            jest.useRealTimers();
        }
    });
    it('uses a longer deadline for explicit checks and bypasses cached results', async () => {
        await service.check(playlist('a'));
        await service.check(playlist('a'), { fresh: true });
        expect(probe).toHaveBeenCalledTimes(2);
        expect(probe.mock.calls[1][1].deadlineAt - Date.now()).toBeGreaterThan(
            14000
        );
    });
});
