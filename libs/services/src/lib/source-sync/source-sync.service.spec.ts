import { TestBed } from '@angular/core/testing';
import { LazySnackBar } from '../lazy-snack-bar/lazy-snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import {
    type Playlist,
    type SourceDefinition,
    type SourceServerRequest,
} from '@iptvnator/shared/interfaces';
import { applySourceDefinition } from '@iptvnator/shared/interfaces/source-definition';
import { DataService } from '../data.service';
import { PLAYLIST_DELETE_CLEANUP } from '../playlist-delete-cleanup.token';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { requestSourceServer } from './source-api';
import {
    sourceConnection,
    prepareSourceConnection,
    saveBrowserSourceConnection,
    sourceAuthorization,
    assertSourceRequestAllowed,
} from './source-connection';
import { SourceSyncService } from './source-sync.service';
import type { SyncedPlaylistStore } from './synced-playlist-store';

jest.mock('./source-api', () => ({ requestSourceServer: jest.fn() }));
jest.mock('./source-connection', () => ({
    ...jest.requireActual('./source-connection'),
    sourceConnection: jest.fn(),
}));

const source: SourceDefinition = {
    id: 'a',
    title: 'NAS source',
    kind: 'xtream',
    serverUrl: 'https://panel.test',
    username: 'user',
    password: 'synthetic-secret',
};
const instance = {
    service: 'iptvnator',
    apiVersion: 1,
    instanceId: 'nas',
    storage: 'server',
    capabilities: ['sources-v1'],
};

describe('source synchronization lifecycle', () => {
    let rows: Map<string, Playlist>;
    let receipt: string | null;
    let inventory: SourceDefinition[];
    let revision: string;
    let service: SourceSyncService;
    let store: SyncedPlaylistStore;
    let cleanup: jest.Mock;
    let finish: jest.Mock;
    let notify: jest.Mock;
    let request: jest.Mock;
    let fetchPlaylistDefinition: jest.Mock;

    beforeEach(() => {
        rows = new Map();
        receipt = null;
        inventory = [];
        revision = '"inventory-1"';
        cleanup = jest.fn();
        finish = jest.fn();
        notify = jest.fn();
        fetchPlaylistDefinition = jest.fn();
        (sourceConnection as jest.Mock).mockReturnValue({
            apiUrl: 'https://nas.test/api',
            instanceId: 'nas',
        });
        request = requestSourceServer as jest.Mock;
        request
            .mockReset()
            .mockImplementation(async (command: SourceServerRequest) => {
                if (command.operation === 'instance')
                    return { status: 200, body: instance };
                if (command.operation === 'list')
                    return command.revision === revision
                        ? { status: 304 }
                        : {
                              status: 200,
                              etag: revision,
                              body: {
                                  entries: inventory.map((source) => ({
                                      source: { ...source, rawM3u: undefined },
                                      revision,
                                  })),
                              },
                          };
                if (command.operation === 'get')
                    return {
                        status: 200,
                        etag: revision,
                        body: inventory.find((row) => row.id === command.id),
                    };
                return { status: 412, body: { code: 'source_conflict' } };
            });
        const local = {
            dbGetAppPlaylist: async (id: string) =>
                structuredClone(rows.get(id) ?? null),
            dbGetAppPlaylists: async () => [...rows.values()],
            dbUpsertAppPlaylist: async (row: Playlist) => {
                rows.set(row._id, structuredClone(row));
                return { success: true };
            },
            dbDeletePlaylist: async (id: string) => {
                rows.delete(id);
                return { success: true };
            },
            dbDeleteAllPlaylists: async () => {
                rows.clear();
                return { success: true };
            },
            dbGetAppState: async () => receipt,
            dbSetAppState: async (_key: string, value: string) => {
                receipt = value;
                return { success: true };
            },
        };
        TestBed.configureTestingModule({
            providers: [
                SourceSyncService,
                {
                    provide: PlaylistStorageBackend,
                    useValue: {
                        localDocumentStore: () => local,
                        installServerStore: (value: SyncedPlaylistStore) => {
                            store = value;
                        },
                        finishServerInitialization: finish,
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsXtreamSqliteDataSource: false },
                },
                { provide: NgxIndexedDBService, useValue: {} },
                { provide: DataService, useValue: { fetchPlaylistDefinition } },
                { provide: LazySnackBar, useValue: { open: notify } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
                { provide: PLAYLIST_DELETE_CLEANUP, useValue: [cleanup] },
            ],
        });
        service = TestBed.inject(SourceSyncService);
    });
    afterEach(() => TestBed.resetTestingModule());

    it('projects changed sources and portable uploads, retains local activity and cleans remote deletions', async () => {
        rows.set('a', {
            ...applySourceDefinition(source),
            title: 'Old title',
            favorites: ['private'],
        });
        rows.set(
            'removed',
            applySourceDefinition({ ...source, id: 'removed' })
        );
        inventory = [
            source,
            {
                id: 'file',
                title: 'Portable upload',
                kind: 'm3u-text',
                rawM3u: '#EXTM3U\n#EXTINF:-1,Shared channel\nhttps://streams.test/shared.ts',
            },
        ];
        const changed = jest.fn();
        service.changes.subscribe(changed);
        await service.initialize();
        await service.refresh();
        expect(service.state()).toBe('connected');
        expect(finish).toHaveBeenCalled();
        expect(rows.get('a')).toMatchObject({
            title: 'NAS source',
            favorites: ['private'],
            sourceSyncRevision: revision,
        });
        expect(rows.get('file')?.playlist?.items[0].name).toBe(
            'Shared channel'
        );
        expect(rows.has('removed')).toBe(false);
        expect(cleanup).toHaveBeenCalledWith('removed');
        expect([...service.sourceIds()]).toEqual(['a', 'file']);
        await service.refresh();
        expect(changed).toHaveBeenCalledTimes(1);
        expect(
            request.mock.calls.filter(
                ([command]) => command.operation === 'get'
            )
        ).toHaveLength(1);
    });

    it('recovers an initially locked empty library and releases startup without a false empty success', async () => {
        request.mockImplementationOnce(async () => ({ status: 401 }));
        const changed = jest.fn();
        service.changes.subscribe(changed);
        await service.initialize();
        await service.refresh();
        expect(service.state()).toBe('locked');
        expect(service.errorKey()).toBe('SOURCE_SYNC.LOCKED');
        expect(finish).toHaveBeenCalled();
        await expect(store.dbGetAppPlaylists()).rejects.toThrow(
            'SOURCE_SYNC.OFFLINE'
        );
        await service.refresh();
        expect(service.state()).toBe('connected');
        await expect(store.dbGetAppPlaylists()).resolves.toEqual([]);
        expect(changed).toHaveBeenCalledTimes(1);
    });
    it.each([false, true])(
        'retries an unavailable URL without a NAS revision change (persisted failure: %s)',
        async (persisted) => {
            const urlSource: SourceDefinition = {
                id: 'url',
                title: 'Provider',
                kind: 'm3u-url',
                url: 'https://provider.test/list.m3u',
            };
            inventory = [urlSource];
            if (persisted)
                rows.set('url', {
                    ...applySourceDefinition(urlSource),
                    sourceSyncBase: urlSource,
                    sourceSyncRevision: revision,
                    sourceSyncPending: true,
                    playlist: { items: [] },
                    count: 0,
                });
            fetchPlaylistDefinition
                .mockRejectedValueOnce(new Error('provider offline'))
                .mockResolvedValue({
                    playlist: {
                        header: { raw: '#EXTM3U' },
                        items: [{ name: 'Recovered' }],
                    },
                    count: 1,
                });
            await service.initialize();
            await service.refresh();
            expect(rows.get('url')?.sourceSyncPending).toBe(true);
            expect(rows.get('url')?.count).toBe(0);
            await service.refresh();
            expect(rows.get('url')?.sourceSyncPending).toBeUndefined();
            expect(rows.get('url')?.playlist.items[0].name).toBe('Recovered');
            await service.refresh();
            expect(fetchPlaylistDefinition).toHaveBeenCalledTimes(2);
            expect(
                request.mock.calls
                    .filter(([command]) => command.operation === 'list')
                    .at(-1)?.[0].revision
            ).toBe(revision);
        }
    );

    it.each([null, '1'])(
        'releases startup while a URL provider is pending (cache receipt %s)',
        async (initialized) => {
            receipt = initialized;
            rows.set('a', applySourceDefinition(source));
            inventory = [
                source,
                {
                    id: 'slow',
                    title: 'Slow source',
                    kind: 'm3u-url',
                    url: 'https://slow.test/list.m3u',
                },
            ];
            let release!: (value: unknown) => void;
            let started!: () => void;
            const downloading = new Promise((resolve) => {
                release = resolve;
            });
            const providerStarted = new Promise<void>((resolve) => {
                started = resolve;
            });
            fetchPlaylistDefinition.mockImplementation(() => {
                started();
                return downloading;
            });
            let complete = false;
            const startup = service.initialize().then(() => {
                complete = true;
            });
            await providerStarted;
            const blocked = !complete;
            const released = finish.mock.calls.length > 0;
            release({ playlist: { items: [] }, count: 0 });
            await startup;
            await service.refresh();
            expect(blocked).toBe(false);
            expect(released).toBe(initialized === '1');
            expect(finish).toHaveBeenCalled();
            expect(service.state()).toBe('connected');
        }
    );

    it('preserves a completed cache offline and rejects source writes until reconnecting', async () => {
        receipt = '1';
        rows.set('a', applySourceDefinition(source));
        request.mockRejectedValueOnce(new Error('unreachable'));
        await service.initialize();
        await service.refresh();
        expect(service.state()).toBe('offline');
        await expect(store.dbGetAppPlaylists()).resolves.toHaveLength(1);
        const calls = request.mock.calls.length;
        await expect(
            store.dbUpsertAppPlaylist({
                ...rows.get('a')!,
                title: 'Offline edit',
            })
        ).rejects.toThrow('SOURCE_SYNC.OFFLINE');
        expect(request).toHaveBeenCalledTimes(calls);
        expect(rows.get('a')?.title).toBe('NAS source');
        inventory = [source];
        await service.refresh();
        expect(service.state()).toBe('connected');
    });

    it('revokes browser credentials immediately after a mutation detects a replacement instance', async () => {
        const original = window.electron;
        const connection = {
            apiUrl: 'https://nas.test/api',
            instanceId: 'nas',
        };
        try {
            Reflect.deleteProperty(window, 'electron');
            saveBrowserSourceConnection(connection, 'synthetic-token');
            await prepareSourceConnection();
            inventory = [source];
            await service.initialize();
            await service.refresh();
            const proxy = `${connection.apiUrl}/xtream`;
            expect(sourceAuthorization(proxy)).toEqual({
                Authorization: 'Bearer synthetic-token',
            });
            request.mockResolvedValueOnce({
                status: 409,
                body: { code: 'instance_changed' },
            });
            await expect(
                store.dbUpsertAppPlaylist({
                    ...rows.get('a')!,
                    title: 'Edited',
                })
            ).rejects.toThrow('SOURCE_SYNC.INSTANCE_CHANGED');
            expect(sourceAuthorization(proxy)).toEqual({});
            expect(() => assertSourceRequestAllowed(proxy)).toThrow(
                'SOURCE_SYNC.INSTANCE_CHANGED'
            );
            expect(service.errorKey()).toBe('SOURCE_SYNC.INSTANCE_CHANGED');
        } finally {
            window.electron = original;
            localStorage.clear();
            sessionStorage.clear();
        }
    });

    it('reports a stale edit and retains the accepted local projection', async () => {
        inventory = [source];
        await service.initialize();
        await service.refresh();
        await expect(
            store.dbUpsertAppPlaylist({
                ...rows.get('a')!,
                title: 'Stale edit',
            })
        ).rejects.toThrow('SOURCE_SYNC.CONFLICT');
        expect(service.state()).toBe('conflict');
        expect(notify).toHaveBeenCalledWith('SOURCE_SYNC.CONFLICT', 'CLOSE', {
            duration: 7000,
        });
        expect(rows.get('a')?.title).toBe('NAS source');
    });
    it('publishes accepted metadata even when its saved revision makes the next inventory projection unnecessary', async () => {
        inventory = [source];
        const changed = jest.fn();
        service.changes.subscribe(changed);
        await service.initialize();
        await service.refresh();
        const implementation = request.getMockImplementation()!;
        request.mockImplementation(async (command: SourceServerRequest) => {
            if (command.operation === 'update') {
                inventory = [command.source!];
                revision = '"accepted"';
                return { status: 200, body: command.source, etag: revision };
            }
            return implementation(command);
        });
        await store.dbUpsertAppPlaylist({
            ...rows.get('a')!,
            title: 'Updated here',
        });
        await service.refresh();
        expect(rows.get('a')?.sourceSyncBase?.title).toBe('Updated here');
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it('notifies a sibling tab when another tab already changed or deleted the shared projection', async () => {
        inventory = [source];
        await service.initialize();
        await service.refresh();
        const firstStore = store;
        const sibling = TestBed.runInInjectionContext(
            () => new SourceSyncService()
        );
        const changed = jest.fn();
        sibling.changes.subscribe(changed);
        await sibling.initialize();
        await sibling.refresh();
        const initial = changed.mock.calls.length;
        const implementation = request.getMockImplementation()!;
        request.mockImplementation(async (command: SourceServerRequest) => {
            if (command.operation === 'update') {
                inventory = [command.source!];
                revision = '"renamed"';
                return { status: 200, body: command.source, etag: revision };
            }
            if (command.operation === 'delete') {
                inventory = [];
                revision = '"deleted"';
                return { status: 204 };
            }
            return implementation(command);
        });
        await firstStore.dbUpsertAppPlaylist({
            ...rows.get('a')!,
            title: 'Renamed elsewhere',
        });
        await service.refresh();
        await sibling.refresh();
        expect(changed).toHaveBeenCalledTimes(initial + 1);
        await firstStore.dbDeletePlaylist('a');
        await service.refresh();
        await sibling.refresh();
        expect(changed).toHaveBeenCalledTimes(initial + 2);
        expect([...sibling.sourceIds()]).toEqual([]);
        await sibling.refresh();
        expect(changed).toHaveBeenCalledTimes(initial + 2);
    });

    it('resolves browser discovery when an unrelated Electron global has no source bridge', async () => {
        const oldElectron = window.electron;
        const errors = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const pending = {
            apiUrl: 'https://nas.test/api',
            instanceId: 'pending:https://nas.test/api',
        };
        try {
            window.electron = {} as typeof window.electron;
            localStorage.setItem(
                'iptvnator:source-server',
                JSON.stringify(pending)
            );
            (sourceConnection as jest.Mock).mockReturnValue(pending);
            const recovery = TestBed.runInInjectionContext(
                () => new SourceSyncService()
            );
            await recovery.initialize();
            await recovery.refresh();
            expect(
                JSON.parse(localStorage.getItem('iptvnator:source-server')!)
            ).toEqual({ ...pending, instanceId: 'nas' });
            expect(recovery.errorKey()).toBeNull();
        } finally {
            window.electron = oldElectron;
            localStorage.removeItem('iptvnator:source-server');
            errors.mockRestore();
        }
    });

    it('keeps the selected cache isolated when a different NAS database appears at the same URL', async () => {
        receipt = '1';
        rows.set('a', applySourceDefinition(source));
        request.mockImplementationOnce(async () => ({
            status: 200,
            body: { ...instance, instanceId: 'replacement' },
        }));
        await service.initialize();
        await service.refresh();
        expect(service.state()).toBe('offline');
        expect(service.errorKey()).toBe('SOURCE_SYNC.INSTANCE_CHANGED');
        expect(rows.size).toBe(1);
        expect(request).toHaveBeenCalledTimes(1);
    });
});
