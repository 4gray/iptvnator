import type { AndroidLibraryControls } from '@iptvnator/services';
import { inspectAndroidServer } from './android-server-inspection';

describe('public server discovery in older handheld shells', () => {
    const originalFetch = globalThis.fetch;
    const apiUrl = 'https://library.example/api';
    const controls = {
        libraryConnection: () => ({
            origin: '',
            savedOrigin: '',
            canScanQr: true,
        }),
        scanLibraryQr: jest.fn(),
        disconnectLibrary: jest.fn(),
        pairLibrary: jest.fn(),
        connectLibrary: jest.fn(),
    } satisfies AndroidLibraryControls;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it.each([
        ['none', [], 'sources'],
        ['token', [], 'token'],
        ['token', ['browser-pairing-v1'], 'pair'],
        ['token', ['cloudflare-device-v1'], 'access'],
    ] as const)(
        'classifies public metadata with %s and %s as %s',
        async (auth, capabilities, expected) => {
            globalThis.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    service: 'iptvnator',
                    apiVersion: 1,
                    storage: 'server',
                    instanceId: 'fixture',
                    auth,
                    capabilities: ['sources-v1', ...capabilities],
                }),
            });
            expect(await inspectAndroidServer(controls, apiUrl)).toBe(expected);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                apiUrl + '/v1/instance',
                expect.objectContaining({
                    credentials: 'omit',
                    redirect: 'error',
                    referrerPolicy: 'no-referrer',
                })
            );
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        }
    );

    it.each([
        [
            apiUrl,
            'Bearer resource_metadata="https://auth.example/resource"',
            'access',
        ],
        [apiUrl, 'Bearer resource_metadata="invalid"', 'unknown'],
        [apiUrl, 'Basic realm="sources"', 'unknown'],
        [
            'http://library.example/api',
            'Bearer resource_metadata="https://auth.example/resource"',
            'unknown',
        ],
    ])(
        'recognizes a secure Access challenge for %s (%s)',
        async (api, challenge, expected) => {
            globalThis.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 401,
                headers: new Headers({ 'WWW-Authenticate': challenge }),
            });
            expect(await inspectAndroidServer(controls, api)).toBe(expected);
        }
    );
});
