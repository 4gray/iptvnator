import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import type { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import { ActivityPositionAdapter } from './activity-position-adapter';

describe('activity projection local preservation', () => {
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
