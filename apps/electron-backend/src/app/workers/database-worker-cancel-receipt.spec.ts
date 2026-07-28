import { publishDatabaseWorkerCancelReceipt } from './database-worker-cancel-receipt';

const PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';
const originalProfilingValue = process.env[PROFILING_ENV];

describe('database worker performance cancellation receipt', () => {
    beforeEach(() => {
        delete process.env[PROFILING_ENV];
    });

    afterAll(() => {
        if (originalProfilingValue === undefined) {
            delete process.env[PROFILING_ENV];
        } else {
            process.env[PROFILING_ENV] = originalProfilingValue;
        }
    });

    it('does no clock or transport work without the exact profiling opt-in', () => {
        const publish = jest.fn();
        const readEpochMs = jest.fn(() => 123);
        process.env[PROFILING_ENV] = 'true';

        publishDatabaseWorkerCancelReceipt(
            'operation-1',
            'request-1',
            publish,
            { readEpochMs }
        );

        expect(readEpochMs).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it('publishes only safe correlation IDs and a finite epoch', () => {
        const publish = jest.fn();
        process.env[PROFILING_ENV] = '1';

        publishDatabaseWorkerCancelReceipt(
            'playlist-delete:123_abc',
            '08da28c4-cc14-4a79-95ec-dff6bba10db0',
            publish,
            { readEpochMs: () => 1_234.5 }
        );

        expect(publish).toHaveBeenCalledWith({
            type: 'performance-cancel-received',
            operationId: 'playlist-delete:123_abc',
            requestId: '08da28c4-cc14-4a79-95ec-dff6bba10db0',
            epochMs: 1_234.5,
        });
        expect(
            Object.keys(publish.mock.calls[0][0] as Record<string, unknown>)
        ).toEqual(['type', 'operationId', 'requestId', 'epochMs']);
    });

    it.each([
        [' leading-space', 'request-1'],
        ['trailing-space ', 'request-1'],
        ['provider/password', 'request-1'],
        ['operation-1', 'request with spaces'],
        ['operation-1', 'request/with/slashes'],
        [`a${'b'.repeat(128)}`, 'request-1'],
    ])(
        'rejects unsafe operation/request correlation without transport work',
        (operationId, requestId) => {
            const publish = jest.fn();
            const readEpochMs = jest.fn(() => 123);
            process.env[PROFILING_ENV] = '1';

            publishDatabaseWorkerCancelReceipt(
                operationId,
                requestId,
                publish,
                { readEpochMs }
            );

            expect(readEpochMs).not.toHaveBeenCalled();
            expect(publish).not.toHaveBeenCalled();
        }
    );

    it('fails neutrally when the clock or diagnostic transport fails', () => {
        process.env[PROFILING_ENV] = '1';
        const publish = jest.fn(() => {
            throw new Error('transport unavailable');
        });

        expect(() =>
            publishDatabaseWorkerCancelReceipt(
                'operation-1',
                'request-1',
                publish,
                { readEpochMs: () => 123 }
            )
        ).not.toThrow();
        expect(() =>
            publishDatabaseWorkerCancelReceipt(
                'operation-1',
                'request-1',
                publish,
                {
                    readEpochMs: () => {
                        throw new Error('clock unavailable');
                    },
                }
            )
        ).not.toThrow();
        expect(() =>
            publishDatabaseWorkerCancelReceipt(
                'operation-1',
                'request-1',
                publish,
                { readEpochMs: () => Number.NaN }
            )
        ).not.toThrow();

        expect(publish).toHaveBeenCalledTimes(1);
    });
});
