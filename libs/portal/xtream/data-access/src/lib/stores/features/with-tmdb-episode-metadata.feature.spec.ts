import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import {
    tmdbSeasonMetadataKey,
    tmdbShowMetadataKey,
    withTmdbEpisodeMetadata,
} from './with-tmdb-episode-metadata.feature';

const TestStore = signalStore(withTmdbEpisodeMetadata());

describe('withTmdbEpisodeMetadata', () => {
    let store: InstanceType<typeof TestStore>;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [TestStore] });
        store = TestBed.inject(TestStore);
    });

    it('marks a lookup pending until it settles', async () => {
        let finish!: () => void;
        const work = new Promise<void>((resolve) => (finish = resolve));
        const key = tmdbSeasonMetadataKey(42, '2');

        const tracked = store.trackTmdbEpisodeMetadata(key, work);
        expect(store.tmdbEpisodeMetadata()[key]).toBe('pending');

        finish();
        await tracked;
        expect(store.tmdbEpisodeMetadata()[key]).toBe('settled');
    });

    it('settles a failed lookup too', async () => {
        const key = tmdbShowMetadataKey(42);
        await expect(
            store.trackTmdbEpisodeMetadata(key, Promise.reject(new Error('x')))
        ).rejects.toThrow('x');
        expect(store.tmdbEpisodeMetadata()[key]).toBe('settled');
    });
    it('keeps a settled season settled when its enrichment re-runs', async () => {
        const key = tmdbSeasonMetadataKey(42, '1');
        await store.trackTmdbEpisodeMetadata(key, Promise.resolve());

        let finish!: () => void;
        const rerun = store.trackTmdbEpisodeMetadata(
            key,
            new Promise<void>((resolve) => (finish = resolve)),
            { keepSettled: true }
        );
        expect(store.tmdbEpisodeMetadata()[key]).toBe('settled');
        finish();
        await rerun;
        expect(store.tmdbEpisodeMetadata()[key]).toBe('settled');
    });

    it('lets only the latest lookup of a key settle it', async () => {
        const key = tmdbShowMetadataKey(42);
        let finishFirst!: () => void;
        const first = store.trackTmdbEpisodeMetadata(
            key,
            new Promise<void>((resolve) => (finishFirst = resolve))
        );
        let finishSecond!: () => void;
        const second = store.trackTmdbEpisodeMetadata(
            key,
            new Promise<void>((resolve) => (finishSecond = resolve))
        );

        finishFirst();
        await first;
        expect(store.tmdbEpisodeMetadata()[key]).toBe('pending');

        finishSecond();
        await second;
        expect(store.tmdbEpisodeMetadata()[key]).toBe('settled');
    });

    it("forgets a series' seasons on a new visit, also against lookups in flight", async () => {
        const settled = tmdbSeasonMetadataKey(42, '1');
        const inFlight = tmdbSeasonMetadataKey(42, '2');
        const other = tmdbSeasonMetadataKey(7, '1');
        await store.trackTmdbEpisodeMetadata(settled, Promise.resolve());
        await store.trackTmdbEpisodeMetadata(other, Promise.resolve());
        let finish!: () => void;
        const stale = store.trackTmdbEpisodeMetadata(
            inFlight,
            new Promise<void>((resolve) => (finish = resolve))
        );

        store.resetTmdbSeasonMetadata(42);
        finish();
        await stale;

        expect(store.tmdbEpisodeMetadata()[settled]).toBeUndefined();
        expect(store.tmdbEpisodeMetadata()[inFlight]).toBeUndefined();
        expect(store.tmdbEpisodeMetadata()[other]).toBe('settled');
    });
});
