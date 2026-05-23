jest.mock('electron', () => ({
    app: {
        getPath: jest.fn(() => '/tmp'),
        isPackaged: false,
    },
    BrowserWindow: jest.fn(),
    Menu: {
        buildFromTemplate: jest.fn(),
    },
    screen: {
        getPrimaryDisplay: jest.fn(),
    },
    shell: {
        openExternal: jest.fn(),
    },
}));

jest.mock('./services/store.service', () => ({
    store: {
        get: jest.fn(),
        set: jest.fn(),
    },
    WINDOW_BOUNDS: 'windowBounds',
}));

import {
    getMainWindowWebPreferences,
    isExternalBrowserUrl,
    isTrustedRendererNavigationUrl,
} from './app';

describe('Electron app security helpers', () => {
    it('creates an explicitly hardened BrowserWindow webPreferences object', () => {
        expect(getMainWindowWebPreferences()).toEqual(
            expect.objectContaining({
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                webSecurity: true,
                backgroundThrottling: false,
            })
        );
    });

    it('treats only http and https URLs as external browser URLs', () => {
        expect(isExternalBrowserUrl('https://example.com')).toBe(true);
        expect(isExternalBrowserUrl('http://example.com')).toBe(true);
        expect(isExternalBrowserUrl('file:///tmp/index.html')).toBe(false);
        expect(isExternalBrowserUrl('javascript:alert(1)')).toBe(false);
        expect(isExternalBrowserUrl('not a url')).toBe(false);
    });

    it('allows only the dev server origin in development navigation', () => {
        expect(
            isTrustedRendererNavigationUrl('http://localhost:4200/home', true)
        ).toBe(true);
        expect(
            isTrustedRendererNavigationUrl('http://127.0.0.1:4200/home', true)
        ).toBe(true);
        expect(
            isTrustedRendererNavigationUrl('http://[::1]:4200/home', true)
        ).toBe(true);
        expect(
            isTrustedRendererNavigationUrl('http://localhost:4300/home', true)
        ).toBe(false);
        expect(
            isTrustedRendererNavigationUrl('https://example.com', true)
        ).toBe(false);
        expect(
            isTrustedRendererNavigationUrl('file:///tmp/index.html', true)
        ).toBe(false);
    });

    it('allows only the packaged renderer file in packaged navigation', () => {
        expect(
            isTrustedRendererNavigationUrl(
                'file:///tmp/iptvnator/index.html',
                false,
                '/tmp/iptvnator/index.html'
            )
        ).toBe(true);
        expect(
            isTrustedRendererNavigationUrl(
                'file:///tmp/other/index.html',
                false,
                '/tmp/iptvnator/index.html'
            )
        ).toBe(false);
        expect(
            isTrustedRendererNavigationUrl('https://example.com', false)
        ).toBe(false);
    });
});
