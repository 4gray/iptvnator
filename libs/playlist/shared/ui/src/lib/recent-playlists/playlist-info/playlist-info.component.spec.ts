import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
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
    let epgBridge: {
        supportsDataManagement: boolean;
        forceFetchEpg: jest.Mock;
        clearEpgDataForSource: jest.Mock;
    };
    let runtime: {
        isElectron: boolean;
        supportsDesktopFileSave: boolean;
        supportsXtreamSqliteDataSource: boolean;
    };
    let settingsStore: {
        getSettings: jest.Mock;
        getTrustOptions: jest.Mock;
        updateSettings: jest.Mock;
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
        epgBridge = {
            supportsDataManagement: true,
            forceFetchEpg: jest.fn().mockResolvedValue({ success: true }),
            clearEpgDataForSource: jest
                .fn()
                .mockResolvedValue({ success: true }),
        };
        runtime = {
            isElectron: false,
            supportsDesktopFileSave: false,
            supportsXtreamSqliteDataSource: false,
        };
        settingsStore = {
            getSettings: jest.fn(() => ({
                epgUrl: [],
            })),
            getTrustOptions: jest.fn(() => ({
                trustedPrivateNetworkEpgUrls: [],
                trustedInsecureTlsHosts: [],
            })),
            updateSettings: jest.fn().mockResolvedValue(undefined),
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
                    provide: EpgRuntimeBridgeService,
                    useValue: epgBridge,
                },
                {
                    provide: Store,
                    useValue: store,
                },
                {
                    provide: SettingsStore,
                    useValue: settingsStore,
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
                        currentLang: 'en',
                        get: jest.fn((key: string) => of(key)),
                        instant: jest.fn((key: string) => key),
                        onDefaultLangChange: of({
                            lang: 'en',
                            translations: {},
                        }),
                        onLangChange: of({ lang: 'en', translations: {} }),
                        onTranslationChange: of({
                            lang: 'en',
                            translations: {},
                        }),
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

    it('normalizes detected playlist EPG source URLs for the details UI', () => {
        TestBed.overrideProvider(MAT_DIALOG_DATA, {
            useValue: {
                ...playlist,
                epgUrls: [
                    ' https://playlist.example.com/guide.xml ',
                    '',
                    'https://playlist.example.com/guide.xml',
                    'https://playlist.example.com/backup.xml',
                ],
            },
        });
        createComponent();

        expect(component.playlistEpgUrls).toEqual([
            'https://playlist.example.com/guide.xml',
            'https://playlist.example.com/backup.xml',
        ]);
    });

    it('keeps disabled detected playlist EPG candidates visible in the details UI summary', () => {
        TestBed.overrideProvider(MAT_DIALOG_DATA, {
            useValue: {
                ...playlist,
                epgUrls: ['https://playlist.example.com/ua.xml'],
                detectedEpgUrls: [
                    'https://playlist.example.com/ua.xml',
                    'https://playlist.example.com/de.xml',
                    'https://playlist.example.com/us.xml',
                    'https://playlist.example.com/fr.xml',
                ],
            },
        });
        createComponent();

        expect(component.playlistDetectedEpgUrls).toEqual([
            'https://playlist.example.com/ua.xml',
            'https://playlist.example.com/de.xml',
            'https://playlist.example.com/us.xml',
            'https://playlist.example.com/fr.xml',
        ]);
        expect(component.hiddenDetectedPlaylistEpgSourceCount).toBe(3);
    });

    it('refreshes a detected playlist EPG source through the runtime bridge', async () => {
        createComponent();

        await component.refreshPlaylistEpgSource(
            ' https://playlist.example.com/guide.xml '
        );

        expect(epgBridge.forceFetchEpg).toHaveBeenCalledWith(
            'https://playlist.example.com/guide.xml',
            {
                trustedPrivateNetworkEpgUrls: [],
                trustedInsecureTlsHosts: [],
            }
        );
        expect(settingsStore.updateSettings).not.toHaveBeenCalled();
        expect(snackBar.open).toHaveBeenCalledWith(
            'EPG.FETCH_SUCCESS',
            'CLOSE',
            { duration: 3000 }
        );
    });

    it('adds a detected playlist EPG source to global settings on request', async () => {
        settingsStore.getSettings.mockReturnValue({
            epgUrl: [
                'https://global.example.com/guide.xml',
                'https://playlist.example.com/guide.xml',
            ],
        });
        createComponent();

        await component.addPlaylistEpgSourceToSettings(
            'https://new-playlist.example.com/guide.xml'
        );

        expect(settingsStore.updateSettings).toHaveBeenCalledWith({
            epgUrl: [
                'https://global.example.com/guide.xml',
                'https://playlist.example.com/guide.xml',
                'https://new-playlist.example.com/guide.xml',
            ],
        });
        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.ADD_EPG_SOURCE',
            'CLOSE',
            { duration: 3000 }
        );
    });

    it('does not duplicate a playlist EPG source that already exists globally', async () => {
        settingsStore.getSettings.mockReturnValue({
            epgUrl: ['https://playlist.example.com/guide.xml'],
        });
        createComponent();

        await component.addPlaylistEpgSourceToSettings(
            ' https://playlist.example.com/guide.xml '
        );

        expect(settingsStore.updateSettings).not.toHaveBeenCalled();
    });

    it('removes a detected playlist EPG source from the enabled list and records it as disabled', async () => {
        TestBed.overrideProvider(MAT_DIALOG_DATA, {
            useValue: {
                ...playlist,
                epgUrls: [
                    'https://playlist.example.com/keep.xml',
                    'https://playlist.example.com/remove.xml',
                ],
                detectedEpgUrls: [
                    'https://playlist.example.com/keep.xml',
                    'https://playlist.example.com/remove.xml',
                ],
                manualEpgUrls: ['https://playlist.example.com/manual.xml'],
                disabledEpgUrls: ['https://playlist.example.com/old.xml'],
            },
        });
        createComponent();

        await component.removePlaylistEpgSource(
            'https://playlist.example.com/remove.xml'
        );

        expect(epgBridge.clearEpgDataForSource).toHaveBeenCalledWith(
            'https://playlist.example.com/remove.xml'
        );
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylistMeta({
                playlist: expect.objectContaining({
                    _id: 'playlist-1',
                    epgUrls: [
                        'https://playlist.example.com/keep.xml',
                        'https://playlist.example.com/manual.xml',
                    ],
                    detectedEpgUrls: [
                        'https://playlist.example.com/keep.xml',
                        'https://playlist.example.com/remove.xml',
                    ],
                    manualEpgUrls: ['https://playlist.example.com/manual.xml'],
                    disabledEpgUrls: [
                        'https://playlist.example.com/old.xml',
                        'https://playlist.example.com/remove.xml',
                    ],
                }),
            })
        );
    });

    it('keeps a playlist EPG source enabled when source data cleanup fails', async () => {
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        try {
            epgBridge.clearEpgDataForSource.mockRejectedValueOnce(
                new Error('Database cleanup failed')
            );
            TestBed.overrideProvider(MAT_DIALOG_DATA, {
                useValue: {
                    ...playlist,
                    epgUrls: [
                        'https://playlist.example.com/keep.xml',
                        'https://playlist.example.com/remove.xml',
                    ],
                    detectedEpgUrls: [
                        'https://playlist.example.com/keep.xml',
                        'https://playlist.example.com/remove.xml',
                    ],
                    manualEpgUrls: [],
                    disabledEpgUrls: [],
                },
            });
            createComponent();

            await component.removePlaylistEpgSource(
                'https://playlist.example.com/remove.xml'
            );

            expect(epgBridge.clearEpgDataForSource).toHaveBeenCalledWith(
                'https://playlist.example.com/remove.xml'
            );
            expect(store.dispatch).not.toHaveBeenCalled();
            expect(snackBar.open).toHaveBeenCalledWith(
                'SETTINGS.EPG_DATA_CLEAR_FAILED',
                'CLOSE',
                { duration: 3000 }
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it('adds playlist-local EPG sources with URL normalization and deduplication', async () => {
        TestBed.overrideProvider(MAT_DIALOG_DATA, {
            useValue: {
                ...playlist,
                epgUrls: ['https://playlist.example.com/existing.xml'],
                detectedEpgUrls: ['https://playlist.example.com/existing.xml'],
                manualEpgUrls: ['https://playlist.example.com/manual.xml'],
                disabledEpgUrls: ['https://playlist.example.com/new.xml'],
            },
        });
        createComponent();

        component.playlistEpgSourceInputs
            .at(0)
            .setValue(' https://playlist.example.com/new.xml ');
        component.addPlaylistEpgSourceInput();
        component.playlistEpgSourceInputs
            .at(1)
            .setValue('https://playlist.example.com/manual.xml');

        component.savePlaylistEpgSources();

        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylistMeta({
                playlist: expect.objectContaining({
                    _id: 'playlist-1',
                    epgUrls: [
                        'https://playlist.example.com/existing.xml',
                        'https://playlist.example.com/new.xml',
                        'https://playlist.example.com/manual.xml',
                    ],
                    manualEpgUrls: [
                        'https://playlist.example.com/manual.xml',
                        'https://playlist.example.com/new.xml',
                    ],
                    disabledEpgUrls: [],
                }),
            })
        );
        expect(component.playlistEpgSourceInputs.length).toBe(1);
        expect(component.playlistEpgSourceInputs.at(0).value).toBe('');
    });

    it('shows a validation error for invalid playlist-local EPG source URLs', () => {
        createComponent();
        fixture.detectChanges();

        component.playlistEpgSourceInputs.at(0).setValue('not a url');
        component.savePlaylistEpgSources();
        fixture.detectChanges();

        expect(store.dispatch).not.toHaveBeenCalled();
        expect(fixture.nativeElement.textContent).toContain(
            'SETTINGS.EPG_URL_ERROR'
        );
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
