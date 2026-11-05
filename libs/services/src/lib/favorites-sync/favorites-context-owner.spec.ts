import { FavoritesSyncClient } from './favorites-sync-client';
import { captureFavoriteOwner } from './favorites-context-owner';
import { FavoriteSupersededError } from './favorites-sync-errors';
import type { FavoriteLocalStore } from '@iptvnator/shared/interfaces/favorites-sync';

it.each(['profile', 'consent', 'incarnation', 'removed'] as const)(
    'rejects a delayed favorite action after %s ownership changes',
    (change) => {
        let active = true;
        let consent: string | null = null;
        const client = new FavoritesSyncClient({} as FavoriteLocalStore, {
            instanceId: 'synthetic-instance',
            deviceId: 'synthetic-device',
            consent: () => consent,
            profileActive: () => active,
            request: jest.fn(),
            remember: jest.fn(),
            changed: jest.fn(),
            contexts: [
                {
                    sourceId: 'synthetic-source',
                    sourceIncarnation: 'first',
                    provider: 'm3u',
                },
            ],
        });
        const assertCurrent = captureFavoriteOwner(client, 'synthetic-source');
        expect(assertCurrent).not.toThrow();
        if (change === 'profile') active = false;
        if (change === 'consent') consent = 'new';
        if (change === 'removed') client.forget('synthetic-source', false);
        if (change === 'incarnation')
            client.contexts.set('synthetic-source', {
                sourceId: 'synthetic-source',
                sourceIncarnation: 'second',
                provider: 'm3u',
            });
        expect(assertCurrent).toThrow(FavoriteSupersededError);
    }
);
