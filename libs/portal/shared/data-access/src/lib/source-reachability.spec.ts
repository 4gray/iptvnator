import {
    nextSourceHealthHistory,
    sourceReachabilityFromHealth,
    sourceReachabilityFromPortalStatus,
    sourceStatusBucket,
} from './source-reachability';

describe('source reachability', () => {
    it.each([
        [{ state: 'active', reason: 'available' }, 'ok'],
        [{ state: 'expired', reason: 'expired' }, 'expired'],
        [{ state: 'inactive', reason: 'disabled' }, 'bad'],
        [{ state: 'inactive', reason: 'auth' }, 'bad'],
        [{ state: 'checking', reason: 'unknown' }, 'checking'],
        [{ state: 'unavailable', reason: 'network' }, 'bad'],
        [{ state: 'unavailable', reason: 'timeout' }, 'bad'],
        [{ state: 'unavailable', reason: 'http' }, 'bad'],
        [{ state: 'unavailable', reason: 'invalid' }, 'bad'],
        // Checks that never reached the source say nothing about it.
        [{ state: 'unavailable', reason: 'paused' }, 'unknown'],
        [{ state: 'unavailable', reason: 'cancelled' }, 'unknown'],
        [{ state: 'unavailable', reason: 'unknown' }, 'unknown'],
        [{ state: 'unknown', reason: 'unknown' }, 'unknown'],
    ] as const)('maps %o to %s', (snapshot, expected) => {
        expect(sourceReachabilityFromHealth(snapshot)).toBe(expected);
    });

    it('treats a source without a snapshot as never checked', () => {
        expect(sourceReachabilityFromHealth(undefined)).toBe('unknown');
    });

    it.each([
        ['active', 'ok'],
        ['expired', 'expired'],
        ['inactive', 'bad'],
        ['unavailable', 'bad'],
        ['checking', 'checking'],
    ] as const)('maps the portal status %s to %s', (status, expected) => {
        expect(sourceReachabilityFromPortalStatus(status)).toBe(expected);
    });

    it('files expired accounts with the sources that do not respond', () => {
        expect(sourceStatusBucket('ok')).toBe('ok');
        expect(sourceStatusBucket('bad')).toBe('bad');
        expect(sourceStatusBucket('expired')).toBe('bad');
        expect(sourceStatusBucket('checking')).toBeNull();
        expect(sourceStatusBucket('unknown')).toBeNull();
    });
});

describe('nextSourceHealthHistory', () => {
    it('starts a failing run at the first failed check', () => {
        expect(nextSourceHealthHistory(undefined, 'bad', 100)).toEqual({
            state: 'bad',
            checkedAt: 100,
            failingSince: 100,
        });
    });

    it('keeps the start of the run across later failures', () => {
        const first = nextSourceHealthHistory(
            { state: 'ok', checkedAt: 50, lastSuccessAt: 50 },
            'bad',
            100
        );
        const second = nextSourceHealthHistory(first, 'expired', 400);
        expect(second).toEqual({
            state: 'expired',
            checkedAt: 400,
            failingSince: 100,
            lastSuccessAt: 50,
        });
    });

    it('keeps the cause of a failure, never of a success', () => {
        const failed = nextSourceHealthHistory(undefined, 'bad', 100, {
            reason: 'auth',
        });
        expect(failed?.reason).toBe('auth');
        expect(
            nextSourceHealthHistory(failed, 'ok', 200, { reason: 'available' })
        ).toEqual({ state: 'ok', checkedAt: 200, lastSuccessAt: 200 });
    });

    it('starts over for an edited connection, keeps the run for the same one', () => {
        const failed = nextSourceHealthHistory(undefined, 'bad', 100, {
            connection: 'old',
        });
        expect(
            nextSourceHealthHistory(failed, 'bad', 900, { connection: 'old' })
                ?.failingSince
        ).toBe(100);
        expect(
            nextSourceHealthHistory(failed, 'bad', 900, { connection: 'new' })
        ).toEqual({
            state: 'bad',
            checkedAt: 900,
            failingSince: 900,
            connection: 'new',
        });
        // An inconclusive check of the new connection keeps nothing old.
        expect(
            nextSourceHealthHistory(failed, 'unknown', 900, {
                connection: 'new',
            })
        ).toBeUndefined();
    });

    it('ends the run when the source answers again', () => {
        expect(
            nextSourceHealthHistory(
                { state: 'bad', checkedAt: 100, failingSince: 10 },
                'ok',
                500
            )
        ).toEqual({ state: 'ok', checkedAt: 500, lastSuccessAt: 500 });
    });

    it('keeps the previous entry for an inconclusive check', () => {
        const previous = {
            state: 'bad',
            checkedAt: 100,
            failingSince: 10,
        } as const;
        expect(nextSourceHealthHistory(previous, 'unknown', 900)).toBe(
            previous
        );
        expect(nextSourceHealthHistory(previous, 'checking', 900)).toBe(
            previous
        );
        expect(
            nextSourceHealthHistory(undefined, 'unknown', 900)
        ).toBeUndefined();
    });
});
