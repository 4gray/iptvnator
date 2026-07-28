import { XTREAM_DATABASE_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';
import {
    finishWorkerPerformanceCapture,
    startWorkerPerformanceCapture,
} from './worker-performance-capture';
import { createFakeRuntime } from './worker-performance-capture.test-harness';
import { createWorkerPerformancePhaseAdapter } from './worker-performance-phase';

describe('database operation worker performance adapter', () => {
    it('returns no adapter when profiling is disabled', () => {
        expect(createWorkerPerformancePhaseAdapter(null)).toBeUndefined();
    });

    it('delegates Xtream phases into the request capture with count-only metadata', async () => {
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            requestId: 'xtream-db-request',
            runtime: createFakeRuntime().runtime,
        });
        const adapter = createWorkerPerformancePhaseAdapter(capture);
        const rows = [{ id: 1 }, { id: 2 }];

        await expect(
            adapter?.captureAsync(
                XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_READ,
                () => Promise.resolve(rows),
                (result) => ({ itemCount: result.length })
            )
        ).resolves.toBe(rows);

        const result = await finishWorkerPerformanceCapture(capture);
        expect(result?.phaseEvents).toEqual([
            expect.objectContaining({
                boundary: 'start',
                metadata: undefined,
                phase: 'sqlite.categories.read',
                requestId: 'xtream-db-request',
            }),
            expect.objectContaining({
                boundary: 'end',
                metadata: { itemCount: 2 },
                phase: 'sqlite.categories.read',
                requestId: 'xtream-db-request',
            }),
        ]);
    });

    it('closes rejected phases without metadata and preserves error identity', async () => {
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            requestId: 'xtream-db-error',
            runtime: createFakeRuntime().runtime,
        });
        const adapter = createWorkerPerformancePhaseAdapter(capture);
        const businessError = new Error('read failed');

        await expect(
            adapter?.captureAsync(
                XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CONTENT_READ,
                () => Promise.reject(businessError),
                () => ({ itemCount: 99 })
            )
        ).rejects.toBe(businessError);

        const result = await finishWorkerPerformanceCapture(capture);
        expect(
            result?.phaseEvents?.map(({ boundary, metadata }) => ({
                boundary,
                metadata,
            }))
        ).toEqual([
            { boundary: 'start', metadata: undefined },
            { boundary: 'end', metadata: undefined },
        ]);
    });
});
