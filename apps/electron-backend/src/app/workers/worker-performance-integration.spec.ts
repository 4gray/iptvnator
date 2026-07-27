import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    WORKER_PERFORMANCE_UNAVAILABLE_REASON,
    armWorkerPerformanceCapture,
    executeWithWorkerPerformanceCapture,
    startWorkerPerformanceCapture,
} from './worker-performance-capture';
import { createFakeRuntime } from './worker-performance-capture.test-harness';

function readWorkerSource(filename: string): string {
    return readFileSync(
        join(process.cwd(), 'apps/electron-backend/src/app/workers', filename),
        'utf8'
    );
}

describe('worker performance integration order', () => {
    it('profiles overlapping database requests without serializing their execution', () => {
        const source = readWorkerSource('database.worker.ts');
        const handler = source.slice(
            source.lastIndexOf("parentPort.on('message'")
        );

        expect(handler).toContain('registerDatabaseWorkerPerformanceCapture');
        expect(handler).toContain('executeWithWorkerPerformanceCapture');
        expect(handler).toContain('releaseDatabaseWorkerPerformanceCapture');
        expect(handler).toContain('finally');
        expect(handler).not.toContain('finishWorkerPerformanceCapture');
        expect(
            handler.indexOf('executeWithWorkerPerformanceCapture')
        ).toBeLessThan(handler.indexOf('console.error'));
        expect(
            handler.indexOf('executeWithWorkerPerformanceCapture')
        ).toBeLessThan(handler.indexOf('postMessage'));
        expect(
            handler.match(/stampWorkerPerformanceResponsePostedEpoch/g)
        ).toHaveLength(2);
        expect(handler).toMatch(
            /postMessage\(\{[\s\S]*?performance:\s*stampWorkerPerformanceResponsePostedEpoch\([\s\S]*?execution\.performance[\s\S]*?\),[\s\S]*?\}\)/
        );
        expect(handler).not.toContain('await previous');
        expect(handler).not.toContain('requestQueue');
    });

    it('keeps playlist response serialization after profiling completion', () => {
        const source = readWorkerSource('playlist-refresh.worker.ts');
        const handler = source.slice(source.lastIndexOf('parentPort.on('));
        const executionIndex = handler.indexOf(
            'executeWithWorkerPerformanceCapture'
        );

        expect(executionIndex).toBeGreaterThanOrEqual(0);
        expect(handler).not.toContain('finishWorkerPerformanceCapture');
        expect(executionIndex).toBeLessThan(
            handler.indexOf('serializeError', executionIndex)
        );
        expect(executionIndex).toBeLessThan(
            handler.indexOf('postMessage', executionIndex)
        );
        expect(
            handler.match(/stampWorkerPerformanceResponsePostedEpoch/g)
        ).toHaveLength(2);
    });

    it('passes the request capture into the single-playlist upsert boundary', () => {
        const source = readWorkerSource('database.worker.ts');
        const upsertCase = source.slice(
            source.indexOf("case 'DB_UPSERT_APP_PLAYLIST':"),
            source.indexOf("case 'DB_UPSERT_APP_PLAYLISTS':")
        );

        expect(upsertCase).toContain('captureWorkerPerformancePhase');
        expect(upsertCase).toContain('performanceCapture');
        expect(upsertCase).toContain('upsertAppPlaylist');
    });

    it('passes async read and sync deserialize capture into the single-playlist GET boundary', () => {
        const source = readWorkerSource('database.worker.ts');
        const getCase = source.slice(
            source.indexOf("case 'DB_GET_APP_PLAYLIST':"),
            source.indexOf("case 'DB_GET_APP_PLAYLIST_FAVORITE_CHANNELS':")
        );

        expect(getCase).toContain('captureWorkerPerformancePhaseAsync');
        expect(getCase).toContain('captureWorkerPerformancePhase');
        expect(getCase).toContain('performanceCapture');
        expect(getCase).toContain('getAppPlaylist');
    });

    it('preserves success and business errors when the finish seam throws once', async () => {
        const successHarness = createFakeRuntime();
        const successCapture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: successHarness.runtime,
        });
        await armWorkerPerformanceCapture(successCapture);
        const failingSuccessFinish = jest.fn(async () => {
            throw new Error('finish failed');
        });

        const success = await executeWithWorkerPerformanceCapture(
            successCapture,
            async () => 'business-result',
            failingSuccessFinish
        );

        expect(success).toMatchObject({
            error: null,
            result: 'business-result',
            success: true,
            performance: {
                eventLoopDelay: null,
                eventLoopDelayUnavailableReason:
                    WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_CAPTURE_UNAVAILABLE,
                eventLoopUtilization: 0.75,
                threadCpuSystemMicros: 30,
                threadCpuUserMicros: 80,
            },
        });
        expect(failingSuccessFinish).toHaveBeenCalledTimes(1);

        const errorHarness = createFakeRuntime();
        const errorCapture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: errorHarness.runtime,
        });
        await armWorkerPerformanceCapture(errorCapture);
        const businessError = new Error('business failed');
        const failingErrorFinish = jest.fn(async () => {
            throw new Error('finish failed');
        });

        const failure = await executeWithWorkerPerformanceCapture(
            errorCapture,
            async () => {
                throw businessError;
            },
            failingErrorFinish
        );

        expect(failure).toMatchObject({
            error: businessError,
            result: undefined,
            success: false,
        });
        expect(failingErrorFinish).toHaveBeenCalledTimes(1);
    });
});
