import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { PlaylistInfoComponent } from './playlist-info.component';

describe('PlaylistInfoComponent', () => {
    let component: PlaylistInfoComponent;
    let fixture: ComponentFixture<PlaylistInfoComponent>;
    let playlistsService: {
        getRawPlaylistById: jest.Mock;
    };
    let databaseService: {
        updateXtreamPlaylistDetails: jest.Mock;
    };
    let runtime: {
        isElectron: boolean;
        supportsDesktopFileSave: boolean;
        supportsXtreamSqliteDataSource: boolean;
    };
    let snackBar: {
        open: jest.Mock;
    };
    let store: {
        dispatch: jest.Mock;
    };
    let dialogRef: {
        close: jest.Mock;
    };
    const originalElectron = window.electron;

    const playlist = {
        id: 'playlist-1',
        _id: 'playlist-1',
        title: 'My Playlist',
        count: 1,
        importDate: '2026-04-01T00:00:00.000Z',
        autoRefresh: false,
        url: 'https://example.com/playlist.m3u',
    } as Playlist & { id: string };

    beforeEach(async () => {
        playlistsService = {
            getRawPlaylistById: jest.fn(() => of('#EXTM3U\n')),
        };
        databaseService = {
            updateXtreamPlaylistDetails: jest.fn(),
        };
        runtime = {
            isElectron: false,
            supportsDesktopFileSave: false,
            supportsXtreamSqliteDataSource: false,
        };
        snackBar = {
            open: jest.fn(),
        };
        store = {
            dispatch: jest.fn(),
        };
        dialogRef = {
            close: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [PlaylistInfoComponent],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: playlist,
                },
                {
                    provide: PlaylistsService,
                    useValue: playlistsService,
                },
                {
                    provide: DatabaseService,
                    useValue: databaseService,
                },
                {
                    provide: Store,
                    useValue: store,
                },
                {
                    provide: MatSnackBar,
                    useValue: snackBar,
                },
                {
                    provide: MatDialogRef,
                    useValue: dialogRef,
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
                },
            ],
        }).compileComponents();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        window.electron = originalElectron;
    });

    function createComponent(): void {
        fixture = TestBed.createComponent(PlaylistInfoComponent);
        component = fixture.componentInstance;
    }

    it('saves Xtream playlist details through playlist metadata in the browser context', async () => {
        const xtreamPlaylist = {
            ...playlist,
            title: 'Old Xtream',
            serverUrl: 'http://old.example:8080',
            username: 'old-user',
            password: 'old-pass',
            url: undefined,
        } as Playlist & { id: string };
        TestBed.overrideProvider(MAT_DIALOG_DATA, {
            useValue: xtreamPlaylist,
        });
        createComponent();

        const updatedPlaylist = {
            _id: 'playlist-1',
            title: 'Updated Xtream',
            serverUrl: 'http://new.example:8080',
            username: 'new-user',
            password: 'new-pass',
        };

        await component.saveChanges(updatedPlaylist);

        expect(
            databaseService.updateXtreamPlaylistDetails
        ).not.toHaveBeenCalled();
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylistMeta({ playlist: updatedPlaylist })
        );
        expect(snackBar.open).toHaveBeenCalledWith(
            'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS',
            'CLOSE',
            { duration: 3000 }
        );
        expect(dialogRef.close).toHaveBeenCalledTimes(1);
    });

    it('normalizes edited Xtream playlist credentials before saving metadata', async () => {
        const xtreamPlaylist = {
            ...playlist,
            title: 'Old Xtream',
            serverUrl: 'http://old.example:8080',
            username: 'old-user',
            password: 'old-pass',
            url: undefined,
        } as Playlist & { id: string };
        TestBed.overrideProvider(MAT_DIALOG_DATA, {
            useValue: xtreamPlaylist,
        });
        createComponent();

        await component.saveChanges({
            _id: 'playlist-1',
            title: 'Updated Xtream',
            serverUrl:
                ' http://new.example:8080/live/player_api.php?username=ignored&password=ignored ',
            username: ' new-user ',
            password: ' new-pass ',
        });

        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    _id: 'playlist-1',
                    title: 'Updated Xtream',
                    serverUrl: 'http://new.example:8080/live',
                    username: 'new-user',
                    password: 'new-pass',
                },
            })
        );
    });

    it('normalizes edited Xtream playlist details before updating the Electron database', async () => {
        const xtreamPlaylist = {
            ...playlist,
            title: 'Old Xtream',
            serverUrl: 'http://old.example:8080',
            username: 'old-user',
            password: 'old-pass',
            url: undefined,
        } as Playlist & { id: string };
        runtime.supportsXtreamSqliteDataSource = true;
        databaseService.updateXtreamPlaylistDetails.mockResolvedValue(true);
        TestBed.overrideProvider(MAT_DIALOG_DATA, {
            useValue: xtreamPlaylist,
        });
        createComponent();

        await component.saveChanges({
            _id: 'playlist-1',
            title: 'Updated Xtream',
            serverUrl:
                ' http://new.example:8080/get.php?username=ignored&password=ignored&type=m3u_plus&output=ts ',
            username: ' new-user ',
            password: ' new-pass ',
        });

        expect(
            databaseService.updateXtreamPlaylistDetails
        ).toHaveBeenCalledWith({
            id: 'playlist-1',
            title: 'Updated Xtream',
            serverUrl: 'http://new.example:8080',
            username: 'new-user',
            password: 'new-pass',
        });
    });

    it('uses the Electron save dialog when desktop file saving is available', async () => {
        runtime.isElectron = true;
        runtime.supportsDesktopFileSave = true;
        window.electron = {
            saveFileDialog: jest.fn().mockResolvedValue('/tmp/export.m3u8'),
            writeFile: jest.fn().mockResolvedValue({ success: true }),
        } as typeof window.electron;
        createComponent();

        await component.exportPlaylist();

        expect(window.electron.saveFileDialog).toHaveBeenCalledWith(
            'My Playlist.m3u8',
            [{ name: 'Playlist', extensions: ['m3u8', 'm3u'] }]
        );
        expect(window.electron.writeFile).toHaveBeenCalledWith(
            '/tmp/export.m3u8',
            '#EXTM3U\n'
        );
        expect(snackBar.open).toHaveBeenCalledWith(
            'HOME.PLAYLISTS.INFO_DIALOG.PLAYLIST_EXPORT_SUCCESS',
            'CLOSE',
            { duration: 3000 }
        );
    });

    it('uses file-save capability for desktop-only playlist details UI', () => {
        runtime.isElectron = true;
        runtime.supportsDesktopFileSave = false;
        createComponent();

        expect(component.isDesktop).toBe(false);
    });

    it('falls back to browser download when desktop file saving is unavailable', async () => {
        const clickSpy = jest
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation();
        createComponent();

        await component.exportPlaylist();

        expect(playlistsService.getRawPlaylistById).toHaveBeenCalledWith(
            'playlist-1'
        );
        expect(clickSpy).toHaveBeenCalledTimes(1);
    });
});
