import {
    type Playlist,
    type SourceDefinition,
    type SourceServerRequest,
} from '@iptvnator/shared/interfaces';
import {
    applySourceDefinition,
    sourceFromPlaylist,
    validateSource,
} from '@iptvnator/shared/interfaces/source-definition';
import { FormControl, FormGroup } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PlaylistsService } from '../playlists.service';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';
import { SyncedPlaylistStore } from './synced-playlist-store';
import { PlaylistWriteConflict } from '../playlist-storage-backend';
import type { DataService } from '../data.service';
import { materializeSource } from './source-materializer';

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
    const request = jest.fn(async (_command: SourceServerRequest) => ({
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
    it.each(['m3u-url', 'm3u-text'] as const)(
        'materializes an accepted %s edit before marking its revision current',
        async (kind) => {
            const { rows, local } = setup();
            const before: SourceDefinition = {
                id: 'a',
                title: 'Shared M3U',
                kind,
                ...(kind === 'm3u-url'
                    ? { url: 'https://provider.test/old.m3u' }
                    : {
                          rawM3u: '#EXTM3U\n#EXTINF:-1,Old\nhttps://media.test/old',
                      }),
            };
            const accepted: SourceDefinition = {
                ...before,
                ...(kind === 'm3u-url'
                    ? { url: 'https://provider.test/new.m3u' }
                    : {
                          rawM3u: '#EXTM3U\n#EXTINF:-1,New\nhttps://media.test/new',
                      }),
            };
            rows.set('a', {
                ...applySourceDefinition(before),
                sourceSyncBase: before,
                sourceSyncRevision: '"1"',
                favorites: ['local-favorite'],
                playlist: {
                    items: [{ name: 'Old', url: 'https://media.test/old' }],
                },
                count: 1,
            });
            const data = {
                fetchPlaylistDefinition: jest.fn().mockResolvedValue({
                    playlist: {
                        items: [{ name: 'New', url: 'https://media.test/new' }],
                    },
                    count: 1,
                }),
            } as unknown as DataService;
            const project = jest.fn(
                (definition: SourceDefinition, current?: Playlist) =>
                    materializeSource(definition, current, data)
            );
            const store = new SyncedPlaylistStore(
                local,
                async () => ({
                    status: 200,
                    body: accepted,
                    etag: '"2"',
                }),
                project
            );
            const original = (await store.dbGetAppPlaylist('a'))!;
            await store.dbUpsertAppPlaylist(
                applySourceDefinition(accepted, original)
            );
            expect(project).toHaveBeenCalledTimes(1);
            expect(rows.get('a')).toMatchObject({
                sourceSyncBase: accepted,
                sourceSyncRevision: '"2"',
                playlist: {
                    items: [{ name: 'New', url: 'https://media.test/new' }],
                },
                count: 1,
                favorites: ['local-favorite'],
            });
            expect(rows.get('a')?.sourceSyncPending).toBeUndefined();
        }
    );

    it('retains a failed URL edit as pending and retries its accepted definition', async () => {
        const { rows, local } = setup();
        const before: SourceDefinition = {
            id: 'a',
            title: 'Shared URL',
            kind: 'm3u-url',
            url: 'https://provider.test/old.m3u',
        };
        const accepted = { ...before, url: 'https://provider.test/new.m3u' };
        rows.set('a', {
            ...applySourceDefinition(before),
            sourceSyncBase: before,
            sourceSyncRevision: '"1"',
            playlist: {
                items: [{ name: 'Old', url: 'https://media.test/old' }],
            },
            count: 1,
        });
        const fetch = jest
            .fn()
            .mockRejectedValueOnce(new Error('provider offline'))
            .mockResolvedValue({
                playlist: { items: [{ name: 'New' }] },
                count: 1,
            });
        const store = new SyncedPlaylistStore(
            local,
            async () => ({
                status: 200,
                body: accepted,
                etag: '"2"',
            }),
            (definition, current) =>
                materializeSource(definition, current, {
                    fetchPlaylistDefinition: fetch,
                } as unknown as DataService)
        );
        const original = (await store.dbGetAppPlaylist('a'))!;
        await store.dbUpsertAppPlaylist({ ...original, url: accepted.url });
        expect(rows.get('a')).toMatchObject({
            sourceSyncBase: accepted,
            sourceSyncRevision: '"2"',
            sourceSyncPending: true,
            playlist: { items: [] },
            count: 0,
        });
        expect(store.pendingSources.has('a')).toBe(true);
        await store.project(accepted, '"2"');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(rows.get('a')?.playlist?.items).toEqual([{ name: 'New' }]);
        expect(rows.get('a')?.sourceSyncPending).toBeUndefined();
        expect(store.pendingSources.has('a')).toBe(false);
    });

    it.each([
        { ...source },
        {
            id: 'a',
            title: 'URL',
            kind: 'm3u-url',
            url: 'https://provider.test/list.m3u',
        },
        {
            id: 'a',
            title: 'Upload',
            kind: 'm3u-text',
            rawM3u: '#EXTM3U\nhttps://media.test/live',
        },
        {
            id: 'a',
            title: 'Portal',
            kind: 'stalker',
            portalUrl: 'https://portal.test',
            macAddress: '00:1A:79:00:00:01',
        },
    ] as SourceDefinition[])(
        'saves a $kind rename from nullable editor controls through playlist metadata and the source API',
        async (definition) => {
            const { store, rows, request } = setup();
            rows.set('a', {
                ...applySourceDefinition(definition),
                favorites: ['private'],
                sourceSyncBase: definition,
                sourceSyncRevision: '"1"',
            });
            request.mockImplementation(async (command) => ({
                status: 200,
                body: validateSource(command.source),
                etag: '"2"',
            }));
            const playlists = Object.create(
                PlaylistsService.prototype
            ) as PlaylistsService;
            Object.assign(playlists, {
                storageBackend: {
                    kind: () => 'server',
                    documentStore: () => store,
                },
                playlistWriteQueues: new Map(),
                deletingAll: Promise.resolve(),
                resets: 0,
                electronMigrationPromise: Promise.resolve(),
            });
            // These are the optional controls constructed by PlaylistInfoComponent.
            const form = new FormGroup({
                title: new FormControl('Renamed source'),
                stalkerSerialNumber: new FormControl<string | undefined>(
                    undefined
                ),
                stalkerDeviceId1: new FormControl<string | undefined>(
                    undefined
                ),
                stalkerDeviceId2: new FormControl<string | undefined>(
                    undefined
                ),
                stalkerSignature1: new FormControl<string | undefined>(
                    undefined
                ),
                stalkerSignature2: new FormControl<string | undefined>(
                    undefined
                ),
            });
            expect(form.getRawValue().stalkerSerialNumber).toBeNull();
            await firstValueFrom(
                playlists.updatePlaylistMeta({
                    _id: 'a',
                    ...form.getRawValue(),
                } as never)
            );
            expect(request).toHaveBeenCalledTimes(1);
            expect(request.mock.calls[0][0].source).toEqual({
                ...definition,
                title: 'Renamed source',
            });
            expect(rows.get('a')).toMatchObject({
                title: 'Renamed source',
                sourceSyncRevision: '"2"',
                favorites: ['private'],
            });
        }
    );
    it('uses native lightweight metadata without reading complete playlist documents', async () => {
        const { store, local } = setup();
        local.dbGetAppPlaylistMetas = jest.fn(async () => [
            { _id: 'a', title: 'Shared', count: 50000 } as Playlist,
        ]);
        expect(await store.dbGetAppPlaylistMetas()).toEqual([
            { _id: 'a', title: 'Shared', count: 50000 },
        ]);
        expect(local.dbGetAppPlaylistMetas).toHaveBeenCalledTimes(1);
        expect(local.dbGetAppPlaylists).not.toHaveBeenCalled();
        expect(local.dbGetAppPlaylist).not.toHaveBeenCalled();
    });
    it('omits uploaded bodies and source baselines from browser metadata without changing full documents', async () => {
        const { store, rows } = setup();
        const full: Playlist = {
            ...cached(),
            sourceRawM3u: '#EXTM3U\nhttps://media.test/live',
            sourceSyncBase: {
                id: 'a',
                title: 'Upload',
                kind: 'm3u-text',
                rawM3u: '#EXTM3U\nhttps://media.test/live',
            },
            playlist: { items: [{ url: 'https://media.test/live' }] },
        };
        rows.set('a', full);
        const [meta] = await store.dbGetAppPlaylistMetas();
        expect(meta).not.toHaveProperty('playlist');
        expect(meta).not.toHaveProperty('sourceRawM3u');
        expect(meta).not.toHaveProperty('sourceSyncBase');
        expect(await store.dbGetAppPlaylist('a')).toMatchObject(full);
    });
    it.each(['userAgent', 'referrer', 'origin'] as const)(
        'keeps favorites and history local after SQLite normalizes an empty %s',
        async (field) => {
            const { store, rows, request } = setup();
            const definition: SourceDefinition = {
                id: 'a',
                title: 'M3U',
                kind: 'm3u-url',
                url: 'https://provider.test/list.m3u',
            };
            rows.set('a', {
                ...applySourceDefinition(definition),
                [field]: undefined,
                sourceSyncBase: { ...definition, [field]: '' },
                sourceSyncRevision: '"1"',
            });
            request.mockRejectedValue(new Error('offline'));
            const snapshot = (await store.dbGetAppPlaylist('a'))!;
            await expect(
                store.dbUpsertAppPlaylist({
                    ...snapshot,
                    favorites: ['offline-favorite'],
                })
            ).resolves.toMatchObject({ success: true });
            const updated = (await store.dbGetAppPlaylist('a'))!;
            await store.dbUpsertAppPlaylist({
                ...updated,
                recentlyViewed: [
                    {
                        source: 'm3u',
                        id: '1',
                        url: 'https://media.test/live',
                        title: 'Watched offline',
                        category_id: 'live',
                        added_at: '2026-10-26',
                    },
                ],
            });
            expect(rows.get('a')?.favorites).toEqual(['offline-favorite']);
            expect(rows.get('a')?.recentlyViewed).toHaveLength(1);
            expect(request).not.toHaveBeenCalled();
        }
    );
    it('rejects a stale local activity snapshot so the complete mutation can retry on a fresh read', async () => {
        const { store, rows, local, request } = setup();
        const other = new SyncedPlaylistStore(
            local,
            request,
            async (source, current) => applySourceDefinition(source, current)
        );
        const first = (await store.dbGetAppPlaylist('a'))!;
        const stale = (await other.dbGetAppPlaylist('a'))!;
        const recent = {
            source: 'm3u' as const,
            id: 'watched',
            url: 'https://media.test/live',
            title: 'Watched',
            category_id: 'live' as const,
            added_at: '2026-10-26',
        };
        await store.dbUpsertAppPlaylist({ ...first, favorites: ['saved'] });
        await expect(
            other.dbUpsertAppPlaylist({ ...stale, recentlyViewed: [recent] })
        ).rejects.toBeInstanceOf(PlaylistWriteConflict);
        const fresh = (await other.dbGetAppPlaylist('a'))!;
        await other.dbUpsertAppPlaylist({ ...fresh, recentlyViewed: [recent] });
        expect(rows.get('a')).toMatchObject({
            favorites: ['saved'],
            recentlyViewed: [{ id: 'watched' }],
        });
        expect(Object.getOwnPropertySymbols(rows.get('a')!)).toHaveLength(0);
    });
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
    it.each(['m3u-url', 'm3u-text'] as const)(
        'preserves a concurrent %s refresh while a rename request is in flight',
        async (kind) => {
            const { store, rows, request } = setup();
            const definition: SourceDefinition = {
                id: 'a',
                title: 'Original',
                kind,
                ...(kind === 'm3u-url'
                    ? { url: 'https://provider.test/list.m3u' }
                    : { rawM3u: '#EXTM3U\nbody' }),
            };
            rows.set('a', {
                ...applySourceDefinition(definition),
                sourceSyncBase: definition,
                sourceSyncRevision: '"1"',
                playlist: { items: [{ name: 'Old' }] },
                count: 1,
                updateDate: 1,
                detectedEpgUrls: ['https://epg.test/old.xml'],
                epgUrls: ['https://epg.test/old.xml'],
                manualEpgUrls: ['https://epg.test/manual.xml'],
            });
            let release!: () => void;
            let started!: () => void;
            const pending = new Promise<void>((resolve) => {
                release = resolve;
            });
            const requested = new Promise<void>((resolve) => {
                started = resolve;
            });
            request.mockImplementationOnce(async () => {
                started();
                await pending;
                return {
                    status: 200,
                    body: { ...definition, title: 'Renamed' },
                    etag: '"2"',
                };
            });
            const original = (await store.dbGetAppPlaylist('a'))!;
            const rename = store.dbUpsertAppPlaylist({
                ...original,
                title: 'Renamed',
            });
            await requested;
            rows.set('a', {
                ...rows.get('a')!,
                playlist: { items: [{ name: 'Fresh' }, { name: 'Second' }] },
                count: 2,
                updateDate: 2,
                favorites: ['saved-elsewhere'],
                detectedEpgUrls: ['https://epg.test/fresh.xml'],
                epgUrls: [
                    'https://epg.test/fresh.xml',
                    'https://epg.test/manual.xml',
                ],
            });
            release();
            await rename;
            expect(rows.get('a')).toMatchObject({
                title: 'Renamed',
                sourceSyncRevision: '"2"',
                playlist: { items: [{ name: 'Fresh' }, { name: 'Second' }] },
                count: 2,
                updateDate: 2,
                favorites: ['saved-elsewhere'],
                detectedEpgUrls: ['https://epg.test/fresh.xml'],
                manualEpgUrls: ['https://epg.test/manual.xml'],
                epgUrls: [
                    'https://epg.test/fresh.xml',
                    'https://epg.test/manual.xml',
                ],
            });
        }
    );

    it('retains a refresh explicitly included by the caller in a title edit', async () => {
        const { store, rows, request } = setup();
        const definition: SourceDefinition = {
            id: 'a',
            title: 'Original',
            kind: 'm3u-url',
            url: 'https://provider.test/list.m3u',
        };
        rows.set('a', {
            ...applySourceDefinition(definition),
            sourceSyncBase: definition,
            sourceSyncRevision: '"1"',
            playlist: { items: [{ name: 'Old' }] },
            count: 1,
        });
        request.mockResolvedValueOnce({
            status: 200,
            body: { ...definition, title: 'Renamed' },
            etag: '"2"',
        });
        const original = (await store.dbGetAppPlaylist('a'))!;
        await store.dbUpsertAppPlaylist({
            ...original,
            title: 'Renamed',
            playlist: { items: [{ name: 'Downloaded here' }] },
            updateDate: 2,
        });
        expect(rows.get('a')).toMatchObject({
            title: 'Renamed',
            playlist: { items: [{ name: 'Downloaded here' }] },
            updateDate: 2,
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
