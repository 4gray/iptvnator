import { createLatestRequestGuard } from './latest-request-guard';

describe('createLatestRequestGuard', () => {
    it('treats the only started request as latest', () => {
        const guard = createLatestRequestGuard();

        expect(guard.isLatest(guard.start())).toBe(true);
    });

    it('retires every earlier request when a new one starts', () => {
        const guard = createLatestRequestGuard();

        const first = guard.start();
        const second = guard.start();

        expect(guard.isLatest(first)).toBe(false);
        expect(guard.isLatest(second)).toBe(true);
    });

    it('keeps the newest owner even when responses settle out of order', () => {
        const guard = createLatestRequestGuard();

        const first = guard.start();
        const second = guard.start();

        // The stale response settling last must not reclaim ownership
        expect(guard.isLatest(second)).toBe(true);
        expect(guard.isLatest(first)).toBe(false);
    });

    it('never reports an unclaimed token as latest', () => {
        const guard = createLatestRequestGuard();

        expect(guard.isLatest(0)).toBe(false);

        guard.start();
        expect(guard.isLatest(99)).toBe(false);
    });

    it('isolates guards from each other', () => {
        const one = createLatestRequestGuard();
        const other = createLatestRequestGuard();

        const token = one.start();
        other.start();
        other.start();

        expect(one.isLatest(token)).toBe(true);
    });
});
