import { ParentalLockStaleIndex } from './parental-lock-stale-index';

describe('ParentalLockStaleIndex', () => {
    it('marks several playlists at once and makes them retryable', () => {
        const index = new ParentalLockStaleIndex();
        index.markInFlight('pl-1');

        index.mark('pl-1', 'pl-2');

        expect(index.isEmpty()).toBe(false);
        expect(index.ids().sort()).toEqual(['pl-1', 'pl-2']);
    });

    it('keeps an in-flight playlist stale but out of the retry list', () => {
        const index = new ParentalLockStaleIndex();

        index.markInFlight('pl-1');

        expect(index.isEmpty()).toBe(false);
        expect(index.ids()).toEqual([]);
    });

    it('drops the playlists a reconcile re-stamped', async () => {
        const index = new ParentalLockStaleIndex();
        index.mark('pl-1', 'pl-2');
        const error = jest.spyOn(console, 'error').mockImplementation();

        const changed = await index.reconcile(async (id) => {
            if (id === 'pl-2') {
                throw new Error('stamp failed');
            }
            return true;
        });

        expect(changed).toBe(true);
        expect(index.ids()).toEqual(['pl-2']);
        index.clear();
        expect(index.isEmpty()).toBe(true);
        error.mockRestore();
    });
});
