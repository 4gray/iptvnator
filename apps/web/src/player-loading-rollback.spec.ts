import {
    EAGER_PLAYER_LOADING_KEY,
    preparePlayerLoading,
} from './player-loading-rollback';

describe('preparePlayerLoading', () => {
    it('keeps deferred startup unless the rollback is explicitly enabled', () => {
        const load = jest.fn(() => Promise.resolve());
        for (const value of [null, '0', 'false']) {
            expect(
                preparePlayerLoading(load, { getItem: () => value })
            ).toBeUndefined();
        }
        expect(load).not.toHaveBeenCalled();
    });

    it('returns the eager loading promise so bootstrap waits for the engines', async () => {
        let finish!: () => void;
        const pending = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const load = jest.fn(() => pending);
        const storage = { getItem: jest.fn(() => '1') };
        const result = preparePlayerLoading(load, storage);
        expect(result).toBe(pending);
        expect(load).toHaveBeenCalledTimes(1);
        expect(storage.getItem).toHaveBeenCalledWith(EAGER_PLAYER_LOADING_KEY);
        finish();
        await result;
    });

    it('does not block startup when storage access is denied', () => {
        const load = jest.fn(() => Promise.resolve());
        expect(
            preparePlayerLoading(load, {
                getItem: () => {
                    throw new Error('blocked');
                },
            })
        ).toBeUndefined();
        expect(load).not.toHaveBeenCalled();
    });
});
