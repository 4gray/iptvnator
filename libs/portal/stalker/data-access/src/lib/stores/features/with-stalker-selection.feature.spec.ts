import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import { withStalkerSelection } from './with-stalker-selection.feature';

const TestSelectionStore = signalStore(withStalkerSelection());

describe('withStalkerSelection', () => {
    let store: InstanceType<typeof TestSelectionStore>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [TestSelectionStore],
        });

        store = TestBed.inject(TestSelectionStore);
    });

    it('resets paging when the selected category changes', () => {
        store.setPage(3);
        store.setSelectedCategory('series-7');

        expect(store.selectedCategoryId()).toBe('series-7');
        expect(store.page()).toBe(0);
    });

    it('synchronizes entity ids when the selected item changes', () => {
        store.setSelectedItem({
            id: '55',
            name: 'Example',
        });

        expect(store.selectedVodId()).toBe('55');
        expect(store.selectedSerialId()).toBe('55');
        expect(store.selectedItvId()).toBe('55');
    });
});
