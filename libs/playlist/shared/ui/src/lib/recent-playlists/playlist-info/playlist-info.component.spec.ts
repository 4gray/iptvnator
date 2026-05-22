import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
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
    let runtime: {
        isElectron: boolean;
        supportsDesktopFileSave: boolean;
    };
    let snackBar: {
        open: jest.Mock;
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
        runtime = {
            isElectron: false,
            supportsDesktopFileSave: false,
        };
        snackBar = {
            open: jest.fn(),
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
                    useValue: {
                        updateXtreamPlaylistDetails: jest.fn(),
                    },
                },
                {
                    provide: Store,
                    useValue: {
                        dispatch: jest.fn(),
                    },
                },
                {
                    provide: MatSnackBar,
                    useValue: snackBar,
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
