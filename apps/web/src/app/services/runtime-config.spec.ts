import { resolveBackendUrl, shouldEnableServiceWorker } from './runtime-config';

describe('runtime config helpers', () => {
    it('uses runtime BACKEND_URL when provided', () => {
        expect(
            resolveBackendUrl(
                { BACKEND_URL: '  http://self-hosted.local/api  ' },
                'https://fallback.example'
            )
        ).toBe('http://self-hosted.local/api');
    });

    it('falls back to the build-time backend URL when runtime config is missing or blank', () => {
        expect(resolveBackendUrl(undefined, 'https://fallback.example')).toBe(
            'https://fallback.example'
        );
        expect(resolveBackendUrl({}, 'https://fallback.example')).toBe(
            'https://fallback.example'
        );
        expect(
            resolveBackendUrl(
                { BACKEND_URL: '   ' },
                'https://fallback.example'
            )
        ).toBe('https://fallback.example');
    });

    it('enables service worker only for production builds with browser support', () => {
        expect(
            shouldEnableServiceWorker(true, {
                serviceWorker: {},
            } as Navigator)
        ).toBe(true);
        expect(
            shouldEnableServiceWorker(false, { serviceWorker: {} } as Navigator)
        ).toBe(false);
        expect(shouldEnableServiceWorker(true, {} as Navigator)).toBe(false);
    });

    it('disables service worker for Electron runtime', () => {
        expect(
            shouldEnableServiceWorker(
                true,
                { serviceWorker: {} } as Navigator,
                {
                    electronBridge: {},
                    protocol: 'file:',
                }
            )
        ).toBe(false);
    });

    it('disables service worker for Electron runtime on non-file origins', () => {
        expect(
            shouldEnableServiceWorker(
                true,
                { serviceWorker: {} } as Navigator,
                {
                    electronBridge: {},
                    protocol: 'https:',
                }
            )
        ).toBe(false);
    });

    it('disables service worker for file origins without an Electron bridge', () => {
        expect(
            shouldEnableServiceWorker(
                true,
                { serviceWorker: {} } as Navigator,
                {
                    protocol: 'file:',
                }
            )
        ).toBe(false);
    });

    it.each([
        ['Android Touch layout before the page adds its classes', 'TvShell', { postMessage: jest.fn() }],
        ['Android Cloudflare library', 'HostedAccessApi', {}],
    ] as const)('skips browser updates on %s', (_name, key, bridge) => {
        Reflect.set(window, key, bridge);
        try {
            expect(shouldEnableServiceWorker(true, { serviceWorker: {} } as Navigator)).toBe(false);
        } finally {
            Reflect.deleteProperty(window, key);
        }
    });

    it('keeps browser updates for a hosted page without a native bridge', () => {
        Reflect.set(window, '__tvShell', { handheld: false });
        try {
            expect(shouldEnableServiceWorker(true, { serviceWorker: {} } as Navigator)).toBe(true);
        } finally {
            Reflect.deleteProperty(window, '__tvShell');
        }
    });

    it('disables service workers for the bundled TV Shell on loopback', () => {
        document.documentElement.classList.add('tv-shell');
        try {
            expect(
                shouldEnableServiceWorker(true, {
                    serviceWorker: {},
                } as Navigator)
            ).toBe(false);
        } finally {
            document.documentElement.classList.remove('tv-shell');
        }
    });
});
