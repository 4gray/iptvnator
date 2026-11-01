import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import type { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import { ActivityPositionAdapter } from './activity-position-adapter';

describe('activity projection local preservation', () => {
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
