import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import {
    attachRendererReloadFallback,
    ERR_FILE_NOT_FOUND,
    RendererReloadFallbackWindow,
    resolveReloadedRendererRoute,
    resolveRoutedRendererUrl,
    restoreRendererRoute,
} from './renderer-reload-fallback';

const rendererRoot = resolve('/opt/iptvnator/resources/app/web');
const rendererIndexPath = join(rendererRoot, 'index.html');

function routedUrl(route: string): string {
    return pathToFileURL(join(rendererRoot, route)).href;
}

function failure(
    validatedUrl: string,
    overrides: { errorCode?: number; isMainFrame?: boolean } = {}
) {
    return {
        errorCode: ERR_FILE_NOT_FOUND,
        isMainFrame: true,
        validatedUrl,
        ...overrides,
    };
}

describe('resolveRoutedRendererUrl', () => {
    it('maps a routed file URL under the renderer root to its route', () => {
        expect(
            resolveRoutedRendererUrl(
                routedUrl('workspace/sources'),
                rendererIndexPath
            )
        ).toBe('workspace/sources');
        expect(
            resolveRoutedRendererUrl(
                routedUrl('workspace/settings/playback'),
                rendererIndexPath
            )
        ).toBe('workspace/settings/playback');
    });

    it('rejects the index itself, http URLs and paths outside the root', () => {
        expect(
            resolveRoutedRendererUrl(
                pathToFileURL(rendererIndexPath).href,
                rendererIndexPath
            )
        ).toBe(null);
        expect(
            resolveRoutedRendererUrl(
                'http://localhost:4200/workspace/sources',
                rendererIndexPath
            )
        ).toBe(null);
        expect(
            resolveRoutedRendererUrl(
                pathToFileURL(resolve('/opt/iptvnator/other')).href,
                rendererIndexPath
            )
        ).toBe(null);
    });
});

describe('resolveReloadedRendererRoute', () => {
    it('maps a routed file URL under the renderer root to its route', () => {
        expect(
            resolveReloadedRendererRoute(
                failure(routedUrl('workspace/sources')),
                rendererIndexPath
            )
        ).toBe('workspace/sources');
    });

    it('keeps the query and fragment of the failed URL', () => {
        expect(
            resolveReloadedRendererRoute(
                failure(
                    `${routedUrl('workspace/xtreams/3/search')}?q=dune#top`
                ),
                rendererIndexPath
            )
        ).toBe('workspace/xtreams/3/search?q=dune#top');
    });

    it('decodes percent-encoded path segments', () => {
        expect(
            resolveReloadedRendererRoute(
                failure(routedUrl('workspace/playlists/a b')),
                rendererIndexPath
            )
        ).toBe('workspace/playlists/a b');
    });

    it('never re-requests the index itself, which would loop', () => {
        expect(
            resolveReloadedRendererRoute(
                failure(pathToFileURL(rendererIndexPath).href),
                rendererIndexPath
            )
        ).toBe(null);
        expect(
            resolveReloadedRendererRoute(
                failure(
                    `${pathToFileURL(rendererIndexPath).href}?restoreRoute=x`
                ),
                rendererIndexPath
            )
        ).toBe(null);
    });

    it('ignores paths outside the renderer root', () => {
        expect(
            resolveReloadedRendererRoute(
                failure(pathToFileURL(resolve('/opt/iptvnator/other')).href),
                rendererIndexPath
            )
        ).toBe(null);
        expect(
            resolveReloadedRendererRoute(
                failure(pathToFileURL(rendererRoot).href),
                rendererIndexPath
            )
        ).toBe(null);
        expect(
            resolveReloadedRendererRoute(
                failure(
                    pathToFileURL(join(rendererRoot, '..', 'sibling')).href
                ),
                rendererIndexPath
            )
        ).toBe(null);
    });

    it('ignores other error codes, subframes and non-file URLs', () => {
        expect(
            resolveReloadedRendererRoute(
                failure(routedUrl('workspace/sources'), { errorCode: -3 }),
                rendererIndexPath
            )
        ).toBe(null);
        expect(
            resolveReloadedRendererRoute(
                failure(routedUrl('workspace/sources'), { isMainFrame: false }),
                rendererIndexPath
            )
        ).toBe(null);
        expect(
            resolveReloadedRendererRoute(
                failure('http://localhost:4200/workspace/sources'),
                rendererIndexPath
            )
        ).toBe(null);
        expect(
            resolveReloadedRendererRoute(
                failure('chrome-error://chromewebdata/'),
                rendererIndexPath
            )
        ).toBe(null);
        expect(
            resolveReloadedRendererRoute(
                failure('not a url'),
                rendererIndexPath
            )
        ).toBe(null);
    });
});

describe('restoreRendererRoute', () => {
    it('loads the index with the route in the query string', () => {
        const win = {
            isDestroyed: jest.fn(() => false),
            loadFile: jest.fn(() => Promise.resolve()),
        };

        restoreRendererRoute(win, rendererIndexPath, 'workspace/sources?q=1');

        expect(win.loadFile).toHaveBeenCalledWith(rendererIndexPath, {
            query: { restoreRoute: 'workspace/sources?q=1' },
        });
    });
});

describe('attachRendererReloadFallback', () => {
    type Listener = (...args: unknown[]) => void;

    function createWindow() {
        const listeners = new Map<string, Listener[]>();
        const win = {
            isDestroyed: jest.fn(() => false),
            loadFile: jest.fn(() => Promise.resolve()),
            webContents: {
                on: jest.fn((event: string, listener: Listener) => {
                    listeners.set(event, [
                        ...(listeners.get(event) ?? []),
                        listener,
                    ]);
                }),
            },
        };
        attachRendererReloadFallback(
            win as unknown as RendererReloadFallbackWindow,
            rendererIndexPath
        );
        const emit = (event: string, ...args: unknown[]) => {
            const handlers = listeners.get(event) ?? [];
            expect(handlers).toHaveLength(1);
            handlers[0](...args);
        };
        const failRoutedLoad = (url = routedUrl('workspace/sources')) => {
            emit('did-start-navigation', {
                isMainFrame: true,
                isSameDocument: false,
            });
            emit(
                'did-fail-load',
                {},
                ERR_FILE_NOT_FOUND,
                'ERR_FILE_NOT_FOUND',
                url,
                true
            );
        };
        return { win, emit, failRoutedLoad };
    }

    it('re-loads the index with the failed route once the error page is ready', () => {
        const { win, emit, failRoutedLoad } = createWindow();

        failRoutedLoad();
        // Never from inside did-fail-load: that document would never paint.
        expect(win.loadFile).not.toHaveBeenCalled();

        emit('dom-ready');

        expect(win.loadFile).toHaveBeenCalledTimes(1);
        expect(win.loadFile).toHaveBeenCalledWith(rendererIndexPath, {
            query: { restoreRoute: 'workspace/sources' },
        });
    });

    it('recovers only once per failure', () => {
        const { win, emit, failRoutedLoad } = createWindow();

        failRoutedLoad();
        emit('dom-ready');
        // The recovery load's own document.
        emit('did-start-navigation', {
            isMainFrame: true,
            isSameDocument: false,
        });
        emit('dom-ready');

        expect(win.loadFile).toHaveBeenCalledTimes(1);
    });

    it('withdraws the recovery when another navigation starts first', () => {
        const { win, emit, failRoutedLoad } = createWindow();

        failRoutedLoad();
        emit('did-start-navigation', {
            isMainFrame: true,
            isSameDocument: false,
        });
        emit('dom-ready');

        expect(win.loadFile).not.toHaveBeenCalled();
    });

    it('keeps the recovery across in-page and subframe navigations', () => {
        const { win, emit, failRoutedLoad } = createWindow();

        failRoutedLoad();
        emit('did-start-navigation', {
            isMainFrame: true,
            isSameDocument: true,
        });
        emit('did-start-navigation', {
            isMainFrame: false,
            isSameDocument: false,
        });
        emit('dom-ready');

        expect(win.loadFile).toHaveBeenCalledTimes(1);
    });

    it('leaves failures it cannot recover alone', () => {
        const { win, emit } = createWindow();

        emit(
            'did-fail-load',
            {},
            -3,
            'ERR_ABORTED',
            routedUrl('workspace/sources'),
            true
        );
        emit(
            'did-fail-load',
            {},
            ERR_FILE_NOT_FOUND,
            'ERR_FILE_NOT_FOUND',
            routedUrl('workspace/sources'),
            false
        );
        emit(
            'did-fail-load',
            {},
            ERR_FILE_NOT_FOUND,
            'ERR_FILE_NOT_FOUND',
            pathToFileURL(rendererIndexPath).href,
            true
        );
        emit('dom-ready');

        expect(win.loadFile).not.toHaveBeenCalled();
    });

    it('does not touch a destroyed window', () => {
        const { win, emit, failRoutedLoad } = createWindow();
        win.isDestroyed.mockReturnValue(true);

        failRoutedLoad();
        emit('dom-ready');

        expect(win.loadFile).not.toHaveBeenCalled();
    });

    it('reports a failed recovery load instead of rejecting unhandled', async () => {
        const { win, emit, failRoutedLoad } = createWindow();
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        win.loadFile.mockReturnValue(Promise.reject(new Error('gone')));

        failRoutedLoad();
        emit('dom-ready');
        await Promise.resolve();
        await Promise.resolve();

        expect(errorSpy).toHaveBeenCalledWith(
            'Failed to restore the renderer after a reload:',
            expect.any(Error)
        );
        errorSpy.mockRestore();
    });
});
