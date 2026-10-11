import { TestBed } from '@angular/core/testing';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { of } from 'rxjs';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import { PlaylistBackupService } from '../playlist-backup.service';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';
import { ServerStorageSession } from './server-storage-session';
import { ServerMigrationService } from './server-migration.service';

describe('ServerMigrationService', () => {
    const browserPlaylists = [
        { _id: 'm', title: 'Family' },
        { _id: 'x', title: 'Provider', serverUrl: 'http://panel.test' },
    ];
    let session: {
        fetchStatus: jest.Mock;
        documentStore: { dbUpsertAppPlaylist: jest.Mock };
        api: { sendJson: jest.Mock };
        userData: { hydrate: jest.Mock };
    };
    let backup: { exportBackup: jest.Mock; importBackup: jest.Mock };

    beforeEach(() => {
        session = {
            fetchStatus: jest.fn().mockResolvedValue({ playlists: 0 }),
            documentStore: {
                dbUpsertAppPlaylist: jest
                    .fn()
                    .mockResolvedValue({ success: true }),
            },
            api: { sendJson: jest.fn().mockResolvedValue(undefined) },
            userData: { hydrate: jest.fn().mockResolvedValue(undefined) },
        };
        backup = {
            exportBackup: jest.fn().mockResolvedValue({ json: '{}' }),
            importBackup: jest.fn().mockResolvedValue({
                imported: 1,
                merged: 1,
                skipped: 0,
                failed: 0,
                errors: [],
            }),
        };
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: NgxIndexedDBService,
                    useValue: { getAll: () => of(browserPlaylists) },
                },
                { provide: ServerStorageSession, useValue: session },
                { provide: PlaylistBackupService, useValue: backup },
                {
                    provide: PlaylistStorageBackend,
                    useValue: {
                        runWithBrowserStorage: (task: () => Promise<unknown>) =>
                            task(),
                    },
                },
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
        expect(migration.browserDataMoved()).toBe(true);
    });

    it('merges through the backup format when the server already has playlists', async () => {
        session.fetchStatus.mockResolvedValue({ playlists: 4 });

        const result = await TestBed.inject(
            ServerMigrationService
        ).moveBrowserData();

        expect(backup.exportBackup).toHaveBeenCalled();
        expect(backup.importBackup).toHaveBeenCalledWith('{}');
        expect(result).toEqual({ imported: 1, merged: 1, failed: 0 });
    });
});
