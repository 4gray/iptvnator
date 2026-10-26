import { TestBed } from '@angular/core/testing';
import { LazySnackBar } from '../lazy-snack-bar/lazy-snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import {
    applySourceDefinition,
    type Playlist,
    type SourceDefinition,
    type SourceServerRequest,
} from '@iptvnator/shared/interfaces';
import { DataService } from '../data.service';
import { PLAYLIST_DELETE_CLEANUP } from '../playlist-delete-cleanup.token';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { requestSourceServer } from './source-api';
import { sourceConnection } from './source-connection';
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

    beforeEach(() => {
        rows = new Map();
        receipt = null;
        inventory = [];
        revision = '"inventory-1"';
        cleanup = jest.fn();
        finish = jest.fn();
        notify = jest.fn();
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
                { provide: DataService, useValue: {} },
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

    it('preserves a completed cache offline and rejects source writes until reconnecting', async () => {
        receipt = '1';
        rows.set('a', applySourceDefinition(source));
        request.mockRejectedValueOnce(new Error('unreachable'));
        await service.initialize();
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

    it('reports a stale edit and retains the accepted local projection', async () => {
        inventory = [source];
        await service.initialize();
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

    it('keeps the selected cache isolated when a different NAS database appears at the same URL', async () => {
        receipt = '1';
        rows.set('a', applySourceDefinition(source));
        request.mockImplementationOnce(async () => ({
            status: 200,
            body: { ...instance, instanceId: 'replacement' },
        }));
        await service.initialize();
        expect(service.state()).toBe('offline');
        expect(service.errorKey()).toBe('SOURCE_SYNC.INSTANCE_CHANGED');
        expect(rows.size).toBe(1);
        expect(request).toHaveBeenCalledTimes(1);
    });
});
