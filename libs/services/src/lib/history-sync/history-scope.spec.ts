import { HistorySyncClient } from './history-client';
import {
    emptyHistoryState,
    type HistoryRecord,
    type HistoryScope,
    type HistoryStore,
} from '@iptvnator/shared/interfaces/history-sync';
import type { PersonalScope } from '@iptvnator/shared/interfaces/profiles';

const KIDS: PersonalScope = 'profile:11111111-1111-4111-8111-111111111111';
const base: HistoryScope = {
    instanceId: 'nas',
    sourceId: 'source',
    sourceIncarnation: 'first',
    provider: 'xtream',
};
const store: HistoryStore = {
    read: async () => null as HistoryRecord | null,
    mutate: async (_s, update) => update(null),
} as HistoryStore;

function build(scope?: PersonalScope, answered?: HistoryScope) {
    const request = jest.fn(async () => ({
        status: 200,
        body: { scope: answered ?? base, state: emptyHistoryState() },
    }));
    const client = new HistorySyncClient(store, {
        instanceId: 'nas',
        deviceId: 'device',
        consent: () => 'consent',
        active: () => true,
        request,
        changed: jest.fn(),
        remember: jest.fn(),
        ...(scope ? { scope } : {}),
    });
    return { client, request };
}

describe('history scope', () => {
    it('reads the profile history with its scope', async () => {
        const { client, request } = build(KIDS, {
            ...base,
            personalScope: KIDS,
        });
        await client.refresh('source');
        expect(request).toHaveBeenCalledWith({
            operation: 'history-read',
            id: 'source',
            scope: KIDS,
        });
    });

    it('sends nothing extra for the Default profile', async () => {
        const { client, request } = build();
        await client.refresh('source');
        expect(request).toHaveBeenCalledWith({
            operation: 'history-read',
            id: 'source',
        });
    });

    it('refuses an answer for another scope', async () => {
        await expect(build(KIDS).client.refresh('source')).rejects.toThrow(
            'History response scope mismatch'
        );
        await expect(
            build(undefined, { ...base, personalScope: KIDS }).client.refresh(
                'source'
            )
        ).rejects.toThrow('History response scope mismatch');
    });
});
