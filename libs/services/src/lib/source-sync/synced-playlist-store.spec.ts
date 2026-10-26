import {
    applySourceDefinition,
    sourceFromPlaylist,
    type Playlist,
    type SourceDefinition,
} from '@iptvnator/shared/interfaces';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';
import { SyncedPlaylistStore } from './synced-playlist-store';

const source: SourceDefinition = {
    id: 'a',
    title: 'Shared',
    kind: 'xtream',
    serverUrl: 'https://panel.test',
    username: 'user',
    password: 'secret',
};
const cached = (): Playlist => ({
    ...applySourceDefinition(source),
    sourceSyncBase: source,
    sourceSyncRevision: '"1"',
    favorites: [],
});

function setup() {
    const rows = new Map<string, Playlist>([['a', cached()]]);
    const local: PlaylistDocumentStore = {
        dbGetAppPlaylist: jest.fn(async (id) =>
            structuredClone(rows.get(id) ?? null)
        ),
        dbGetAppPlaylists: jest.fn(async () => [...rows.values()]),
        dbUpsertAppPlaylist: jest.fn(async (row) => {
            rows.set(row._id, structuredClone(row));
            return { success: true };
        }),
        dbUpsertAppPlaylists: jest.fn(),
        dbDeletePlaylist: jest.fn(async (id) => {
            rows.delete(id);
            return { success: true };
        }),
        dbDeleteAllPlaylists: jest.fn(async () => {
            rows.clear();
            return { success: true };
        }),
        dbGetAppState: jest.fn(),
        dbSetAppState: jest.fn(),
    };
    const request = jest.fn(async () => ({
        status: 200,
        body: source,
        etag: '"2"',
    }));
    const store = new SyncedPlaylistStore(
        local,
        request,
        async (value, current) => applySourceDefinition(value, current)
    );
    store.ready = true;
    return { store, rows, request, local };
}

describe('source synchronization with local activity', () => {
    it("atomically preserves another tab's activity during materialization without Web Locks", async () => {
        const { rows, local, request } = setup();
        const atomic = {
            ...local,
            dbMutateAppPlaylist: async (
                id: string,
                mutate: (row: Playlist | null) => Playlist
            ) => {
                const next = mutate(structuredClone(rows.get(id) ?? null));
                rows.set(id, structuredClone(next));
                return next;
            },
        };
        let resume!: () => void;
        const downloaded = new Promise<void>((resolve) => {
            resume = resolve;
        });
        let started!: () => void;
        const materializing = new Promise<void>((resolve) => {
            started = resolve;
        });
        const first = new SyncedPlaylistStore(
            atomic,
            request,
            async (value, current) => {
                started();
                await downloaded;
                return {
                    ...applySourceDefinition(value, current),
                    playlist: { items: [{ name: 'New' }] },
                };
            }
        );
        const second = new SyncedPlaylistStore(
            atomic,
            request,
            async (value, current) => applySourceDefinition(value, current)
        );
        const projection = first.exclusive(() =>
            first.project({ ...source, title: 'New' }, '"2"')
        );
        await materializing;
        await second.dbUpsertAppPlaylist({
            ...cached(),
            favorites: ['other-tab'],
        });
        resume();
        await projection;
        expect(rows.get('a')).toMatchObject({
            favorites: ['other-tab'],
            title: 'New',
            sourceSyncRevision: '"2"',
            playlist: { items: [{ name: 'New' }] },
        });
    });
    it('returns a deduplicated canonical source without mutating the dispatched input', async () => {
        const { store, request, rows } = setup();
        const draft = Object.freeze({
            ...applySourceDefinition({ ...source, id: 'draft' }),
        });
        await expect(store.dbUpsertAppPlaylist(draft)).resolves.toMatchObject({
            success: true,
            playlist: { _id: 'a' },
        });
        expect(request).toHaveBeenCalled();
        expect(draft._id).toBe('draft');
        expect(rows.has('draft')).toBe(false);
    });
    it('keeps favorite/history writes local', async () => {
        const { store, request, rows } = setup();
        await store.dbUpsertAppPlaylist({
            ...cached(),
            favorites: ['channel'],
        });
        expect(request).not.toHaveBeenCalled();
        expect(rows.get('a')?.favorites).toEqual(['channel']);
    });
    it('accepts freshly downloaded channels from a manual refresh at the same source revision', async () => {
        const { store, rows, request } = setup();
        const urlSource: SourceDefinition = {
            id: 'a',
            title: 'URL',
            kind: 'm3u-url',
            url: 'https://provider.test/list.m3u',
        };
        const current = {
            ...applySourceDefinition(urlSource),
            sourceSyncBase: urlSource,
            sourceSyncRevision: '"1"',
            playlist: { items: [{ name: 'Old' }] },
        };
        rows.set('a', current);
        await store.dbUpsertAppPlaylist({
            ...current,
            playlist: { items: [{ name: 'Refreshed' }] },
        });
        expect(rows.get('a')?.playlist.items).toEqual([{ name: 'Refreshed' }]);
        expect(request).not.toHaveBeenCalled();
    });
    it('retains a recovered URL projection when delayed activity still holds its failed placeholder', async () => {
        const { store, rows } = setup();
        const urlSource: SourceDefinition = {
            id: 'a',
            title: 'URL',
            kind: 'm3u-url',
            url: 'https://provider.test/list.m3u',
        };
        const current = {
            ...applySourceDefinition(urlSource),
            sourceSyncBase: urlSource,
            sourceSyncRevision: '"1"',
            playlist: { items: [{ name: 'Recovered' }] },
        };
        rows.set('a', current);
        await store.dbUpsertAppPlaylist({
            ...current,
            sourceSyncPending: true,
            playlist: { items: [] },
            favorites: ['local'],
        });
        expect(rows.get('a')).toMatchObject({
            playlist: { items: [{ name: 'Recovered' }] },
            favorites: ['local'],
        });
        expect(rows.get('a')?.sourceSyncPending).toBeUndefined();
    });
    it('merges device activity under the canonical ID when a newly added source deduplicates', async () => {
        const { store, rows } = setup();
        rows.set('a', {
            ...cached(),
            favorites: ['existing'],
            autoRefresh: true,
            position: 5,
        });
        const result = await store.dbUpsertAppPlaylist({
            ...applySourceDefinition({ ...source, id: 'backup' }),
            favorites: ['restored'],
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'restored',
                    url: 'https://media.test/live',
                    title: 'Restored',
                    category_id: 'live',
                    added_at: '2026-10-26',
                },
            ],
        });
        expect(result.playlist._id).toBe('a');
        expect(rows.get('a')?.favorites).toEqual(['existing', 'restored']);
        expect(rows.get('a')).toMatchObject({ autoRefresh: true, position: 5 });
        expect(rows.get('a')?.recentlyViewed).toEqual([
            expect.objectContaining({ title: 'Restored' }),
        ]);
        expect(rows.has('backup')).toBe(false);
    });
    it('sends only a source definition and its original revision when editing', async () => {
        const { store, request } = setup();
        await store.dbUpsertAppPlaylist({
            ...cached(),
            title: 'Edited',
            favorites: ['private'],
        });
        expect(request).toHaveBeenCalledWith({
            operation: 'update',
            id: 'a',
            source: { ...source, title: 'Edited' },
            revision: '"1"',
        });
        expect(JSON.stringify(request.mock.calls)).not.toContain('private');
    });
    it('does not revert a remote rename when a local favorite mutation started earlier', async () => {
        const { store, request, rows } = setup();
        const stale = { ...cached(), favorites: ['channel'] };
        await store.project({ ...source, title: 'Remote title' }, '"2"');
        await store.dbUpsertAppPlaylist(stale);
        expect(request).not.toHaveBeenCalled();
        expect(rows.get('a')).toMatchObject({
            title: 'Remote title',
            favorites: ['channel'],
            sourceSyncRevision: '"2"',
        });
    });
    it('rejects a stale local write after remote deletion instead of recreating a source', async () => {
        const { store, rows, request } = setup();
        rows.delete('a');
        await expect(
            store.dbUpsertAppPlaylist({ ...cached(), favorites: ['channel'] })
        ).rejects.toThrow();
        expect(rows.size).toBe(0);
        expect(request).not.toHaveBeenCalled();
    });
    it('retains the latest parsed channels and cleared session during a delayed local activity write', async () => {
        const { store, rows, request } = setup();
        const old: SourceDefinition = {
            id: 'a',
            title: 'Upload',
            kind: 'm3u-text',
            rawM3u: '#EXTM3U\nold',
        };
        const latest = { ...old, rawM3u: '#EXTM3U\nnew' };
        const stale = {
            ...applySourceDefinition(old),
            sourceSyncBase: old,
            sourceSyncRevision: '"1"',
            playlist: { items: [{ name: 'Old' }] },
            count: 1,
            stalkerToken: 'obsolete',
            favorites: ['private'],
        };
        rows.set('a', {
            ...applySourceDefinition(latest),
            sourceSyncBase: latest,
            sourceSyncRevision: '"2"',
            playlist: { items: [{ name: 'New' }, { name: 'Second' }] },
            count: 2,
        });
        await store.dbUpsertAppPlaylist(stale);
        expect(rows.get('a')).toMatchObject({
            sourceRawM3u: latest.rawM3u,
            sourceSyncRevision: '"2"',
            playlist: { items: [{ name: 'New' }, { name: 'Second' }] },
            count: 2,
            favorites: ['private'],
        });
        expect(rows.get('a')?.stalkerToken).toBeUndefined();
        expect(request).not.toHaveBeenCalled();
    });
    it('preserves local data when a conditional update fails', async () => {
        const { store, request, rows } = setup();
        request.mockRejectedValueOnce(new Error('SOURCE_SYNC.CONFLICT'));
        await expect(
            store.dbUpsertAppPlaylist({ ...cached(), title: 'Edited' })
        ).rejects.toThrow('CONFLICT');
        expect(rows.get('a')?.title).toBe('Shared');
    });
    it('never confirms an empty source list before the first successful synchronization', async () => {
        const { store } = setup();
        store.ready = false;
        await expect(store.dbGetAppPlaylists()).rejects.toThrow('OFFLINE');
    });
});
