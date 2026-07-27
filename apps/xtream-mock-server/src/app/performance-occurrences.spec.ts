import type { Request } from 'express';
import { PerformanceOccurrenceTracker } from './performance-occurrences.js';
import { PERFORMANCE_CONTROL_LIMITS } from './performance-control.types.js';

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

    it('collapses non-canonical category aliases into one bounded identity', () => {
        const tracker = new PerformanceOccurrenceTracker();
        const canonical = tracker.next(
            requestFor('get_live_streams', '91101'),
            'direct',
            1
        );
        const aliases = [
            '+91101',
            ' 91101',
            '91101 ',
            '9.1101e4',
            '9007199254740993',
        ];

        expect(canonical).toMatchObject({
            categoryId: '91101',
            occurrence: 1,
        });
        aliases.forEach((categoryId, index) => {
            expect(
                tracker.next(
                    requestFor('get_live_streams', categoryId),
                    'direct',
                    1
                )
            ).toMatchObject({
                categoryId: 'all',
                occurrence: index + 1,
            });
        });
        for (
            let zeroCount = 1;
            zeroCount <= PERFORMANCE_CONTROL_LIMITS.occurrences + 1;
            zeroCount++
        ) {
            tracker.next(
                requestFor('get_live_streams', `${'0'.repeat(zeroCount)}91101`),
                'direct',
                1
            );
        }

        expect(tracker.snapshot()).toHaveLength(2);
        expect(tracker.snapshot()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    categoryId: '91101',
                    count: 1,
                }),
                expect.objectContaining({
                    categoryId: 'all',
                    count:
                        aliases.length +
                        PERFORMANCE_CONTROL_LIMITS.occurrences +
                        1,
                }),
            ])
        );
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
