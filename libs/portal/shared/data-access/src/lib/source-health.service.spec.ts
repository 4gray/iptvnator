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
    it.each([false, true])(
        'bounds queued explicit checks (promoted: %s)',
        async (promote) => {
            jest.useFakeTimers();
            try {
                probe.mockImplementation(() => new Promise(() => undefined));
                const blockers = ['a', 'b', 'c', 'd'].map((id) =>
                    service.check(playlist(id), { fresh: true })
                );
                const source = playlist('queued');
                const background = promote ? service.check(source) : undefined;
                const explicit = service.check(source, { fresh: true });
                expect(probe).toHaveBeenCalledTimes(4);
                await jest.advanceTimersByTimeAsync(15000);
                expect(await explicit).toMatchObject({ reason: 'timeout' });
                expect(probe).toHaveBeenCalledTimes(4);
                await Promise.all([...blockers, background]);
                expect(jest.getTimerCount()).toBe(0);
            } finally {
                jest.useRealTimers();
            }
        }
    );
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
    it.each(['edit', 'delete'])(
        'retires deferred retries after a committed %s',
        async (operation) => {
            probe.mockImplementation(() => new Promise(() => undefined));
            const source = playlist('a');
            const pending = service.check(source);
            const retry = service.check(source, { fresh: true });
            TestBed.inject(SourceHealthEvidenceService).connections.next({
                id: source._id,
                ...(operation === 'edit'
                    ? { playlist: { ...source, url: 'https://new.test/list' } }
                    : {}),
            });
            await Promise.all([pending, retry]);
            expect(probe).toHaveBeenCalledTimes(1);
            expect(service.get(source)).toBeUndefined();
            expect(window.electron.cancelSourceProbe).toHaveBeenCalled();
        }
    );
    it('returns newer account evidence to a caller waiting on an older probe', async () => {
        jest.useFakeTimers();
        try {
            let resolve!: (result: SourceHealthResult) => void;
            probe.mockImplementation(
                () =>
                    new Promise((r) => {
                        resolve = r;
                    })
            );
            const source = playlist('a');
            const pending = service.check(source);
            jest.advanceTimersByTime(10);
            TestBed.inject(SourceHealthEvidenceService).results.next({
                playlist: source,
                result: active,
            });
            resolve({
                state: 'expired',
                reason: 'expired',
                confirmedInactive: true,
            });
            expect(await pending).toMatchObject(active);
            expect(service.get(source)).toMatchObject(active);
        } finally {
            jest.useRealTimers();
        }
    });
    it('includes the background handoff in the explicit fifteen-second budget', async () => {
        jest.useFakeTimers();
        try {
            probe.mockImplementation(() => new Promise(() => undefined));
            const source = playlist('a');
            const start = Date.now();
            const background = service.check(source);
            const explicit = service.check(source, { fresh: true });
            await jest.advanceTimersByTimeAsync(5000);
            await background;
            expect(probe.mock.calls[1][1].deadlineAt).toBe(start + 15000);
            await jest.advanceTimersByTimeAsync(10000);
            expect(await explicit).toMatchObject({ reason: 'timeout' });
        } finally {
            jest.useRealTimers();
        }
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
