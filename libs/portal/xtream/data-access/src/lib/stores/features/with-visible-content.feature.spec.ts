import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import { withSelection } from './with-selection.feature';

const TestVisibleContentStore = signalStore(
    withState({
        liveCategories: [
            { id: 10, category_id: '10', hidden: false },
            { id: 20, category_id: '20', hidden: true },
        ],
        liveStreams: [
            { category_id: '10', title: 'Visible Night News' },
            { category_id: '20', title: 'Hidden Night News' },
        ],
        vodCategories: [{ id: 30, category_id: '30' }],
        vodStreams: [
            { category_id: '30', title: 'Visible Night Film' },
            // Electron's visible-category read omits hidden categories.
            { category_id: '40', title: 'Hidden Night Film' },
        ],
        serialCategories: [
            { id: 50, category_id: '50', hidden: false },
            { id: 60, category_id: '60', hidden: true },
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

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [TestVisibleContentStore],
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
});
