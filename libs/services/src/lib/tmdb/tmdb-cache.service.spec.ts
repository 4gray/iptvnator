import { TmdbCacheEntry } from '@iptvnator/shared/interfaces';
import { TmdbCacheService } from './tmdb-cache.service';

/** PWA path only — window.electron is undefined in the jsdom environment */
describe('TmdbCacheService (in-memory LRU)', () => {
    let service: TmdbCacheService;

    const entry = (lookupKey: string): TmdbCacheEntry => ({
        mediaType: 'movie',
        lookupKey,
        language: 'en-US',
        tmdbId: 1,
        payload: '{}',
    });

    beforeEach(() => {
        // No Angular DI dependencies — instantiate directly (the services
        // Jest target has no @angular/core/testing available)
        service = new TmdbCacheService();
    });

    it('stores and returns entries with a fetchedAt stamp', async () => {
        await service.set(entry('id:1'));
        const cached = await service.get('movie', 'id:1', 'en-US');
        expect(cached?.lookupKey).toBe('id:1');
        expect(cached?.fetchedAt).toBeDefined();
    });

    it('evicts the least recently used entry beyond the ceiling', async () => {
        for (let i = 0; i < 300; i++) {
            await service.set(entry(`id:${i}`));
        }
        // Touch the oldest entry so it becomes the most recently used
        await service.get('movie', 'id:0', 'en-US');

        await service.set(entry('id:300'));

        // id:0 was touched and survives; id:1 was the true LRU and is gone
        await expect(service.get('movie', 'id:0', 'en-US')).resolves.not.toBeNull();
        await expect(service.get('movie', 'id:1', 'en-US')).resolves.toBeNull();
        await expect(
            service.get('movie', 'id:300', 'en-US')
        ).resolves.not.toBeNull();
    });

    it('does not grow when overwriting the same key', async () => {
        for (let i = 0; i < 5; i++) {
            await service.set(entry('id:same'));
        }
        const cached = await service.get('movie', 'id:same', 'en-US');
        expect(cached?.lookupKey).toBe('id:same');
    });
});
