import { FavoritesSyncClient } from './favorites-sync-client';
import {
    favoriteSourceContextsKey,
    observeFavoriteSourceRetirement,
    retireFavoriteSourceContext,
} from './favorites-source-contexts';
import type { FavoriteLocalStore } from '@iptvnator/shared/interfaces/favorites-sync';

afterEach(() => localStorage.clear());

function fixture() {
    const contexts = ['synthetic-source', 'synthetic-other'].map(
        (sourceId) => ({
            sourceId,
            sourceIncarnation: 'old',
            provider: 'm3u' as const,
        })
    );
    const key = favoriteSourceContextsKey('synthetic-instance');
    localStorage.setItem(key, JSON.stringify(contexts));
    const mutate = jest.fn();
    const remember = jest.fn();
    const client = new FavoritesSyncClient(
        { mutate } as unknown as FavoriteLocalStore,
        {
            instanceId: 'synthetic-instance',
            deviceId: 'synthetic-device',
            consent: () => null,
            contexts,
            remember,
            changed: jest.fn(),
            request: jest.fn(),
        }
    );
    return { client, contexts, key, mutate, remember };
}

it('retires persisted and live contexts while disabled without removing durable data or another profile', async () => {
    const f = fixture();
    const otherKey = favoriteSourceContextsKey('synthetic-other-instance');
    localStorage.setItem(otherKey, JSON.stringify(f.contexts));
    const stop = observeFavoriteSourceRetirement(() => f.client);
    try {
        retireFavoriteSourceContext('synthetic-instance', 'synthetic-source');
        expect(f.client.contexts.has('synthetic-source')).toBe(false);
        expect(f.client.contexts.has('synthetic-other')).toBe(true);
        expect(JSON.parse(localStorage.getItem(f.key)!)).toEqual([
            f.contexts[1],
        ]);
        expect(JSON.parse(localStorage.getItem(otherKey)!)).toEqual(f.contexts);
        await expect(
            f.client.setLocal(
                'synthetic-source',
                { provider: 'm3u', version: 1, urlHash: 'a'.repeat(64) },
                true
            )
        ).rejects.toThrow('Favorite source unavailable');
        expect(f.mutate).not.toHaveBeenCalled();
        expect(f.remember).not.toHaveBeenCalled();
    } finally {
        stop();
    }
});

it('observes another tab retiring a context without rewriting that tab’s cache', () => {
    const f = fixture();
    retireFavoriteSourceContext('synthetic-instance', 'synthetic-source');
    const stop = observeFavoriteSourceRetirement(() => f.client);
    try {
        const key = `${f.key}:retired`;
        const newValue = localStorage.getItem(key)!;
        window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
        expect(f.client.contexts.has('synthetic-source')).toBe(false);
        expect(f.client.contexts.has('synthetic-other')).toBe(true);
        expect(f.remember).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem(f.key)!)).toEqual([
            f.contexts[1],
        ]);
    } finally {
        stop();
    }
});

it('does not interpret another tab’s ordinary cache write as a source retirement', () => {
    const f = fixture();
    const stop = observeFavoriteSourceRetirement(() => f.client);
    try {
        window.dispatchEvent(
            new StorageEvent('storage', { key: f.key, newValue: '[]' })
        );
        expect(f.client.contexts.size).toBe(2);
        expect(f.remember).not.toHaveBeenCalled();
    } finally {
        stop();
    }
});

it('retires cached contexts before the runtime starts and releases listeners on destruction', () => {
    const f = fixture();
    const stop = observeFavoriteSourceRetirement(() => f.client);
    stop();
    retireFavoriteSourceContext('synthetic-instance', 'synthetic-source');
    expect(f.client.contexts.has('synthetic-source')).toBe(true);
    expect(JSON.parse(localStorage.getItem(f.key)!)).toEqual([f.contexts[1]]);
});
