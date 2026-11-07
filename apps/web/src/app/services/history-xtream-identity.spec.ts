import type { HistorySyncClient } from '@iptvnator/services/history-sync';
import {
    applyHistoryOperation,
    emptyHistoryState,
} from '@iptvnator/shared/interfaces/history-sync';
import { HistoryXtreamAdapter } from './history-xtream-adapter';

describe('received Xtream history with a conflicting archive', () => {
    it.each(
        [true, false].flatMap((sqlite) =>
            ['confirmed', 'missing', 'unknown', 'conflict', 'marked'].map(
                (result) => [sqlite, result] as const
            )
        )
    )(
        'uses only a confirmed replacement, sqlite=%s result=%s',
        async (sqlite, result) => {
            const state = applyHistoryOperation(emptyHistoryState(), {
                kind: 'touch',
                reference: { provider: 'xtream', kind: 'movie', id: '42' },
                snapshot: {
                    title: 'Synthetic received item',
                    tmdbId: '200',
                    releaseYear: '2024',
                    ...(result === 'marked' ? { identityConflict: true } : {}),
                },
                operationId: 'synthetic-watch',
                deviceId: 'synthetic-device',
                baseRevision: 0,
                viewedAt: 1,
            }).state;
            const client = {
                contexts: new Map(),
                state: async () => state,
                current: () => undefined,
            } as unknown as HistorySyncClient;
            const original = {
                id: 1,
                xtream_id: 42,
                type: 'movie',
                title: 'Synthetic archived item',
                tmdb_id: 100,
                release_year: 2001,
                category_id: 1,
                viewed_at: '2026-01-01T00:00:00Z',
            };
            const found =
                result === 'missing'
                    ? null
                    : {
                          ...original,
                          id: 2,
                          category_id: 2,
                          title: 'Synthetic compatible item',
                          tmdb_id:
                              result === 'unknown'
                                  ? undefined
                                  : result === 'conflict'
                                    ? 300
                                    : 200,
                          release_year: result === 'unknown' ? undefined : 2024,
                      };
            const lookup = jest.fn(
                async (
                    _id: number,
                    _source: string,
                    _kind: string,
                    identity?: { tmdbId?: number }
                ) => (identity ? found : original)
            );
            const raw = {
                getRecentItems: async () => [original],
                getContentByXtreamId: lookup,
                getAllCategories: async () => [
                    { id: 1, locked: false },
                    { id: 2, locked: false },
                ],
            };
            const rows = await new HistoryXtreamAdapter(client, sqlite, {
                active: () => true,
                withholdsEverything: () => false,
                version: () => 0,
            }).project(raw as never, 'synthetic-source');
            expect(rows).toEqual(
                result === 'confirmed'
                    ? [
                          expect.objectContaining({
                              id: 2,
                              xtream_id: 42,
                              tmdb_id: 200,
                              release_year: 2024,
                              title: 'Synthetic compatible item',
                          }),
                      ]
                    : []
            );
            if (result === 'confirmed')
                expect(lookup).toHaveBeenCalledWith(
                    42,
                    'synthetic-source',
                    'movie',
                    { tmdbId: 200, releaseYear: 2024 },
                    undefined,
                    true
                );
        }
    );
});
