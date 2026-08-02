import { VodSourceProbeCacheService } from './vod-source-probe-cache.service';

describe('VodSourceProbeCacheService', () => {
    let service: VodSourceProbeCacheService;

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-08-02T12:00:00Z'));
        service = new VodSourceProbeCacheService();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const stamped = (status: 'ok' | 'fail') => ({
        status,
        httpStatus: status === 'ok' ? 200 : 403,
        probedAt: new Date().toISOString(),
    });

    it('remembers settled verdicts and returns them while fresh', () => {
        service.store('p1:xtream:42', stamped('ok'));
        service.store('p2:xtream:43', stamped('fail'));

        expect(service.get('p1:xtream:42')?.status).toBe('ok');
        expect(service.get('p2:xtream:43')?.status).toBe('fail');
    });

    it('never remembers an inconclusive check', () => {
        // Caching "could not check" would suppress a retry that might work.
        service.store('p1:xtream:42', {
            status: 'unknown',
            probedAt: new Date().toISOString(),
        });
        service.store('p1:xtream:43', { status: 'probing' });
        // A verdict with no timestamp cannot be aged, so it is not stored.
        service.store('p1:xtream:44', { status: 'ok' });

        expect(service.get('p1:xtream:42')).toBeNull();
        expect(service.get('p1:xtream:43')).toBeNull();
        expect(service.get('p1:xtream:44')).toBeNull();
    });

    it('expires a verdict after the TTL', () => {
        service.store('p1:xtream:42', stamped('ok'));

        jest.advanceTimersByTime(9 * 60_000);
        expect(service.get('p1:xtream:42')?.status).toBe('ok');

        jest.advanceTimersByTime(2 * 60_000);
        expect(service.get('p1:xtream:42')).toBeNull();
    });
});
