import { probeServerInstance } from './server-instance-probe';

const instance = {
    service: 'iptvnator',
    apiVersion: 1,
    instanceId: 'i-1',
    storage: 'server',
    auth: 'none',
};

describe('probeServerInstance', () => {
    const ok = (body: unknown) =>
        jest.fn().mockResolvedValue({ ok: true, json: async () => body });

    it('skips the probe without a runtime backend URL', async () => {
        const fetchFn = ok(instance);
        await expect(
            probeServerInstance({
                runtimeConfig: {},
                fetchFn: fetchFn as never,
            })
        ).resolves.toBeNull();
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('skips the probe in Electron', async () => {
        const fetchFn = ok(instance);
        await expect(
            probeServerInstance({
                runtimeConfig: { BACKEND_URL: '/api' },
                isElectron: true,
                fetchFn: fetchFn as never,
            })
        ).resolves.toBeNull();
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('returns the instance when it reports server storage', async () => {
        const fetchFn = ok(instance);
        await expect(
            probeServerInstance({
                runtimeConfig: { BACKEND_URL: '/api/' },
                isElectron: false,
                fetchFn: fetchFn as never,
            })
        ).resolves.toEqual(instance);
        expect(fetchFn.mock.calls[0][0]).toBe('/api/v1/instance');
    });

    it('returns null for storage none, bad bodies and failures', async () => {
        const config = {
            runtimeConfig: { BACKEND_URL: '/api' },
            isElectron: false,
        };
        await expect(
            probeServerInstance({
                ...config,
                fetchFn: ok({ ...instance, storage: 'none' }) as never,
            })
        ).resolves.toBeNull();
        await expect(
            probeServerInstance({
                ...config,
                fetchFn: ok({ hello: 1 }) as never,
            })
        ).resolves.toBeNull();
        await expect(
            probeServerInstance({
                ...config,
                fetchFn: jest
                    .fn()
                    .mockResolvedValue({ ok: false, status: 404 }) as never,
            })
        ).resolves.toBeNull();
        await expect(
            probeServerInstance({
                ...config,
                fetchFn: jest.fn().mockRejectedValue(new Error('x')) as never,
            })
        ).resolves.toBeNull();
    });
});
