import { TestBed } from '@angular/core/testing';
import { computed } from '@angular/core';
import { patchState, signalStore, withState } from '@ngrx/signals';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { withSelection } from './with-selection.feature';

const TestPwaVisibleContentStore = signalStore(
    withState({
        vodCategories: [{ id: 30, category_id: '30' }],
        vodStreams: [
            { category_id: '', title: 'Uncategorized PWA item' },
            { category_id: '99', title: 'Unknown-category PWA item' },
        ],
    }),
    withSelection()
);

const TestVisibleContentStore = signalStore(
    { protectedState: false },
    withState({
        liveCategories: [
            { id: 10, xtream_id: 1010, hidden: false },
            { id: 20, xtream_id: 1020, hidden: true },
        ],
        liveStreams: [
            { category_id: '10', title: 'Visible Night News' },
            { category_id: '20', title: 'Hidden Night News' },
        ],
        vodCategories: [{ id: 30, xtream_id: 1030 }],
        vodStreams: [
            { category_id: '30', title: 'Visible Night Film' },
            // Electron's visible-category read omits hidden categories.
            { category_id: '40', title: 'Hidden Night Film' },
        ],
        serialCategories: [
            { id: 50, xtream_id: 1050, hidden: false },
            { id: 60, xtream_id: 1060, hidden: true },
        ],
        serialStreams: [
            { category_id: '50', title: 'Visible Night Series' },
            { category_id: '60', title: 'Hidden Night Series' },
        ],
    }),
    withSelection()
);

describe('withSelection visible content', () => {
    let store: InstanceType<typeof TestVisibleContentStore>;
    let runtime: {
        isElectron: boolean;
        supportsXtreamSqliteDataSource: boolean;
    };

    beforeEach(() => {
        runtime = {
            isElectron: true,
            supportsXtreamSqliteDataSource: true,
        };
        TestBed.configureTestingModule({
            providers: [
                TestVisibleContentStore,
                TestPwaVisibleContentStore,
                { provide: RuntimeCapabilitiesService, useValue: runtime },
            ],
        });
        store = TestBed.inject(TestVisibleContentStore);
    });

    it.each([
        ['live', 'Visible Night News'],
        ['vod', 'Visible Night Film'],
        ['series', 'Visible Night Series'],
    ] as const)(
        'keeps hidden-category %s items out of the all-items search',
        (contentType, visibleTitle) => {
            expect(
                store
                    .getVisibleContentByType()(contentType)
                    .map((item) => item.title)
            ).toEqual([visibleTitle]);

            store.setSelectedContentType(contentType);
            store.setSelectedCategory(null);
            store.setCategorySearchTerm('night');

            expect(
                store
                    .selectItemsFromSelectedCategory()
                    .map((item) => item.title)
            ).toEqual([visibleTitle]);
        }
    );

    it('keeps hidden-category items out of the unsearched all-items view', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(null);

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['Visible Night Film']);
    });

    it.each(['live', 'vod', 'series'] as const)(
        'reacts when all %s categories are hidden and then restored',
        (contentType) => {
            const categories = {
                liveCategories: store.liveCategories(),
                vodCategories: store.vodCategories(),
                serialCategories: store.serialCategories(),
            };
            const getVisibleContent = store.getVisibleContentByType();
            // Recently Added captures this function once, then calls it
            // inside computed rails. Category reloads must invalidate them.
            const rail = computed(() => getVisibleContent(contentType));
            store.setSelectedContentType(contentType);
            store.setCategorySearchTerm('night');
            const visibleItems = rail();
            expect(visibleItems).toHaveLength(1);
            expect(store.selectItemsFromSelectedCategory()).toEqual(
                visibleItems
            );

            patchState(store, {
                liveCategories: [],
                vodCategories: [],
                serialCategories: [],
            });
            expect(rail()).toEqual([]);
            expect(store.selectItemsFromSelectedCategory()).toEqual([]);

            patchState(store, categories);
            expect(rail()).toEqual(visibleItems);
            expect(store.selectItemsFromSelectedCategory()).toEqual(
                visibleItems
            );
        }
    );

    it('preserves uncategorized items when the SQLite source is unavailable', () => {
        // Simulate a partial/older Electron bridge that uses the PWA source.
        runtime.supportsXtreamSqliteDataSource = false;
        const pwaStore = TestBed.inject(TestPwaVisibleContentStore);
        pwaStore.setSelectedContentType('vod');
        pwaStore.setSelectedCategory(null);

        expect(
            pwaStore
                .getVisibleContentByType()('vod')
                .map((item) => item.title)
        ).toEqual(['Uncategorized PWA item', 'Unknown-category PWA item']);
        expect(
            pwaStore.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['Uncategorized PWA item', 'Unknown-category PWA item']);
    });
});
