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

    describe('stats and clearing (PWA path)', () => {
        it('counts entries and ENCODED payload bytes', async () => {
            // String.length would report 3 for a 6-byte Cyrillic payload
            await service.set({ ...entry('id:1'), payload: '"да"' });

            const stats = await service.getStats();
            expect(stats?.entries).toBe(1);
            expect(stats?.bytes).toBe(
                new TextEncoder().encode('"да"').length
            );
        });

        it('clears the map and reports how many entries went', async () => {
            await service.set(entry('id:1'));
            await service.set(entry('id:2'));

            await expect(service.clear()).resolves.toBe(2);
            await expect(service.getStats()).resolves.toEqual({
                entries: 0,
                bytes: 0,
            });
        });

        it('drops a write that was in flight when the cache was cleared', async () => {
            // Otherwise the late write silently restores exactly the data
            // the user just asked to remove
            const pending = service.set(entry('id:late'));
            await service.clear();
            await pending;

            await expect(
                service.get('movie', 'id:late', 'en-US')
            ).resolves.toBeNull();
        });
    });
});
