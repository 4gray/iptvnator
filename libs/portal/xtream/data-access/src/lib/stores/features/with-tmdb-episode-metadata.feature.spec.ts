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
});
