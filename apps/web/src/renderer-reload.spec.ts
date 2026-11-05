import { prepareRendererReload } from './renderer-reload';
import { resolveRestoredRendererRoute } from '@iptvnator/shared/interfaces';

const index = 'file:///synthetic/web/index.html';
const route = 'file:///synthetic/web/workspace/global-favorites?q=synthetic';
const view = { selectedContentType: 'movie', scope: 'all' };

function documentAt(href: string, state: unknown = null) {
    const browser = {
        location: new URL(href),
        sessionStorage,
        history: {
            state,
            replaceState: jest.fn(
                (next: unknown, _title: string, url: string) => {
                    browser.history.state = next;
                    browser.location.href = url;
                }
            ),
        },
        addEventListener: jest.fn(
            (_type: string, _listener: () => void) => undefined
        ),
    };
    prepareRendererReload(
        browser as unknown as Window,
        resolveRestoredRendererRoute(href, index)
    );
    return browser;
}

function recoveryUrl(target = route): string {
    const url = new URL(index);
    url.searchParams.set(
        'restoreRoute',
        target.replace('file:///synthetic/web/', '')
    );
    return url.href;
}

function seedHandoff(href: string, state: unknown): void {
    sessionStorage.setItem(
        'iptvnator:renderer-reload-collection',
        JSON.stringify({ href, collectionViewState: state })
    );
}

beforeEach(() => sessionStorage.clear());

test('carries validated collection fields once across a new recovery document', () => {
    sessionStorage.setItem(
        'iptvnator:renderer-reload-collection',
        JSON.stringify({
            href: route,
            collectionViewState: { ...view, extra: 'discard' },
            navigationId: 12,
            ɵrouterPageId: 4,
            openCollectionDetailItem: { item: 'discard' },
            openLiveCollectionItem: { item: 'discard' },
            stalkerReturnTo: '/workspace/dashboard',
        })
    );
    const fresh = documentAt(recoveryUrl());
    expect(fresh.history.replaceState).toHaveBeenCalledWith(
        { collectionViewState: view },
        '',
        route
    );
    expect(sessionStorage.length).toBe(0);
    expect(documentAt(recoveryUrl()).history.state).toEqual({});
});

test.each([
    ['another route', 'file:///synthetic/web/workspace/global-recent', view],
    [
        'invalid fields',
        route,
        { selectedContentType: 'unknown', scope: 'unknown' },
    ],
    ['no collection state', route, undefined],
])('does not restore %s', (_label, href, state) => {
    seedHandoff(href, state);
    expect(documentAt(recoveryUrl()).history.state).toEqual({});
});

test('revalidates stored fields and strips playback and router bookkeeping', () => {
    sessionStorage.setItem(
        'iptvnator:renderer-reload-collection',
        JSON.stringify({
            href: route,
            collectionViewState: {
                selectedContentType: 'series',
                scope: 'invalid',
                extra: 1,
            },
            navigationId: 99,
            openCollectionDetailItem: { seriesResume: 'discard' },
        })
    );
    expect(documentAt(recoveryUrl()).history.state).toEqual({
        collectionViewState: { selectedContentType: 'series' },
    });
});

test('consumes stale state on an ordinary startup without replaying it later', () => {
    seedHandoff(route, view);
    expect(documentAt(index).history.replaceState).not.toHaveBeenCalled();
    expect(documentAt(recoveryUrl()).history.state).toEqual({});
});

test('recovers the URL with corrupt or unavailable storage', () => {
    sessionStorage.setItem('iptvnator:renderer-reload-collection', '{invalid');
    expect(documentAt(recoveryUrl()).location.href).toBe(route);
    const spy = jest
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
            throw new Error('Synthetic unavailable storage');
        });
    try {
        expect(documentAt(recoveryUrl()).location.href).toBe(route);
    } finally {
        spy.mockRestore();
    }
});

test('leaves browser runtime history and lifecycle alone', () => {
    const browser = documentAt(
        'https://synthetic.invalid/workspace/global-favorites',
        { collectionViewState: view, navigationId: 3 }
    );
    expect(browser.addEventListener).not.toHaveBeenCalled();
    expect(browser.history.replaceState).not.toHaveBeenCalled();
});
