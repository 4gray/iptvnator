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

describe('history delivery', () => {
    it('drops the queue of a deleted profile instead of failing forever', async () => {
        const records = new Map<string, HistoryRecord>();
        const memory: HistoryStore = {
            read: async () => records.get('r') ?? null,
            mutate: async (_s, update) => {
                const next = update(records.get('r') ?? null);
                records.set('r', next);
                return next;
            },
        } as HistoryStore;
        const request = jest.fn(async (input: { operation: string }) =>
            input.operation === 'history-read'
                ? {
                      status: 200,
                      body: {
                          scope: { ...base, personalScope: KIDS },
                          state: emptyHistoryState(),
                      },
                  }
                : { status: 409, body: { code: 'profile_missing' } }
        );
        const client = new HistorySyncClient(memory, {
            instanceId: 'nas',
            deviceId: 'device',
            consent: () => 'consent',
            active: () => true,
            request: request as never,
            changed: jest.fn(),
            remember: jest.fn(),
            scope: KIDS,
        });
        await client.command('source', {
            kind: 'touch',
            reference: { provider: 'xtream', kind: 'movie', id: '42' },
        });
        await expect(client.flush('source')).resolves.toBeUndefined();
        expect(records.get('r')?.pending).toEqual([]);
    });
});
