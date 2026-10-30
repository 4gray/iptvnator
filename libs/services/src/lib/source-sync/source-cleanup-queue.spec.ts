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

    function enableConditionalDeletion() {
        local.dbPruneAppPlaylist = jest.fn(async (id, revision, mark) => {
            const row = rows.get(id);
            if (!row || row.sourceSyncRevision !== revision) return false;
            mark();
            rows.delete(id);
            return true;
        });
    }

    it('keeps a deletion fenced until the owner finishes, then skips a sibling retry', async () => {
        localStorage.setItem(`${prefix}a`, JSON.stringify(['"old"']));
        rows.delete('a');
        const locks = new Map([['a', ['old-lock']]]);
        let tail = Promise.resolve();
        local.dbWithSourceCleanup = (operation) => {
            const next = tail.then(operation);
            tail = next.then(
                () => undefined,
                () => undefined
            );
            return next;
        };
        let entered!: () => void;
        const started = new Promise<void>((resolve) => (entered = resolve));
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        const slowCleanup = jest.fn(async (id) => {
            entered();
            await held;
            locks.delete(id);
        });
        const fastCleanup = jest.fn(async (id) => {
            locks.delete(id);
        });
        const slow = new SourceCleanupQueue(local, [slowCleanup], prefix);
        const fast = new SourceCleanupQueue(local, [fastCleanup], prefix);
        const first = slow.retry();
        await started;
        let finished = false;
        const second = fast.retry().then(() => {
            finished = true;
        });
        try {
            // Drain all unblocked continuations; the held hook cannot complete.
            for (let index = 0; index < 30; index++) await Promise.resolve();
            expect(finished).toBe(false);
            expect(() => fast.assertWritable('a')).toThrow(
                'SOURCE_SYNC.REQUEST_FAILED'
            );
        } finally {
            release();
            await Promise.all([first, second]);
        }
        expect(fastCleanup).not.toHaveBeenCalled();
        expect(slowCleanup).toHaveBeenCalledTimes(1);
        rows.set('a', { _id: 'a', sourceSyncRevision: '"new"' } as Playlist);
        locks.set('a', ['restored-lock']);
        expect(() => fast.assertWritable('a')).not.toThrow();
        await Promise.all([slow.retry(), fast.retry()]);
        expect(locks.get('a')).toEqual(['restored-lock']);
        expect(rows.get('a')?.sourceSyncRevision).toBe('"new"');
    });

    it('does not mark or clean a newer row when its conditional delete loses the race', async () => {
        rows.set('a', {
            _id: 'a',
            sourceSyncRevision: '"new"',
            favorites: ['private'],
        } as Playlist);
        enableConditionalDeletion();
        const queue = new SourceCleanupQueue(local, [cleanup], prefix);
        expect(await queue.prune('a', '"old"')).toBe(false);
        expect(rows.get('a')?.favorites).toEqual(['private']);
        expect(cleanup).not.toHaveBeenCalled();
        expect(localStorage.length).toBe(0);
    });

    it('blocks another context from reusing the ID until conditional cleanup completes', async () => {
        enableConditionalDeletion();
        const queue = new SourceCleanupQueue(local, [cleanup], prefix);
        const sibling = new SourceCleanupQueue(local, [], prefix);
        cleanup.mockImplementation(async () => {
            expect(rows.has('a')).toBe(false);
            expect(() => sibling.assertWritable('a')).toThrow(
                'SOURCE_SYNC.REQUEST_FAILED'
            );
        });
        expect(await queue.prune('a', undefined)).toBe(true);
        expect(() => sibling.assertWritable('a')).not.toThrow();
    });

    it('recovers a conditional deletion after failed hooks without deleting a newer row', async () => {
        rows.set('a', { _id: 'a', sourceSyncRevision: '"old"' } as Playlist);
        enableConditionalDeletion();
        cleanup.mockRejectedValueOnce(new Error('settings write failed'));
        const queue = new SourceCleanupQueue(local, [cleanup], prefix);
        await expect(queue.prune('a', '"old"')).rejects.toThrow(
            'SOURCE_SYNC.REQUEST_FAILED'
        );
        expect(rows.has('a')).toBe(false);
        expect(localStorage.getItem(`${prefix}a`)).not.toBeNull();
        // A cache written by an older client must be outside the old marker's authority.
        rows.set('a', {
            _id: 'a',
            sourceSyncRevision: '"new"',
            favorites: ['new'],
        } as Playlist);
        await new SourceCleanupQueue(local, [cleanup], prefix).retry();
        expect(rows.get('a')?.favorites).toEqual(['new']);
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(`${prefix}a`)).toBeNull();
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
