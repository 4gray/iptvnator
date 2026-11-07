import { HistorySyncRuntime } from './history-sync-runtime';
import { HistorySyncClient } from '@iptvnator/services/history-sync';
import type { HistoryScope } from '@iptvnator/shared/interfaces/history-sync';

it.each([
    ['invoke', 'profile'],
    ['invoke', 'source'],
    ['mutate', 'profile'],
    ['mutate', 'source'],
] as const)(
    'discards %s results if the %s changes during summary storage reads',
    async (method, change) => {
        let active = true;
        const scope: HistoryScope = {
            instanceId: 'nas',
            sourceId: 'source',
            sourceIncarnation: 'first',
            provider: 'xtream',
        };
        const client = new HistorySyncClient(
            {
                read: async () => null,
                mutate: async () => {
                    throw new Error('unused');
                },
            },
            {
                instanceId: 'nas',
                deviceId: 'device',
                active: () => active,
                consent: () => null,
                contexts: [scope],
                remember: () => undefined,
                changed: () => undefined,
                request: async () => {
                    throw new Error('unused');
                },
            }
        );
        const runtime = Object.assign(
            Object.create(HistorySyncRuntime.prototype),
            {
                ensure: () => client,
                xtream: { invoke: async () => ['old source projection'] },
                adapter: {
                    mutate: async () => ({
                        recentlyViewed: ['old source projection'],
                    }),
                },
                error: { set: jest.fn() },
                summary: async () => {
                    if (change === 'profile') active = false;
                    else
                        client.contexts.set('source', {
                            ...scope,
                            sourceIncarnation: 'replacement',
                        });
                },
            }
        ) as HistorySyncRuntime;
        await expect(
            method === 'invoke'
                ? runtime.invoke({} as never, 'getRecentItems', ['source'])
                : runtime.mutate({ _id: 'source' } as never, { kind: 'clear' })
        ).rejects.toThrow('storage failed');
    }
);
