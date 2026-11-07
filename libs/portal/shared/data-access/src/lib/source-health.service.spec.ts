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
    title: id,
    count: 0,
    importDate: '2026-01-01T00:00:00.000Z',
    autoRefresh: false,
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
                expect(service.get(source)).toMatchObject({
                    reason: 'unknown',
                });
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
    it.each([0, 10])(
        'preserves newer evidence published %i ms after a probe starts',
        async (elapsed) => {
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
                jest.advanceTimersByTime(elapsed);
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
        }
    );
    it('includes the background handoff in the explicit fifteen-second budget', async () => {
        jest.useFakeTimers();
        try {
            let resolveBackground!: (r: SourceHealthResult) => void;
            probe
                .mockImplementationOnce(
                    () =>
                        new Promise((r) => {
                            resolveBackground = r;
                        })
                )
                .mockImplementation(() => new Promise(() => undefined));
            const source = playlist('a');
            const start = Date.now();
            const background = service.check(source);
            const explicit = service.check(source, { fresh: true });
            await jest.advanceTimersByTimeAsync(2000);
            resolveBackground(active);
            await background;
            await jest.advanceTimersByTimeAsync(0);
            expect(probe.mock.calls[1][1].deadlineAt).toBe(start + 15000);
            await jest.advanceTimersByTimeAsync(13000);
            expect(await explicit).toMatchObject({ reason: 'timeout' });
        } finally {
            jest.useRealTimers();
        }
    });
    it('retries a background timeout with the explicit budget before reporting it', async () => {
        jest.useFakeTimers();
        try {
            let resolveRetry!: (r: SourceHealthResult) => void;
            probe
                .mockImplementationOnce(() => new Promise(() => undefined))
                .mockImplementationOnce(
                    () =>
                        new Promise((r) => {
                            resolveRetry = r;
                        })
                );
            const source = playlist('slow');
            const start = Date.now();
            const check = service.check(source);
            await jest.advanceTimersByTimeAsync(5000);
            // The first attempt is cancelled, but no timeout is published.
            expect(probe.mock.calls[0][2].aborted).toBe(true);
            expect(window.electron.cancelSourceProbe).toHaveBeenCalledWith(
                probe.mock.calls[0][1].requestId
            );
            expect(service.get(source)?.state).toBe('checking');
            expect(probe.mock.calls[1][1].deadlineAt).toBe(start + 20000);
            expect(probe.mock.calls[1][1].requestId).not.toBe(
                probe.mock.calls[0][1].requestId
            );
            await jest.advanceTimersByTimeAsync(4000);
            resolveRetry(active);
            expect(await check).toMatchObject(active);
            expect(service.get(source)).toMatchObject(active);
        } finally {
            jest.useRealTimers();
        }
    });
    it('reports a source timeout after one failed background retry', async () => {
        jest.useFakeTimers();
        try {
            probe.mockImplementation(() => new Promise(() => undefined));
            const source = playlist('stalled');
            const result = service.check(source);
            await jest.advanceTimersByTimeAsync(19999);
            expect(service.get(source)?.state).toBe('checking');

            await jest.advanceTimersByTimeAsync(1);
            expect(await result).toMatchObject({ reason: 'timeout' });
            expect(service.get(source)).toMatchObject({ reason: 'timeout' });
            expect(probe).toHaveBeenCalledTimes(2);
            expect(probe.mock.calls[1][2].aborted).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });
    it('keeps a waiting Retry alive when its background surface closes', async () => {
        jest.useFakeTimers();
        try {
            probe
                .mockImplementationOnce(() => new Promise(() => undefined))
                .mockResolvedValueOnce(active);
            const source = playlist('slow');
            const surface = new AbortController();
            const background = service.check(source, {
                signal: surface.signal,
            });
            const retry = service.check(source, { fresh: true });
            surface.abort();

            await jest.advanceTimersByTimeAsync(5000);
            expect(await retry).toMatchObject(active);
            expect(await background).toMatchObject(active);
            expect(probe).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });
    it('cancels the current attempt when the last waiting Retry leaves', async () => {
        jest.useFakeTimers();
        try {
            probe.mockImplementation(() => new Promise(() => undefined));
            const source = playlist('slow');
            const surface = new AbortController();
            const dialog = new AbortController();
            const background = service.check(source, {
                signal: surface.signal,
            });
            const retry = service.check(source, {
                fresh: true,
                signal: dialog.signal,
            });
            await jest.advanceTimersByTimeAsync(5000);
            expect(probe).toHaveBeenCalledTimes(2);
            surface.abort();
            expect(probe.mock.calls[1][2].aborted).toBe(false);
            dialog.abort();

            expect(await retry).toMatchObject({ reason: 'cancelled' });
            expect(await background).toMatchObject({ reason: 'cancelled' });
            expect(probe.mock.calls[1][2].aborted).toBe(true);
            expect(window.electron.cancelSourceProbe).toHaveBeenCalledWith(
                probe.mock.calls[1][1].requestId
            );
        } finally {
            jest.useRealTimers();
        }
    });
    it('keeps the manual deadline without cutting off a shared background retry', async () => {
        jest.useFakeTimers();
        try {
            probe
                .mockImplementationOnce(() => new Promise(() => undefined))
                .mockImplementationOnce(
                    () =>
                        new Promise((resolve) =>
                            setTimeout(() => resolve(active), 12000)
                        )
                );
            const source = playlist('slow');
            const background = service.check(source);
            const done = jest.fn();
            void service.check(source, { fresh: true }).then(done);

            await jest.advanceTimersByTimeAsync(15000);
            expect(done).toHaveBeenCalledWith(
                expect.objectContaining({ reason: 'timeout' })
            );
            expect(service.get(source)?.state).toBe('checking');
            expect(probe.mock.calls[1][2].aborted).toBe(false);
            await jest.advanceTimersByTimeAsync(2000);
            expect(await background).toMatchObject(active);
            expect(probe).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });
    it('publishes the deadline result if Retry is the last consumer of a stalled probe', async () => {
        jest.useFakeTimers();
        try {
            probe.mockImplementation(() => new Promise(() => undefined));
            const source = playlist('slow');
            const surface = new AbortController();
            const background = service.check(source, {
                signal: surface.signal,
            });
            const retry = service.check(source, { fresh: true });
            surface.abort();

            await jest.advanceTimersByTimeAsync(15000);
            expect(await retry).toMatchObject({ reason: 'timeout' });
            expect(service.get(source)).toMatchObject({ reason: 'timeout' });
            expect(probe).toHaveBeenCalledTimes(2);
            expect(probe.mock.calls[1][2].aborted).toBe(true);
            await background;
        } finally {
            jest.useRealTimers();
        }
    });
    it('runs a queued manual check ahead of passive retries', async () => {
        jest.useFakeTimers();
        try {
            const healthy = playlist('healthy');
            probe.mockImplementation((source: PlaylistMeta) =>
                source._id === healthy._id
                    ? Promise.resolve(active)
                    : new Promise(() => undefined)
            );
            const stalled = ['a', 'b', 'c', 'd'].map((id) => playlist(id));
            const pending = stalled.map((source) => service.check(source));
            await jest.advanceTimersByTimeAsync(1000);
            const manual = service.check(healthy, { fresh: true });

            await jest.advanceTimersByTimeAsync(4000);
            expect(probe.mock.calls[4][0]).toEqual(healthy);
            expect(await manual).toMatchObject(active);
            stalled.forEach((source) => service.invalidate(source._id));
            await Promise.all(pending);
        } finally {
            jest.useRealTimers();
        }
    });
    it('skips a queued background retry when newer account evidence arrives', async () => {
        jest.useFakeTimers();
        try {
            probe.mockImplementation(() => new Promise(() => undefined));
            const sources = ['slow', 'other', 'queued', 'queued-next'].map(
                (id) => ({
                    ...playlist(id, 'shared'),
                    url: `https://shared.test/${id}`,
                })
            );
            const [slow, other, queued, queuedNext] = sources;
            const pending = sources.map((source) => service.check(source));

            await jest.advanceTimersByTimeAsync(5000);
            expect(probe.mock.calls[2][0]).toEqual(queued);
            TestBed.inject(SourceHealthEvidenceService).results.next({
                playlist: slow,
                result: active,
            });
            service.invalidate(queued._id);
            await jest.advanceTimersByTimeAsync(0);
            expect(await pending[0]).toMatchObject(active);
            expect(
                probe.mock.calls.filter(([source]) => source._id === slow._id)
            ).toHaveLength(1);
            [other, queuedNext].forEach((source) =>
                service.invalidate(source._id)
            );
            await Promise.all(pending);
        } finally {
            jest.useRealTimers();
        }
    });

    it('bounds a stalled probe and cancels its transport at the total deadline', async () => {
        jest.useFakeTimers();
        try {
            probe.mockImplementation(() => new Promise(() => undefined));
            const check = service.check(playlist('slow'), { fresh: true });
            jest.advanceTimersByTime(15000);
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
