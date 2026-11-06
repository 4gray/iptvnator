import { markSlowStart } from '@iptvnator/services';
import { probeServerInstance } from './server-instance-probe';

const instance = {
    service: 'iptvnator',
    apiVersion: 1,
    instanceId: 'i-1',
    storage: 'server',
    auth: 'none',
};

describe('probeServerInstance', () => {
    const answer = (body: unknown, status = 200) =>
        jest.fn().mockResolvedValue({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        });
    const config = {
        runtimeConfig: { BACKEND_URL: '/api' },
        isElectron: false,
    };

    it('skips the probe without a runtime backend URL', async () => {
        const fetchFn = answer(instance);
        await expect(
            probeServerInstance({
                runtimeConfig: {},
                fetchFn: fetchFn as never,
            })
        ).resolves.toEqual({ kind: 'skipped' });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('skips the probe in Electron', async () => {
        const fetchFn = answer(instance);
        await expect(
            probeServerInstance({
                ...config,
                isElectron: true,
                fetchFn: fetchFn as never,
            })
        ).resolves.toEqual({ kind: 'skipped' });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('returns the instance when it reports server storage', async () => {
        const fetchFn = answer(instance);
        await expect(
            probeServerInstance({
                runtimeConfig: { BACKEND_URL: '/api/' },
                isElectron: false,
                fetchFn: fetchFn as never,
            })
        ).resolves.toEqual({ kind: 'server', instance });
        expect(fetchFn.mock.calls[0][0]).toBe('/api/v1/instance');
    });

    it('waits longer once after a reload for a server that answered late', async () => {
        const timeout = jest.spyOn(AbortSignal, 'timeout');
        try {
            markSlowStart();
            await probeServerInstance({
                ...config,
                fetchFn: answer(instance) as never,
            });
            await probeServerInstance({
                ...config,
                fetchFn: answer(instance) as never,
            });

            // A slow server otherwise times out again and reloads forever.
            expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
                20_000, 2_500,
            ]);
        } finally {
            timeout.mockRestore();
        }
    });

    it('reports no server storage for an answer without it', async () => {
        for (const fetchFn of [
            answer({ ...instance, storage: 'none' }),
            answer({ hello: 1 }),
            answer({ error: 'not found' }, 404),
            jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => {
                    throw new SyntaxError('not json');
                },
            }),
        ]) {
            await expect(
                probeServerInstance({ ...config, fetchFn: fetchFn as never })
            ).resolves.toEqual({ kind: 'none' });
        }
    });

    it('reports an unreachable server for failures, 5xx and refusals', async () => {
        for (const fetchFn of [
            jest.fn().mockRejectedValue(new TypeError('Failed to fetch')),
            answer('Bad Gateway', 502),
            answer('Too Many Requests', 429),
            answer('Forbidden', 403),
            // Headers arrived, then the body was cut off.
            jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => {
                    throw new DOMException('aborted', 'AbortError');
                },
            }),
        ]) {
            await expect(
                probeServerInstance({ ...config, fetchFn: fetchFn as never })
            ).resolves.toEqual({ kind: 'unreachable' });
        }
    });
});
