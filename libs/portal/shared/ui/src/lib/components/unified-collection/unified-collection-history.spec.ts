/** @jest-environment-options {"url":"file:///synthetic/web/workspace/global-favorites"} */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { COLLECTION_RELOAD_STATE_KEY } from '@iptvnator/portal/shared/util';
import {
    CollectionViewStateHistory,
    setupCollectionViewStateSync,
} from './unified-collection-history';

const storage = {
    removeItem: jest.fn(),
    setItem: jest.fn(),
};

beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: storage,
    });
    TestBed.configureTestingModule({});
    window.history.replaceState(
        {
            collectionViewState: {
                selectedContentType: 'movie',
                scope: 'all',
                extra: 'discard',
            },
            navigationId: 12,
            openCollectionDetailItem: { item: 'discard' },
            openLiveCollectionItem: { item: 'discard' },
        },
        ''
    );
});

afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
});

function mount(): void {
    TestBed.runInInjectionContext(() =>
        setupCollectionViewStateSync({
            history: new CollectionViewStateHistory(),
            selectedContentType: signal('movie'),
            scope: signal('all'),
        })
    );
}

test('saves only validated context for this document on pagehide', () => {
    mount();
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.setItem).toHaveBeenCalledWith(
        COLLECTION_RELOAD_STATE_KEY,
        JSON.stringify({
            href: window.location.href,
            collectionViewState: { selectedContentType: 'movie', scope: 'all' },
        })
    );
});

test('keeps reload usable when storage writes fail', () => {
    mount();
    storage.setItem.mockImplementationOnce(() => {
        throw new Error('Synthetic full storage');
    });
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
});

test('clears stale handoffs and releases its listener on collection destruction', () => {
    const remove = jest.spyOn(window, 'removeEventListener');
    mount();
    expect(storage.removeItem).toHaveBeenCalledWith(
        COLLECTION_RELOAD_STATE_KEY
    );
    TestBed.resetTestingModule();
    expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.setItem).not.toHaveBeenCalled();
});
