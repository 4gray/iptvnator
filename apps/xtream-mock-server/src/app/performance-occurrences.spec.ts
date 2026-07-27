import type { Request } from 'express';
import { PerformanceOccurrenceTracker } from './performance-occurrences.js';

describe('PerformanceOccurrenceTracker', () => {
    it('does not restart an old valid identity after more than 128 peers', () => {
        const tracker = new PerformanceOccurrenceTracker();
        const firstRequest = requestFor('get_live_streams', '91101');

        expect(tracker.next(firstRequest, 'direct', 1).occurrence).toBe(1);
        for (let category = 91_102; category <= 91_160; category++) {
            tracker.next(
                requestFor('get_live_streams', String(category)),
                'direct',
                1
            );
        }
        for (let category = 91_101; category <= 91_160; category++) {
            tracker.next(
                requestFor('get_live_streams', String(category)),
                'proxy',
                1
            );
        }
        for (let category = 92_101; category <= 92_120; category++) {
            tracker.next(
                requestFor('get_vod_streams', String(category)),
                'direct',
                1
            );
        }

        expect(tracker.snapshot()).toHaveLength(140);
        expect(tracker.next(firstRequest, 'direct', 1).occurrence).toBe(2);
    });
});

function requestFor(action: string, categoryId: string): Request {
    return {
        query: {
            username: 'performance',
            password: 'performance',
            action,
            category_id: categoryId,
        },
    } as unknown as Request;
}
