import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { enrichStalkerSelectionWithTmdb } from '../stalker-tmdb-enrichment';
import { withStalkerSelection } from './with-stalker-selection.feature';

jest.mock('../stalker-tmdb-enrichment', () => ({
    ...jest.requireActual('../stalker-tmdb-enrichment'),
    enrichStalkerSelectionWithTmdb: jest.fn(),
}));

const TestSelectionStore = signalStore(withStalkerSelection());
const enrich = enrichStalkerSelectionWithTmdb as jest.MockedFunction<
    typeof enrichStalkerSelectionWithTmdb
>;

/** A TMDB match that settles when the test says so. */
function deferredMatch(): () => void {
    let finish!: () => void;
    enrich.mockReturnValueOnce(
        new Promise<void>((resolve) => (finish = resolve))
    );
    return () => finish();
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('withStalkerSelection TMDB pending flag', () => {
    let store: InstanceType<typeof TestSelectionStore>;

    beforeEach(() => {
        enrich.mockReset();
        TestBed.configureTestingModule({
            providers: [
                TestSelectionStore,
                {
                    provide: TmdbEnrichmentService,
                    useValue: { isEnabled: () => true },
                },
            ],
        });
        store = TestBed.inject(TestSelectionStore);
    });

    it('stays pending when an earlier match of the reopened item settles', async () => {
        const finishFirst = deferredMatch();
        store.setSelectedItem({ id: '55', name: 'Series', is_series: 1 });
        const finishSecond = deferredMatch();
        store.setSelectedItem({ id: '55', name: 'Series', is_series: 1 });
        expect(store.selectedItemTmdbPending()).toBe(true);

        finishFirst();
        await flush();
        expect(store.selectedItemTmdbPending()).toBe(true);

        finishSecond();
        await flush();
        expect(store.selectedItemTmdbPending()).toBe(false);
    });

    it('clears the flag for an item without an id', async () => {
        const finish = deferredMatch();
        store.setSelectedItem({ name: 'No id series', is_series: 1 });
        expect(store.selectedItemTmdbPending()).toBe(true);

        finish();
        await flush();
        expect(store.selectedItemTmdbPending()).toBe(false);
    });
});
