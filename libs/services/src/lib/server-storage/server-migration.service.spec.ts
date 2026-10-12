import { TestBed } from '@angular/core/testing';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { of } from 'rxjs';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';
import { ServerStorageSession } from './server-storage-session';
import { ServerMigrationService } from './server-migration.service';

describe('ServerMigrationService', () => {
    const browserPlaylists = [
        { _id: 'm', title: 'Family', url: 'http://lists.test/family.m3u' },
        {
            _id: 'x',
            title: 'Provider',
            serverUrl: 'http://panel.test',
            username: 'user',
        },
    ];
    let session: {
        fetchStatus: jest.Mock;
        documentStore: {
            dbGetAppPlaylist: jest.Mock;
            dbGetAppPlaylistMetas: jest.Mock;
            dbUpsertAppPlaylist: jest.Mock;
        };
        api: { getJson: jest.Mock; sendJson: jest.Mock };
        userData: {
            flush: jest.Mock;
            hasUnsentWrites: jest.Mock;
            hydrate: jest.Mock;
        };
    };

    beforeEach(() => {
        session = {
            fetchStatus: jest.fn().mockResolvedValue({ playlists: 0 }),
            documentStore: {
                dbGetAppPlaylist: jest.fn().mockResolvedValue(null),
                dbGetAppPlaylistMetas: jest.fn().mockResolvedValue([]),
                dbUpsertAppPlaylist: jest
                    .fn()
                    .mockResolvedValue({ success: true }),
            },
            api: {
                getJson: jest.fn().mockResolvedValue({ entries: {} }),
                sendJson: jest.fn().mockResolvedValue(undefined),
            },
            userData: {
                flush: jest.fn().mockResolvedValue(undefined),
                hasUnsentWrites: jest.fn(() => false),
                hydrate: jest.fn().mockResolvedValue(undefined),
            },
        };
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: NgxIndexedDBService,
                    useValue: { getAll: () => of(browserPlaylists) },
                },
                { provide: ServerStorageSession, useValue: session },
                {
                    provide: SERVER_STORAGE_CONFIG,
                    useValue: {
                        baseUrl: '/api',
                        instance: { instanceId: 'i-1' },
                    },
                },
            ],
        });
    });

    afterEach(() => {
        localStorage.clear();
        TestBed.resetTestingModule();
    });

    it('offers the move on an empty server and summarizes browser playlists', async () => {
        const offer = await TestBed.inject(
            ServerMigrationService
        ).offerOnStartup();

        expect(offer).toEqual([
            { id: 'm', title: 'Family', kind: 'm3u' },
            { id: 'x', title: 'Provider', kind: 'xtream' },
        ]);
    });

    it('does not offer after a decision or when the server has playlists', async () => {
        const migration = TestBed.inject(ServerMigrationService);
        session.fetchStatus.mockResolvedValueOnce({ playlists: 3 });
        expect(await migration.offerOnStartup()).toBeNull();

        migration.skip();
        expect(await migration.offerOnStartup()).toBeNull();
    });

    it('copies playlists with their ids and their Xtream user data to an empty server', async () => {
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ x: ['live:1'], other: ['live:2'] })
        );
        const migration = TestBed.inject(ServerMigrationService);

        const result = await migration.moveBrowserData();

        expect(result).toEqual({ imported: 2, merged: 0, failed: 0 });
        expect(session.documentStore.dbUpsertAppPlaylist).toHaveBeenCalledTimes(
            2
        );
        expect(session.api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/x',
            { value: ['live:1'] }
        );
        expect(session.api.sendJson).toHaveBeenCalledTimes(1);
        // Queued edits were sent before the combined values were read.
        expect(session.userData.flush.mock.invocationCallOrder[0]).toBeLessThan(
            session.api.getJson.mock.invocationCallOrder[0]
        );
        expect(session.userData.hydrate).toHaveBeenCalled();
        expect(migration.browserDataMoved()).toBe(true);
    });

    it('merges into the server copy and combines Xtream data under its id', async () => {
        session.documentStore.dbGetAppPlaylistMetas.mockResolvedValue([
            {
                _id: 'server-x',
                title: 'Provider',
                serverUrl: 'http://panel.test/',
                username: 'user',
            },
            {
                _id: 'server-m',
                title: 'Family',
                url: 'http://lists.test/family.m3u',
            },
        ]);
        session.api.getJson.mockResolvedValue({
            entries: {
                'xtream-recent-items': { 'server-x': ['vod:9'] },
            },
        });
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ x: ['live:1'] })
        );
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({ x: ['vod:1', 'vod:9'] })
        );

        const result = await TestBed.inject(
            ServerMigrationService
        ).moveBrowserData();

        expect(result).toEqual({ imported: 0, merged: 2, failed: 0 });
        expect(
            session.documentStore.dbUpsertAppPlaylist
        ).not.toHaveBeenCalled();
        expect(session.api.sendJson.mock.calls).toEqual([
            [
                'PUT',
                '/user-state/xtream-favorites/server-x',
                { value: ['live:1'] },
            ],
            [
                'PUT',
                '/user-state/xtream-recent-items/server-x',
                { value: ['vod:9', 'vod:1'] },
            ],
        ]);
    });

    it('combines browser duplicates of one source in one write', async () => {
        TestBed.overrideProvider(NgxIndexedDBService, {
            useValue: {
                getAll: () =>
                    of([
                        browserPlaylists[1],
                        { ...browserPlaylists[1], _id: 'x2' },
                    ]),
            },
        });
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ x: ['live:1'], x2: ['live:2'] })
        );

        const result = await TestBed.inject(
            ServerMigrationService
        ).moveBrowserData();

        expect(result).toEqual({ imported: 1, merged: 1, failed: 0 });
        expect(session.api.sendJson.mock.calls).toEqual([
            [
                'PUT',
                '/user-state/xtream-favorites/x',
                { value: ['live:1', 'live:2'] },
            ],
        ]);
    });

    it("adds a browser document's favorites to the matching server playlist", async () => {
        TestBed.overrideProvider(NgxIndexedDBService, {
            useValue: {
                getAll: () =>
                    of([
                        {
                            ...browserPlaylists[0],
                            favorites: ['b1', 'b2'],
                            playlist: {
                                items: [
                                    { id: 'b1', url: 'http://s/1' },
                                    { id: 'b2', url: 'http://s/2' },
                                ],
                            },
                        },
                    ]),
            },
        });
        session.documentStore.dbGetAppPlaylistMetas.mockResolvedValue([
            { _id: 'server-m', title: 'Family', url: browserPlaylists[0].url },
        ]);
        // The server imported the same list: same URLs, other channel ids.
        const stored = {
            _id: 'server-m',
            title: 'Family',
            url: browserPlaylists[0].url,
            favorites: ['s1'],
            recentlyViewed: [],
            playlist: {
                items: [
                    { id: 's1', url: 'http://s/1' },
                    { id: 's2', url: 'http://s/2' },
                ],
            },
        };
        session.documentStore.dbGetAppPlaylist.mockResolvedValue(stored);

        const result = await TestBed.inject(
            ServerMigrationService
        ).moveBrowserData();

        expect(result).toEqual({ imported: 0, merged: 1, failed: 0 });
        expect(session.documentStore.dbUpsertAppPlaylist).toHaveBeenCalledWith({
            ...stored,
            favorites: ['s1', 's2'],
            recentlyViewed: [],
        });
    });

    it('keeps the move on offer when a playlist could not be uploaded', async () => {
        session.documentStore.dbUpsertAppPlaylist
            .mockRejectedValueOnce(new Error('413'))
            .mockResolvedValue({ success: true });
        const migration = TestBed.inject(ServerMigrationService);

        const result = await migration.moveBrowserData();

        expect(result).toEqual({ imported: 1, merged: 0, failed: 1 });
        expect(migration.browserDataMoved()).toBe(false);

        // A second run merges the moved one and retries the other.
        session.documentStore.dbGetAppPlaylistMetas.mockResolvedValue([
            browserPlaylists[1],
        ]);
        await expect(migration.moveBrowserData()).resolves.toEqual({
            imported: 1,
            merged: 1,
            failed: 0,
        });
        expect(migration.browserDataMoved()).toBe(true);
    });

    it('does not start while user-data writes are still unsent', async () => {
        session.userData.hasUnsentWrites.mockReturnValue(true);
        const migration = TestBed.inject(ServerMigrationService);

        await expect(migration.moveBrowserData()).rejects.toThrow('Unsent');
        expect(
            session.documentStore.dbUpsertAppPlaylist
        ).not.toHaveBeenCalled();
        expect(session.api.sendJson).not.toHaveBeenCalled();
        expect(migration.browserDataMoved()).toBe(false);
    });

    it('counts a duplicate of a failed upload as failed, not merged', async () => {
        TestBed.overrideProvider(NgxIndexedDBService, {
            useValue: {
                getAll: () =>
                    of([
                        browserPlaylists[1],
                        { ...browserPlaylists[1], _id: 'x2' },
                    ]),
            },
        });
        session.documentStore.dbUpsertAppPlaylist.mockRejectedValue(
            new Error('500')
        );
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ x: ['live:1'], x2: ['live:2'] })
        );

        const result = await TestBed.inject(
            ServerMigrationService
        ).moveBrowserData();

        expect(result).toEqual({ imported: 0, merged: 0, failed: 2 });
        expect(session.api.sendJson).not.toHaveBeenCalled();
    });
});
