import type { Playlist } from '@iptvnator/shared/interfaces';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';
import { SourceCleanupQueue } from './source-cleanup-queue';

describe('durable local source cleanup', () => {
    const prefix = 'profile-a:source-cleanup:';
    let rows: Map<string, Playlist>;
    let local: PlaylistDocumentStore;
    let cleanup: jest.Mock;
    beforeEach(() => {
        localStorage.clear();
        rows = new Map(['a', 'b'].map((id) => [id, { _id: id } as Playlist]));
        cleanup = jest.fn().mockResolvedValue(undefined);
        local = {
            dbGetAppPlaylist: jest.fn(async (id) => rows.get(id) ?? null),
            dbGetAppPlaylists: jest.fn(async () => [...rows.values()]),
            dbDeletePlaylist: jest.fn(async (id) => {
                rows.delete(id);
                return { success: true };
            }),
            dbDeleteAllPlaylists: jest.fn(async () => {
                rows.clear();
                return { success: true };
            }),
        } as unknown as PlaylistDocumentStore;
    });
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('retries after restart even though deletion already removed the source row', async () => {
        cleanup.mockRejectedValueOnce(new Error('app_state could not be read'));
        const queue = new SourceCleanupQueue(local, [cleanup], prefix);
        await expect(queue.remove('a')).rejects.toThrow(
            'SOURCE_SYNC.REQUEST_FAILED'
        );
        expect(rows.has('a')).toBe(false);
        expect(localStorage.getItem(`${prefix}a`)).toBe('1');
        await new SourceCleanupQueue(local, [cleanup], prefix).retry();
        expect(cleanup).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem(`${prefix}a`)).toBeNull();
        rows.set('a', { _id: 'a', title: 'Reused ID' } as Playlist);
        await queue.retry();
        expect(rows.get('a')?.title).toBe('Reused ID');
    });

    it('persists every clear marker before removing rows and retries failed hooks after restart', async () => {
        cleanup.mockRejectedValueOnce(
            new Error('app_state could not be written')
        );
        const queue = new SourceCleanupQueue(local, [cleanup], prefix);
        await expect(queue.clear()).rejects.toThrow(
            'SOURCE_SYNC.REQUEST_FAILED'
        );
        expect(rows.size).toBe(0);
        expect(localStorage.getItem(`${prefix}a`)).toBe('1');
        expect(localStorage.getItem(`${prefix}b`)).toBe('1');
        await new SourceCleanupQueue(local, [cleanup], prefix).retry();
        expect(cleanup).toHaveBeenCalledWith('b');
        expect(localStorage.length).toBe(0);
    });

    it('does not delete a row when its retry marker cannot be persisted', async () => {
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        await expect(
            new SourceCleanupQueue(local, [cleanup], prefix).remove('a')
        ).rejects.toThrow('SOURCE_SYNC.REQUEST_FAILED');
        expect(rows.has('a')).toBe(true);
        expect(local.dbDeletePlaylist).not.toHaveBeenCalled();
        expect(cleanup).not.toHaveBeenCalled();
    });

    it('keeps retry work when deletion reports failure and does not clear locks prematurely', async () => {
        (local.dbDeletePlaylist as jest.Mock).mockResolvedValueOnce({
            success: false,
        });
        const queue = new SourceCleanupQueue(local, [cleanup], prefix);
        await expect(queue.remove('a')).rejects.toThrow(
            'SOURCE_SYNC.REQUEST_FAILED'
        );
        expect(cleanup).not.toHaveBeenCalled();
        expect(localStorage.getItem(`${prefix}a`)).toBe('1');
        await queue.retry();
        expect(cleanup).toHaveBeenCalledWith('a');
        expect(rows.has('a')).toBe(false);
    });

    it('isolates profiles and retains other pending IDs while one deletion completes', async () => {
        localStorage.setItem(`${prefix}b`, '1');
        localStorage.setItem('profile-b:source-cleanup:a', '1');
        await new SourceCleanupQueue(local, [cleanup], prefix).remove('a');
        expect(localStorage.getItem(`${prefix}b`)).toBe('1');
        expect(localStorage.getItem('profile-b:source-cleanup:a')).toBe('1');
        await new SourceCleanupQueue(local, [cleanup], prefix).retry();
        expect(localStorage.getItem(`${prefix}b`)).toBeNull();
        expect(localStorage.getItem('profile-b:source-cleanup:a')).toBe('1');
    });
    it('retries idempotent cleanup if removing a completed marker fails', async () => {
        const remove = jest
            .spyOn(Storage.prototype, 'removeItem')
            .mockImplementationOnce(() => {
                throw new Error('storage unavailable');
            });
        const queue = new SourceCleanupQueue(local, [cleanup], prefix);
        await expect(queue.remove('a')).rejects.toThrow(
            'SOURCE_SYNC.REQUEST_FAILED'
        );
        expect(rows.has('a')).toBe(false);
        expect(localStorage.getItem(`${prefix}a`)).toBe('1');
        remove.mockRestore();
        await queue.retry();
        expect(cleanup).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem(`${prefix}a`)).toBeNull();
    });
});
