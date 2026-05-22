import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { DatabaseService } from './database-electron.service';
import { PlaylistDeleteActionService } from './playlist-delete-action.service';
import { PlaylistsService } from './playlists.service';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

describe('PlaylistDeleteActionService', () => {
    const playlist = {
        _id: 'playlist-1',
        title: 'Demo Playlist',
        serverUrl: 'http://demo.example',
    } as PlaylistMeta;

    let databaseService: {
        createOperationId: jest.Mock<string, [string]>;
        deletePlaylist: jest.Mock<Promise<boolean>, unknown[]>;
    };
    let playlistsService: {
        deletePlaylist: jest.Mock;
    };
    let runtime: {
        supportsSqlite: boolean;
    };

    beforeEach(() => {
        databaseService = {
            createOperationId: jest
                .fn<string, [string]>()
                .mockReturnValue('playlist-delete-1'),
            deletePlaylist: jest.fn(async () => true),
        };
        playlistsService = {
            deletePlaylist: jest.fn(() => of({ success: true })),
        };
        runtime = {
            supportsSqlite: false,
        };

        TestBed.configureTestingModule({
            providers: [
                PlaylistDeleteActionService,
                { provide: DatabaseService, useValue: databaseService },
                { provide: PlaylistsService, useValue: playlistsService },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
            ],
        });
    });

    it('deletes browser playlists through PlaylistsService', async () => {
        const service = TestBed.inject(PlaylistDeleteActionService);

        await expect(service.deletePlaylist(playlist)).resolves.toBe(true);

        expect(playlistsService.deletePlaylist).toHaveBeenCalledWith(
            'playlist-1'
        );
        expect(databaseService.deletePlaylist).not.toHaveBeenCalled();
    });

    it('deletes SQLite-backed Xtream playlists through DatabaseService with progress options', async () => {
        runtime.supportsSqlite = true;
        const onEvent = jest.fn();
        const service = TestBed.inject(PlaylistDeleteActionService);

        await expect(
            service.deletePlaylist(playlist, { onEvent })
        ).resolves.toBe(true);

        expect(databaseService.createOperationId).toHaveBeenCalledWith(
            'playlist-delete'
        );
        expect(databaseService.deletePlaylist).toHaveBeenCalledWith(
            'playlist-1',
            {
                operationId: 'playlist-delete-1',
                onEvent,
            }
        );
        expect(playlistsService.deletePlaylist).not.toHaveBeenCalled();
    });

    it('deletes SQLite-backed non-Xtream playlists without progress options', async () => {
        runtime.supportsSqlite = true;
        const service = TestBed.inject(PlaylistDeleteActionService);

        await expect(
            service.deletePlaylist({
                ...playlist,
                serverUrl: undefined,
            } as PlaylistMeta)
        ).resolves.toBe(true);

        expect(databaseService.createOperationId).not.toHaveBeenCalled();
        expect(databaseService.deletePlaylist).toHaveBeenCalledWith(
            'playlist-1',
            undefined
        );
    });

    it('uses browser playlist storage when the Electron bridge lacks SQLite storage support', async () => {
        runtime.supportsSqlite = false;
        const service = TestBed.inject(PlaylistDeleteActionService);

        await expect(service.deletePlaylist(playlist)).resolves.toBe(true);

        expect(playlistsService.deletePlaylist).toHaveBeenCalledWith(
            'playlist-1'
        );
        expect(databaseService.deletePlaylist).not.toHaveBeenCalled();
    });
});
