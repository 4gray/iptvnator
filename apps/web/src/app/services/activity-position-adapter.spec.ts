import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import type { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import { ActivityPositionAdapter } from './activity-position-adapter';

describe('activity projection local preservation', () => {
    it('carries Stalker episode resets into series reads and the durable local mirror', async () => {
        const legacy: PlaybackPositionData = {
            contentType: 'episode',
            contentXtreamId: 501,
            seriesXtreamId: 100,
            seasonNumber: 1,
            episodeNumber: 2,
            positionSeconds: 95,
            durationSeconds: 100,
        };
        const reset: PlaybackPositionData = {
            ...legacy,
            contentXtreamId: 1001,
            positionSeconds: 0,
            durationSeconds: undefined,
            watched: false,
            activityIdentity: {
                provider: 'stalker',
                kind: 'episode',
                mode: 'lazy',
                seriesId: '100',
                id: 'synthetic-episode',
                seasonKey: '1',
                episodeNumber: 2,
            },
        };
        const client = {
            options: { changed: () => undefined },
            aliases: new Map(),
            localSessions: new Map(),
            retiredSessions: new Set(),
            positions: async () => [
                { position: reset, reset: true, conflict: false },
            ],
        } as unknown as ActivitySyncClient;
        const rows = new Map([[legacy.contentXtreamId, legacy]]);
        const raw = {
            getAllPlaybackPositions: async () => [...rows.values()],
            savePlaybackPosition: async (
                _source: string,
                position: PlaybackPositionData
            ) => {
                rows.set(position.contentXtreamId, position);
            },
            clearPlaybackPosition: async (_source: string, id: number) => {
                rows.delete(id);
            },
        } as unknown as IXtreamDataSource;
        const adapter = new ActivityPositionAdapter(client);
        const series = await adapter.invoke(raw, 'getSeriesPlaybackPositions', [
            'synthetic-source',
            100,
        ]);
        const exported = await adapter.exportPositions('synthetic-source', [
            ...rows.values(),
        ]);
        expect(exported).toEqual(
            expect.arrayContaining([
                legacy,
                expect.objectContaining({
                    contentXtreamId: 1001,
                    positionSeconds: 0,
                    durationSeconds: 0,
                }),
            ])
        );
        expect(series).toEqual([
            legacy,
            expect.objectContaining({
                contentXtreamId: 1001,
                positionSeconds: 0,
                watched: false,
            }),
        ]);
        const strict = {
            save: jest.fn(async () => {
                throw new Error('Synthetic mirror failure');
            }),
            clear: jest.fn(),
        };
        await expect(
            new ActivityPositionAdapter(client, strict).keepLocal(
                raw,
                'synthetic-source'
            )
        ).rejects.toThrow('Synthetic mirror failure');
        expect(rows.has(1001)).toBe(false);
        expect(rows.get(501)).toEqual(legacy);
        expect(strict.clear).not.toHaveBeenCalled();
        await adapter.keepLocal(raw, 'synthetic-source');
        expect(rows.get(1001)).toEqual(
            expect.objectContaining({ positionSeconds: 0, watched: false })
        );
        expect(rows.get(501)).toEqual(legacy);
        await adapter.invoke(
            raw,
            'clearPlaybackPosition',
            ['synthetic-source', 1001, 'episode'],
            true
        );
        expect(rows.get(1001)).toEqual(
            expect.objectContaining({ positionSeconds: 0, watched: false })
        );
    });

    it.each(['checkpoint', 'reset', 'failed-save'] as const)(
        'does not let a delayed shared fallback overwrite a newer local %s',
        async (action) => {
            const position: PlaybackPositionData = {
                contentType: 'vod',
                contentXtreamId: 42,
                positionSeconds: 50,
                durationSeconds: 100,
                activitySessionId: 'synthetic-session',
            };
            let release!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const client = {
                sessions: new Map(),
                aliases: new Map(),
                localSessions: new Map(),
                retiredSessions: new Set(),
                options: { changed: () => undefined },
                positions: async () => [],
                save: jest.fn(async () => {
                    await held;
                    if (action === 'failed-save')
                        throw new Error('Synthetic delayed failure');
                    return 'local-only';
                }),
            } as unknown as ActivitySyncClient;
            let row: PlaybackPositionData | undefined;
            const raw = {
                savePlaybackPosition: async (
                    _id: string,
                    value: PlaybackPositionData
                ) => {
                    row = value;
                },
                getAllPlaybackPositions: async () => (row ? [row] : []),
                clearPlaybackPosition: async () => {
                    row = undefined;
                },
            } as unknown as IXtreamDataSource;
            const adapter = new ActivityPositionAdapter(client);
            const older = adapter.invoke(raw, 'savePlaybackPosition', [
                'synthetic-source',
                position,
            ]);
            if (action === 'reset')
                await adapter.invoke(
                    raw,
                    'clearPlaybackPosition',
                    ['synthetic-source', 42, 'vod'],
                    true
                );
            else
                await adapter.invoke(
                    raw,
                    'savePlaybackPosition',
                    ['synthetic-source', { ...position, positionSeconds: 75 }],
                    true
                );
            release();
            if (action === 'failed-save')
                await expect(older).rejects.toThrow(
                    'Synthetic delayed failure'
                );
            else await older;
            if (action === 'reset') expect(row).toBeUndefined();
            else expect(row?.positionSeconds).toBe(75);
        }
    );

    it('routes an explicit watched action through shared projection instead of the local mirror', async () => {
        let shared: PlaybackPositionData = {
            contentType: 'vod',
            contentXtreamId: 1,
            positionSeconds: 20,
            durationSeconds: 100,
        };
        const save = jest.fn(
            async (_source: string, position: PlaybackPositionData) => {
                shared = { ...position, watched: true };
            }
        );
        const client = {
            save,
            positions: async () => [
                { position: shared, reset: false, conflict: false },
            ],
        } as unknown as ActivitySyncClient;
        const raw = {
            savePlaybackPosition: jest.fn(async () => undefined),
            getAllPlaybackPositions: async () => [],
        } as unknown as IXtreamDataSource;
        const adapter = new ActivityPositionAdapter(client);
        const explicit: PlaybackPositionData = {
            ...shared,
            positionSeconds: 100,
            activitySessionId: undefined,
            activityAction: 'mark-watched',
        };
        await adapter.invoke(raw, 'savePlaybackPosition', ['source', explicit]);
        expect(save).toHaveBeenCalledWith('source', explicit);
        expect(raw.savePlaybackPosition).not.toHaveBeenCalled();
        expect(await adapter.all(raw, 'source')).toEqual([
            expect.objectContaining({ watched: true }),
        ]);
    });

    it('exports shared progress and reset barriers as portable legacy-compatible positions', async () => {
        const shared = {
            contentType: 'vod' as const,
            contentXtreamId: 1,
            positionSeconds: 20,
            durationSeconds: 100,
            watched: true,
            activitySessionId: 'device-session',
            activityAction: 'mark-watched' as const,
        };
        const client = {
            positions: async () => [
                { position: shared, reset: false },
                { position: { ...shared, contentXtreamId: 2 }, reset: true },
                {
                    position: {
                        ...shared,
                        contentXtreamId: 3,
                        durationSeconds: undefined,
                    },
                    reset: false,
                },
            ],
        } as unknown as ActivitySyncClient;
        const local = [
            { ...shared, positionSeconds: 5, watched: false },
            { ...shared, contentXtreamId: 2 },
            {
                contentType: 'vod' as const,
                contentXtreamId: 9,
                positionSeconds: 7,
            },
        ];
        const result = await new ActivityPositionAdapter(
            client
        ).exportPositions('source', local);
        expect(result).toEqual([
            expect.objectContaining({
                contentXtreamId: 1,
                positionSeconds: 100,
                durationSeconds: 100,
                watched: true,
            }),
            expect.objectContaining({ contentXtreamId: 9, positionSeconds: 7 }),
            expect.objectContaining({
                contentXtreamId: 3,
                positionSeconds: 1,
                durationSeconds: 1,
                watched: true,
            }),
        ]);
        expect(
            result.every((p) => !p.activitySessionId && !p.activityAction)
        ).toBe(true);
        expect(local[0].positionSeconds).toBe(5);
    });

    it.each([false, true])(
        'propagates strict %s mirror failure instead of accepting a silent raw acknowledgement',
        async (reset) => {
            const position = {
                contentType: 'vod' as const,
                contentXtreamId: 1,
                positionSeconds: 20,
                durationSeconds: 100,
            };
            const client = {
                positions: async () => [{ position, reset, conflict: false }],
            } as unknown as ActivitySyncClient;
            const raw = {
                savePlaybackPosition: jest.fn(async () => undefined),
                clearPlaybackPosition: jest.fn(async () => undefined),
            } as unknown as IXtreamDataSource;
            const strict = {
                save: jest.fn(async () => {
                    throw new Error('write failed');
                }),
                clear: jest.fn(async () => {
                    throw new Error('write failed');
                }),
            };
            await expect(
                new ActivityPositionAdapter(client, strict).keepLocal(
                    raw,
                    'source'
                )
            ).rejects.toThrow('write failed');
            expect(reset ? strict.clear : strict.save).toHaveBeenCalledTimes(1);
            expect(raw.savePlaybackPosition).not.toHaveBeenCalled();
            expect(raw.clearPlaybackPosition).not.toHaveBeenCalled();
        }
    );
});
