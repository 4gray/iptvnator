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
});
