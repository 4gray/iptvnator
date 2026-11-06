import { TestBed } from '@angular/core/testing';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { of } from 'rxjs';
import { getXtreamPendingRestoreStorageKey } from '@iptvnator/shared/interfaces';
import { ParentalLockService } from '../parental-lock/parental-lock.service';
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
            dbCreateAppPlaylist: jest.Mock;
        };
        api: { getJson: jest.Mock; sendJson: jest.Mock };
        userData: {
            flush: jest.Mock;
            hasUnsentWrites: jest.Mock;
            hydrate: jest.Mock;
        };
    };

    const emptyLocks = () => ({ xtream: [], stalker: [], m3u: [] });
    let parentalLock: {
        ensureLocksReadable: jest.Mock;
        locksFor: jest.Mock;
        replacePlaylistLocks: jest.Mock;
    };

    beforeEach(() => {
        parentalLock = {
            ensureLocksReadable: jest.fn().mockResolvedValue(true),
            locksFor: jest.fn(() => emptyLocks()),
            replacePlaylistLocks: jest.fn().mockResolvedValue(true),
        };
        session = {
            fetchStatus: jest.fn().mockResolvedValue({ playlists: 0 }),
            documentStore: {
                dbGetAppPlaylist: jest.fn().mockResolvedValue(null),
                dbGetAppPlaylistMetas: jest.fn().mockResolvedValue([]),
                dbUpsertAppPlaylist: jest
                    .fn()
                    .mockResolvedValue({ success: true }),
                dbCreateAppPlaylist: jest.fn().mockResolvedValue(true),
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
                { provide: ParentalLockService, useValue: parentalLock },
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
        expect(session.documentStore.dbCreateAppPlaylist).toHaveBeenCalledTimes(
            2
        );
        expect(session.api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/x',
            { value: ['live:1'] },
            {}
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
                {},
            ],
            [
                'PUT',
                '/user-state/xtream-recent-items/server-x',
                { value: ['vod:9', 'vod:1'] },
                {},
            ],
        ]);
    });

    it("puts the browser's newer views ahead of the server's history", async () => {
        session.documentStore.dbGetAppPlaylistMetas.mockResolvedValue([
            { ...browserPlaylists[1], _id: 'server-x' },
        ]);
        const view = (id: string, day: number) => ({
            id,
            viewedAt: `2026-10-0${day}T20:00:00.000Z`,
        });
        session.api.getJson.mockResolvedValue({
            entries: {
                'xtream-recent-items': {
                    'server-x': [view('vod:9', 2), view('vod:8', 1)],
                },
            },
        });
        // vod:8 was watched again in this browser, with other artwork.
        const again = { ...view('vod:8', 4), backdropUrl: 'b.jpg' };
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({ x: [again, view('vod:1', 3)] })
        );

        await TestBed.inject(ServerMigrationService).moveBrowserData();

        // The app cuts history from the end: the newest view leads, and an
        // item keeps its newest view.
        expect(session.api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-recent-items/server-x',
            { value: [again, view('vod:1', 3), view('vod:9', 2)] },
            {}
        );
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
                {},
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
        // By stream URL, as the app looks favorites up.
        expect(session.documentStore.dbUpsertAppPlaylist).toHaveBeenCalledWith({
            ...stored,
            favorites: ['http://s/1', 'http://s/2'],
            recentlyViewed: [],
        });
    });

    it("keeps a document's newest view of an item both copies hold", async () => {
        const view = (day: number, extra = {}) => ({
            source: 'm3u',
            id: 'http://s/1',
            url: 'http://s/1',
            title: 'One',
            channel_id: 'b1',
            category_id: 'live',
            added_at: `2026-10-0${day}T20:00:00.000Z`,
            ...extra,
        });
        TestBed.overrideProvider(NgxIndexedDBService, {
            useValue: {
                getAll: () =>
                    of([
                        {
                            ...browserPlaylists[0],
                            recentlyViewed: [
                                view(3, { poster_url: 'new.png' }),
                            ],
                            playlist: {
                                items: [{ id: 'b1', url: 'http://s/1' }],
                            },
                        },
                    ]),
            },
        });
        session.documentStore.dbGetAppPlaylistMetas.mockResolvedValue([
            { _id: 'server-m', title: 'Family', url: browserPlaylists[0].url },
        ]);
        const stored = {
            _id: 'server-m',
            title: 'Family',
            url: browserPlaylists[0].url,
            favorites: [],
            // The same channel, watched there before this browser's view.
            recentlyViewed: [view(1, { channel_id: 's1' })],
            playlist: { items: [{ id: 's1', url: 'http://s/1' }] },
        };
        session.documentStore.dbGetAppPlaylist.mockResolvedValue(stored);

        await TestBed.inject(ServerMigrationService).moveBrowserData();

        // Not skipped for an unchanged length: the newer view replaces it.
        expect(session.documentStore.dbUpsertAppPlaylist).toHaveBeenCalledWith({
            ...stored,
            recentlyViewed: [
                view(3, { channel_id: 's1', poster_url: 'new.png' }),
            ],
        });
    });

    it('merges into a copy another tab or device uploaded first', async () => {
        TestBed.overrideProvider(NgxIndexedDBService, {
            useValue: {
                getAll: () =>
                    of([{ ...browserPlaylists[0], favorites: ['http://s/2'] }]),
            },
        });
        // The id was free when planned, taken when uploaded.
        session.documentStore.dbCreateAppPlaylist.mockResolvedValue(false);
        const first = {
            ...browserPlaylists[0],
            favorites: ['http://s/1'],
            recentlyViewed: [],
        };
        session.documentStore.dbGetAppPlaylist.mockResolvedValue(first);

        const result = await TestBed.inject(
            ServerMigrationService
        ).moveBrowserData();

        expect(result).toEqual({ imported: 0, merged: 1, failed: 0 });
        // Never overwritten: this browser's favorites join the first copy's.
        expect(session.documentStore.dbUpsertAppPlaylist).toHaveBeenCalledWith({
            ...first,
            favorites: ['http://s/1', 'http://s/2'],
        });
    });

    it('takes a parked Xtream restore along to the server playlist id', async () => {
        session.documentStore.dbGetAppPlaylistMetas.mockResolvedValue([
            { ...browserPlaylists[1], _id: 'server-x' },
        ]);
        // A browser backup import that could not finish.
        const parked = JSON.stringify({
            hiddenCategories: [],
            favorites: [{ xtreamId: 5, contentType: 'movie' }],
            recentlyViewed: [],
            playbackPositions: [],
        });
        localStorage.setItem(getXtreamPendingRestoreStorageKey('x'), parked);

        await TestBed.inject(ServerMigrationService).moveBrowserData();

        expect(
            localStorage.getItem(getXtreamPendingRestoreStorageKey('server-x'))
        ).toBe(parked);
    });

    it('keeps the move on offer when a playlist could not be uploaded', async () => {
        session.documentStore.dbCreateAppPlaylist
            .mockRejectedValueOnce(new Error('413'))
            .mockResolvedValue(true);
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
            session.documentStore.dbCreateAppPlaylist
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
        session.documentStore.dbCreateAppPlaylist.mockRejectedValue(
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

    it('takes parental locks along to the server playlist id', async () => {
        session.documentStore.dbGetAppPlaylistMetas.mockResolvedValue([
            {
                _id: 'server-x',
                title: 'Provider',
                serverUrl: 'http://panel.test',
                username: 'user',
            },
        ]);
        parentalLock.locksFor.mockImplementation((id: string) =>
            id === 'x'
                ? {
                      xtream: [{ categoryType: 'live', xtreamId: 5 }],
                      stalker: [],
                      m3u: [],
                  }
                : {
                      xtream: [{ categoryType: 'vod', xtreamId: 9 }],
                      stalker: [],
                      m3u: [],
                  }
        );

        const result = await TestBed.inject(
            ServerMigrationService
        ).moveBrowserData();

        expect(result.failed).toBe(0);
        expect(parentalLock.replacePlaylistLocks).toHaveBeenCalledWith(
            'server-x',
            {
                xtream: [
                    { categoryType: 'vod', xtreamId: 9 },
                    { categoryType: 'live', xtreamId: 5 },
                ],
                stalker: [],
                m3u: [],
            }
        );
    });

    it('keeps the move on offer while parental locks cannot be read', async () => {
        session.documentStore.dbGetAppPlaylistMetas.mockResolvedValue([
            {
                _id: 'server-x',
                title: 'Provider',
                serverUrl: 'http://panel.test',
                username: 'user',
            },
        ]);
        parentalLock.ensureLocksReadable.mockResolvedValue(false);

        const result = await TestBed.inject(
            ServerMigrationService
        ).moveBrowserData();

        expect(result.failed).toBeGreaterThan(0);
        expect(parentalLock.replacePlaylistLocks).not.toHaveBeenCalled();
    });

    it('keeps the move on offer when browser favorites cannot be read', async () => {
        localStorage.setItem('xtream-favorites', '{not json');
        const migration = TestBed.inject(ServerMigrationService);

        const result = await migration.moveBrowserData();

        expect(result.failed).toBeGreaterThan(0);
        expect(migration.browserDataMoved()).toBe(false);
    });

    it('uploads a legacy Stalker row with its portal flag set', async () => {
        TestBed.overrideProvider(NgxIndexedDBService, {
            useValue: {
                getAll: () =>
                    of([
                        {
                            _id: 's1',
                            title: 'Portal',
                            macAddress: '00:1A:79:00:00:01',
                            portalUrl: 'http://portal.test/stalker_portal/c',
                        },
                    ]),
            },
        });

        await TestBed.inject(ServerMigrationService).moveBrowserData();

        expect(session.documentStore.dbCreateAppPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({ _id: 's1', isFullStalkerPortal: true })
        );
    });

    it("does not take an inherited name for a playlist id's data", async () => {
        TestBed.overrideProvider(NgxIndexedDBService, {
            useValue: {
                getAll: () =>
                    of([{ _id: 'toString', title: 'Odd id', url: 'http://x' }]),
            },
        });
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ toString: ['live:1'] })
        );
        // The server has the namespace, but no entry for that id.
        session.api.getJson.mockResolvedValue({
            entries: { 'xtream-favorites': {} },
            tags: { 'xtream-favorites': {} },
        });

        const result = await TestBed.inject(
            ServerMigrationService
        ).moveBrowserData();

        expect(result.failed).toBe(0);
        expect(session.api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/toString',
            { value: ['live:1'] },
            { 'If-None-Match': '*' }
        );
    });
});
