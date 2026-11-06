import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
    getGlobalFavoriteNavigation,
    OPEN_COLLECTION_DETAIL_STATE_KEY,
    ScopeToggleService,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { of } from 'rxjs';
import { createCollectionDetailState } from './unified-collection-detail-state';
import { CollectionViewStateHistory } from './unified-collection-history';
import { createCollectionScopeState } from './unified-collection-scope';

describe('dashboard favorite detail handoff', () => {
    afterEach(() => window.history.replaceState({}, document.title));

    it('clears pending presentation on Back and rejects a removed favorite after loading', () => {
        const saved: UnifiedCollectionItem = {
            uid: 'xtream::source::movie:77',
            name: 'Removed favorite',
            contentType: 'movie',
            sourceType: 'xtream',
            playlistId: 'source',
            playlistName: 'Source',
            favoriteId: 11,
            xtreamId: 77,
        };
        const historyState = {
            [OPEN_COLLECTION_DETAIL_STATE_KEY]: { item: saved },
        };
        window.history.replaceState(historyState, document.title);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: Router,
                    useValue: { url: '/workspace/global-favorites' },
                },
            ],
        });
        const isLoading = signal(true);
        const detail = TestBed.runInInjectionContext(() =>
            createCollectionDetailState({
                mode: signal('favorites'),
                items: signal([]),
                isLoading,
                portalType: signal(undefined),
                detailTemplate: signal({}),
                onOpen: jest.fn(),
                onClear: jest.fn(),
            })
        );
        expect(detail.isPending()).toBe(true);
        expect(detail.item()).toBeNull();

        window.history.replaceState({}, document.title);
        detail.syncFromHistory();
        expect(detail.isPending()).toBe(false);

        window.history.replaceState(historyState, document.title);
        detail.syncFromHistory();
        expect(detail.isPending()).toBe(true);
        isLoading.set(false);
        detail.syncFromHistory();
        expect(detail.isPending()).toBe(false);
        expect(detail.item()).toBeNull();
    });

    it.each(['movie', 'series'] as const)(
        'validates a %s from another playlist against the global collection',
        (type) => {
            const favorite = {
                id: 77,
                favorite_id: 11,
                title: 'Saved title',
                type,
                source: 'xtream' as const,
                playlist_id: 'source-B',
                playlist_name: 'Source B',
                xtream_id: 77,
                category_id: 12,
                poster_url: '',
                added_at: '2026-10-01T00:00:00.000Z',
                catalog_status: 'present' as const,
            };
            window.history.replaceState(
                getGlobalFavoriteNavigation(favorite).state,
                document.title
            );
            const paramMap = convertToParamMap({});
            TestBed.configureTestingModule({
                providers: [
                    {
                        provide: Router,
                        useValue: { url: '/workspace/global-favorites' },
                    },
                    {
                        provide: ActivatedRoute,
                        useValue: {
                            snapshot: { queryParamMap: paramMap },
                            queryParamMap: of(paramMap),
                        },
                    },
                    {
                        provide: ScopeToggleService,
                        useValue: { getScope: () => signal('playlist') },
                    },
                ],
            });
            const current = signal<UnifiedCollectionItem[]>([
                {
                    uid: `xtream::source-B::${type}:77`,
                    name: favorite.title,
                    contentType: type,
                    sourceType: 'xtream',
                    playlistId: 'source-B',
                    playlistName: 'Source B',
                    xtreamId: 77,
                    favoriteId: 11,
                    catalogStatus: 'present',
                },
            ]);
            const detail = TestBed.runInInjectionContext(() => {
                const history = new CollectionViewStateHistory();
                const scope = createCollectionScopeState({
                    scopeKey: signal('favorites'),
                    playlistId: signal('active-A'),
                    defaultScope: signal('playlist'),
                    historyScope: computed(() => history.current()?.scope),
                });
                return createCollectionDetailState({
                    mode: signal('favorites'),
                    items: computed(() =>
                        scope.effective() === 'all' ? current() : []
                    ),
                    isLoading: signal(false),
                    portalType: signal(undefined),
                    detailTemplate: signal({}),
                    onOpen: jest.fn(),
                    onClear: jest.fn(),
                });
            });
            detail.syncFromHistory();
            expect(detail.item()).toEqual(current()[0]);

            // The same handoff must not trust stale dashboard availability.
            current.set([{ ...current()[0], catalogStatus: 'missing' }]);
            detail.syncFromHistory();
            expect(detail.item()).toBeNull();

            window.history.replaceState(
                getGlobalFavoriteNavigation(favorite).state,
                document.title
            );
            current.set([]);
            detail.syncFromHistory();
            expect(detail.item()).toBeNull();
        }
    );
});
