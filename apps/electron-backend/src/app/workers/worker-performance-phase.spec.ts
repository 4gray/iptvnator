import {
    APP_PLAYLIST_GET_PERFORMANCE_PHASE,
    APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE,
    type PerformancePhaseMetadata,
} from '@iptvnator/shared/interfaces';

import {
    finishWorkerPerformanceCapture,
    startWorkerPerformanceCapture,
} from './worker-performance-capture';
import {
    captureWorkerPerformancePhase,
    captureWorkerPerformancePhaseAsync,
} from './worker-performance-phase';
import { createFakeRuntime } from './worker-performance-capture.test-harness';

describe('worker request performance phases', () => {
    it('executes directly without phase allocation or metadata work when disabled', () => {
        const resultIdentity = { success: true };
        const execute = jest.fn(() => resultIdentity);
        const metadata = jest.fn(() => {
            throw new Error('metadata must remain untouched');
        });

        const result = captureWorkerPerformancePhase(
            null,
            APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SERIALIZE_PLAYLIST,
            execute,
            metadata
        );

        expect(result).toBe(resultIdentity);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(metadata).not.toHaveBeenCalled();
    });

    it('adds ordered request-scoped pairs to the existing performance envelope', async () => {
        const harness = createFakeRuntime();
        const monotonicValues = [10, 17, 20, 31];
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            requestId: 'db-request-1',
            runtime: {
                ...harness.runtime,
                readMonotonicMs: () => monotonicValues.shift() ?? 31,
            },
        });
        const rowIdentity = { payload: '{"playlist":"synthetic"}' };

        expect(
            captureWorkerPerformancePhase(
                capture,
                APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SERIALIZE_PLAYLIST,
                () => rowIdentity,
                () =>
                    ({
                        byteCount: 24,
                        itemCount: 100_000,
                        secret: 'must-not-be-copied',
                    }) as PerformancePhaseMetadata
            )
        ).toBe(rowIdentity);
        captureWorkerPerformancePhase(
            capture,
            APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SQLITE_WRITE,
            () => undefined,
            () => ({ byteCount: 24, itemCount: 1 })
        );

        const result = await finishWorkerPerformanceCapture(capture);

        expect(result?.phaseEvents).toEqual([
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 110,
                metadata: undefined,
                phase: APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SERIALIZE_PLAYLIST,
                requestId: 'db-request-1',
            },
            {
                boundary: 'end',
                durationMs: 7,
                epochMs: 140,
                metadata: { byteCount: 24, itemCount: 100_000 },
                phase: APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SERIALIZE_PLAYLIST,
                requestId: 'db-request-1',
            },
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 145,
                metadata: undefined,
                phase: APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SQLITE_WRITE,
                requestId: 'db-request-1',
            },
            {
                boundary: 'end',
                durationMs: 11,
                epochMs: 149,
                metadata: { byteCount: 24, itemCount: 1 },
                phase: APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SQLITE_WRITE,
                requestId: 'db-request-1',
            },
        ]);
        expect(JSON.stringify(result?.phaseEvents)).not.toContain('secret');
    });

    it('preserves exact error identity and still closes the phase pair', async () => {
        const harness = createFakeRuntime();
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            requestId: 'db-request-error',
            runtime: harness.runtime,
        });
        const businessError = new Error('sqlite write failed');

        expect(() =>
            captureWorkerPerformancePhase(
                capture,
                APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SQLITE_WRITE,
                () => {
                    throw businessError;
                },
                () => {
                    throw new Error('metadata failed');
                }
            )
        ).toThrow(businessError);

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

    it('returns the exact business promise without metadata work when async capture is disabled', async () => {
        const resultIdentity = { rows: 1 };
        const businessPromise = Promise.resolve(resultIdentity);
        const execute = jest.fn(() => businessPromise);
        const metadata = jest.fn(() => {
            throw new Error('metadata must remain untouched');
        });

        const result = captureWorkerPerformancePhaseAsync(
            null,
            APP_PLAYLIST_GET_PERFORMANCE_PHASE.SQLITE_READ,
            execute,
            metadata
        );

        expect(result).toBe(businessPromise);
        await expect(result).resolves.toBe(resultIdentity);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(metadata).not.toHaveBeenCalled();
    });

    it('closes an async phase only after the awaited operation settles', async () => {
        const harness = createFakeRuntime();
        const monotonicValues = [10, 27];
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            requestId: 'db-get-request',
            runtime: {
                ...harness.runtime,
                readMonotonicMs: () => monotonicValues.shift() ?? 27,
            },
        });
        const rows = [{ id: 'synthetic-playlist' }];
        let resolveRows!: (value: typeof rows) => void;
        const pendingRows = new Promise<typeof rows>((resolve) => {
            resolveRows = resolve;
        });

        const result = captureWorkerPerformancePhaseAsync(
            capture,
            APP_PLAYLIST_GET_PERFORMANCE_PHASE.SQLITE_READ,
            () => pendingRows,
            (value) => ({ itemCount: value.length })
        );

        expect(capture?.phaseEvents).toHaveLength(1);
        resolveRows(rows);
        await expect(result).resolves.toBe(rows);
        expect(capture?.phaseEvents).toHaveLength(2);

        const performance = await finishWorkerPerformanceCapture(capture);
        expect(performance?.phaseEvents).toEqual([
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 110,
                metadata: undefined,
                phase: APP_PLAYLIST_GET_PERFORMANCE_PHASE.SQLITE_READ,
                requestId: 'db-get-request',
            },
            {
                boundary: 'end',
                durationMs: 17,
                epochMs: 140,
                metadata: { itemCount: 1 },
                phase: APP_PLAYLIST_GET_PERFORMANCE_PHASE.SQLITE_READ,
                requestId: 'db-get-request',
            },
        ]);
    });

    it('preserves async rejection identity and closes the phase without metadata', async () => {
        const harness = createFakeRuntime();
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            requestId: 'db-get-error',
            runtime: harness.runtime,
        });
        const businessError = new Error('sqlite read failed');

        await expect(
            captureWorkerPerformancePhaseAsync(
                capture,
                APP_PLAYLIST_GET_PERFORMANCE_PHASE.SQLITE_READ,
                () => Promise.reject(businessError),
                () => {
                    throw new Error('metadata must not run for errors');
                }
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
