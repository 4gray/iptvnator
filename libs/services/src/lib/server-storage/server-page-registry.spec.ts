import {
    markUnconfirmed,
    othersUnconfirmed,
    UNCONFIRMED_TTL_MS,
} from './server-page-registry';

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
        keys: () => [...values.keys()],
    };
}

describe('unconfirmed entries across tabs', () => {
    it('lists other live tabs only and lets a tab clear just its record', () => {
        const local = memoryStorage();
        markUnconfirmed(local, 'db', 'a', ['xtream-favorites|p1'], 1_000);
        markUnconfirmed(local, 'db', 'b', ['xtream-favorites|p2'], 1_000);

        expect([...othersUnconfirmed(local, 'db', 'a', 2_000)]).toEqual([
            'xtream-favorites|p2',
        ]);

        markUnconfirmed(local, 'db', 'b', [], 3_000);
        expect([...othersUnconfirmed(local, 'db', 'b', 3_000)]).toEqual([
            'xtream-favorites|p1',
        ]);
    });

    it('ignores the record of a tab that is gone', () => {
        const local = memoryStorage();
        markUnconfirmed(local, 'db', 'a', ['xtream-favorites|p1'], 0);

        expect(
            othersUnconfirmed(local, 'db', 'b', UNCONFIRMED_TTL_MS + 1).size
        ).toBe(0);
    });
});
