jest.mock('./store.service', () => ({
    store: {
        get: jest.fn(),
        set: jest.fn(),
    },
    ZOOM_LEVEL: 'zoomLevel',
}));

import { store } from './store.service';
import {
    attachZoomLevelPersistence,
    markZoomLevelApplied,
    persistZoomLevel,
    readPersistedZoomLevel,
} from './window-zoom-level';

type NavigationDetails = { isMainFrame: boolean; isSameDocument: boolean };

function createWindow(level = 0) {
    const listeners = new Map<string, (details: NavigationDetails) => void>();
    const webContents = {
        isDestroyed: jest.fn(() => false),
        getZoomLevel: jest.fn(() => level),
        on: jest.fn(
            (event: string, listener: (details: NavigationDetails) => void) => {
                listeners.set(event, listener);
            }
        ),
    };
    const win = { webContents } as unknown as Electron.BrowserWindow;

    return {
        win,
        webContents,
        navigate(details: NavigationDetails): void {
            const listener = listeners.get('did-start-navigation');
            expect(listener).toBeDefined();
            listener?.(details);
        },
    };
}

describe('window zoom level persistence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (store.get as jest.Mock).mockReturnValue(undefined);
    });

    describe('readPersistedZoomLevel', () => {
        it('returns a finite stored level', () => {
            (store.get as jest.Mock).mockReturnValue(-1.5);

            expect(readPersistedZoomLevel()).toBe(-1.5);
            expect(store.get).toHaveBeenCalledWith('zoomLevel');
        });

        it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, '2'])(
            'returns null for the unusable stored value %p',
            (value) => {
                (store.get as jest.Mock).mockReturnValue(value);

                expect(readPersistedZoomLevel()).toBeNull();
            }
        );
    });

    describe('persistZoomLevel', () => {
        it('does nothing before the preload took ownership of the level', () => {
            const { win, webContents } = createWindow(2);

            persistZoomLevel(win);

            expect(webContents.getZoomLevel).not.toHaveBeenCalled();
            expect(store.set).not.toHaveBeenCalled();
        });

        it('saves the live level once the preload applied it', () => {
            const { win, webContents } = createWindow(1.5);
            markZoomLevelApplied(
                webContents as unknown as Electron.WebContents
            );

            persistZoomLevel(win);

            expect(store.set).toHaveBeenCalledWith('zoomLevel', 1.5);
        });

        it('never reads a destroyed webContents', () => {
            const { win, webContents } = createWindow(1.5);
            markZoomLevelApplied(
                webContents as unknown as Electron.WebContents
            );
            webContents.isDestroyed.mockReturnValue(true);

            persistZoomLevel(win);

            expect(webContents.getZoomLevel).not.toHaveBeenCalled();
            expect(store.set).not.toHaveBeenCalled();
        });

        it('skips a non-finite live level', () => {
            const { win, webContents } = createWindow(Number.NaN);
            markZoomLevelApplied(
                webContents as unknown as Electron.WebContents
            );

            persistZoomLevel(win);

            expect(store.set).not.toHaveBeenCalled();
        });
    });

    describe('attachZoomLevelPersistence', () => {
        it('saves the level before a cross-document navigation and releases ownership until the next preload answers', () => {
            const { win, webContents, navigate } = createWindow(3);
            attachZoomLevelPersistence(win);
            markZoomLevelApplied(
                webContents as unknown as Electron.WebContents
            );

            navigate({ isMainFrame: true, isSameDocument: false });
            expect(store.set).toHaveBeenCalledWith('zoomLevel', 3);

            // The reloading document has not applied anything yet: its
            // getZoomLevel() is Chromium's per-URL default and must not be saved.
            (store.set as jest.Mock).mockClear();
            webContents.getZoomLevel.mockReturnValue(0);
            persistZoomLevel(win);
            expect(store.set).not.toHaveBeenCalled();

            // The new document's preload handshake re-enables saving.
            markZoomLevelApplied(
                webContents as unknown as Electron.WebContents
            );
            webContents.getZoomLevel.mockReturnValue(3);
            persistZoomLevel(win);
            expect(store.set).toHaveBeenCalledWith('zoomLevel', 3);
        });

        it.each([
            { isMainFrame: true, isSameDocument: true },
            { isMainFrame: false, isSameDocument: false },
        ])(
            'ignores the navigation %p (in-app routing and subframes keep the level)',
            (details) => {
                const { win, webContents, navigate } = createWindow(3);
                attachZoomLevelPersistence(win);
                markZoomLevelApplied(
                    webContents as unknown as Electron.WebContents
                );

                navigate(details);

                expect(store.set).not.toHaveBeenCalled();
                persistZoomLevel(win);
                expect(store.set).toHaveBeenCalledWith('zoomLevel', 3);
            }
        );
    });
});
