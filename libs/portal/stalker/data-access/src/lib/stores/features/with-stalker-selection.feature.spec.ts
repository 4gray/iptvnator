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

    it('resets paging when the content type changes, but not when it repeats', () => {
        // Regression: /vod -> /series with the same category id ('*' on both
        // section roots) used to keep page > 1, so the new type's first
        // response was treated as an append onto the old type's list.
        store.setSelectedContentType('vod');
        store.setPage(3);

        store.setSelectedContentType('series');
        expect(store.page()).toBe(0);

        store.setPage(2);
        store.setSelectedContentType('series');
        expect(store.page()).toBe(2);
    });

    it('keeps paging when the search phrase is unchanged', () => {
        store.setSearchPhrase('matrix');
        store.setPage(2);

        store.setSearchPhrase('matrix');

        expect(store.searchPhrase()).toBe('matrix');
        expect(store.page()).toBe(2);
    });

    it('resets paging when the search phrase changes', () => {
        store.setPage(2);

        store.setSearchPhrase('matrix');

        expect(store.searchPhrase()).toBe('matrix');
        expect(store.page()).toBe(0);
    });

    it('preserves ITV pages when a local search changes or clears', () => {
        store.setSelectedContentType('itv');
        store.setPage(2);
        store.setSearchPhrase('shared');
        expect(store.page()).toBe(2);
        store.setSearchPhrase('');
        expect(store.page()).toBe(2);
    });

    it('synchronizes entity ids when the selected item changes', () => {
        store.setSelectedItem({
            id: '55',
            name: 'Example',
        });

        expect(store.selectedVodId()).toBe('55');
        expect(store.selectedItvId()).toBe('55');
    });

    it('sets the serial id for a regular series selection', () => {
        store.setSelectedContentType('series');

        store.setSelectedItem({
            id: '55',
            name: 'Regular series',
        });

        expect(store.selectedSerialId()).toBe('55');
    });

    it('does not set the serial id for a plain VOD selection', () => {
        store.setSelectedContentType('vod');

        store.setSelectedItem({
            id: '55',
            name: 'Plain movie',
        });

        expect(store.selectedSerialId()).toBeUndefined();
        expect(store.selectedVodId()).toBe('55');
    });

    it('does not set the serial id for items with embedded series episodes', () => {
        // vclub items carry their episodes inline and are always opened
        // under the VOD content type.
        store.setSelectedContentType('vod');

        store.setSelectedItem({
            id: '55',
            name: 'Embedded series',
            series: [1, 2, 3],
        });

        expect(store.selectedSerialId()).toBeUndefined();
    });

    it('still sets the serial id for a series selection carrying is_series', () => {
        // Under the `series` content type the seasons API is the only
        // episode source, so the fetch must not be gated on item shape.
        store.setSelectedContentType('series');

        store.setSelectedItem({
            id: '55',
            name: 'Series flagged is_series',
            is_series: '1',
        });

        expect(store.selectedSerialId()).toBe('55');
    });

    it('still sets the serial id for a series selection carrying series[]', () => {
        store.setSelectedContentType('series');

        store.setSelectedItem({
            id: '55',
            name: 'Series carrying series[]',
            series: [1, 2, 3],
        });

        expect(store.selectedSerialId()).toBe('55');
    });

    it('does not set the serial id for Ministra VOD-series items', () => {
        store.setSelectedContentType('vod');

        store.setSelectedItem({
            id: '55',
            name: 'VOD series',
            is_series: '1',
        });

        expect(store.selectedSerialId()).toBeUndefined();
    });

    it('clears a stale serial id when a non-series item is selected', () => {
        store.setSelectedContentType('series');
        store.setSelectedItem({ id: '55', name: 'Regular series' });
        expect(store.selectedSerialId()).toBe('55');

        store.setSelectedContentType('vod');
        store.setSelectedItem({ id: '77', name: 'Plain movie' });

        expect(store.selectedSerialId()).toBeUndefined();
        expect(store.selectedVodId()).toBe('77');
    });
});
