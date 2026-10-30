import type { Playlist, SourceDefinition } from '@iptvnator/shared/interfaces';
import { applySourceDefinition } from '@iptvnator/shared/interfaces/source-definition';
import {
    PlaylistWriteConflict,
    type PlaylistDocumentStore,
} from '../playlist-storage-backend';
import { SyncedPlaylistStore } from './synced-playlist-store';
import { SourceCleanupQueue } from './source-cleanup-queue';

const original: SourceDefinition = {
    id: 'source',
    title: 'Original',
    kind: 'm3u-url',
    url: 'https://provider.test/original.m3u',
};
const edited: SourceDefinition = {
    ...original,
    title: 'Edited',
    url: 'https://provider.test/edited.m3u',
};

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function setup(existing = true) {
    const rows = new Map<string, Playlist>();
    if (existing)
        rows.set(original.id, {
            ...applySourceDefinition(original),
            sourceSyncBase: original,
            sourceSyncRevision: '"1"',
        });
    const local: PlaylistDocumentStore = {
        dbGetAppPlaylist: async (id) => structuredClone(rows.get(id) ?? null),
        dbGetAppPlaylists: async () => [...rows.values()],
        dbMutateAppPlaylist: async (id, mutate) => {
            const row = mutate(structuredClone(rows.get(id) ?? null));
            rows.set(id, structuredClone(row));
            return row;
        },
        dbUpsertAppPlaylist: jest.fn(),
        dbUpsertAppPlaylists: jest.fn(),
        dbDeletePlaylist: async (id) => {
            rows.delete(id);
            return { success: true };
        },
        dbDeleteAllPlaylists: jest.fn(async () => {
            rows.clear();
            return { success: true };
        }),
        dbGetAppState: jest.fn(),
        dbSetAppState: jest.fn(),
    };
    const started = deferred();
    const downloaded = deferred();
    const request = jest.fn(async () => ({
        status: 200,
        body: edited,
        etag: '"2"',
    }));
    const first = new SyncedPlaylistStore(
        local,
        request,
        async (source, row) => {
            started.resolve();
            await downloaded.promise;
            return {
                ...applySourceDefinition(source, row),
                playlist: { items: [{ name: 'Old download' }] },
            };
        }
    );
    const second = new SyncedPlaylistStore(
        local,
        request,
        async (source, row) => ({
            ...applySourceDefinition(source, row),
            playlist: { items: [{ name: 'New download' }] },
        })
    );
    return { rows, first, second, started, downloaded, request, local };
}

describe('source projection across clients without Web Locks', () => {
    it.each([true, false])(
        'rejects an old inventory download after a sibling edit (existing row: %s)',
        async (existing) => {
            const { rows, first, second, started, downloaded } =
                setup(existing);
            const projection = first.exclusive(() =>
                first.project(original, '"1"')
            );
            const rejected = expect(projection).rejects.toBeInstanceOf(
                PlaylistWriteConflict
            );
            await started.promise;
            await second.project(edited, '"2"');
            const newer = structuredClone(rows.get(original.id));
            downloaded.resolve();
            await rejected;
            expect(rows.get(original.id)).toEqual(newer);
            expect(rows.get(original.id)).toMatchObject({
                title: 'Edited',
                sourceSyncRevision: '"2"',
                playlist: { items: [{ name: 'New download' }] },
            });
        }
    );

    it('does not recreate a row deleted while an inventory download is pending', async () => {
        const { rows, first, second, started, downloaded } = setup();
        const projection = first.exclusive(() =>
            first.project(original, '"1"')
        );
        const rejected = expect(projection).rejects.toBeInstanceOf(
            PlaylistWriteConflict
        );
        await started.promise;
        await second.dbDeletePlaylist(original.id);
        downloaded.resolve();
        await rejected;
        expect(rows.has(original.id)).toBe(false);
    });

    it('keeps a successful sibling download when a pending retry completes late', async () => {
        const { rows, first, started, downloaded } = setup();
        rows.get(original.id)!.sourceSyncPending = true;
        const projection = first.project(original, '"1"');
        await started.promise;
        const completed = {
            ...rows.get(original.id)!,
            playlist: { items: [{ name: 'Successful retry' }] },
        };
        delete completed.sourceSyncPending;
        rows.set(original.id, completed);
        downloaded.resolve();
        expect(await projection).toEqual(completed);
        expect(rows.get(original.id)).toEqual(completed);
    });

    it.each([false, true])(
        'keeps a sibling source added after the remote clear (reused ID: %s)',
        async (reuseId) => {
            const { rows, first, second, started, downloaded, request } =
                setup();
            request.mockImplementation(async () => {
                started.resolve();
                await downloaded.promise;
                return { status: 200, body: edited, etag: '"2"' };
            });
            const clearing = first.dbDeleteAllPlaylists();
            await started.promise;
            const sibling = {
                ...edited,
                id: reuseId ? original.id : 'sibling',
            };
            await second.project(sibling, '"3"');
            rows.get(sibling.id)!.favorites = ['sibling-favorite'];
            const expected = structuredClone(rows.get(sibling.id));
            downloaded.resolve();
            await clearing;
            expect(rows.get(sibling.id)).toEqual(expected);
            expect([...rows.keys()]).toEqual([sibling.id]);
        }
    );

    it('cleans native sources whose payload-free metadata omits revisions', async () => {
        const { rows, local, request } = setup();
        local.dbGetAppPlaylistMetas = async () =>
            [...rows.values()].map((row) => {
                const meta = { ...row };
                delete meta.sourceSyncRevision;
                delete meta.sourceSyncBase;
                delete meta.playlist;
                return meta;
            });
        const cleanup = jest.fn().mockResolvedValue(undefined);
        const queue = new SourceCleanupQueue(
            local,
            [cleanup],
            'test:source-clear:'
        );
        const store = new SyncedPlaylistStore(
            local,
            request,
            async (value, current) => applySourceDefinition(value, current),
            'native',
            queue.prune
        );
        await store.dbDeleteAllPlaylists();
        expect(rows.size).toBe(0);
        expect(cleanup).toHaveBeenCalledWith(original.id);
    });
});
