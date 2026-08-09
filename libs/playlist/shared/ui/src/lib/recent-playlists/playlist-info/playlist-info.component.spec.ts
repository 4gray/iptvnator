import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { Playlist, PlaylistMeta } from '@iptvnator/shared/interfaces';
import { PlaylistInfoComponent } from './playlist-info.component';
import {
    STALKER_PLAYLIST_CONNECTION_EDITOR,
    STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS,
} from './stalker-playlist-connection-editor.token';

describe('PlaylistInfoComponent', () => {
    let component: PlaylistInfoComponent;
    let fixture: ComponentFixture<PlaylistInfoComponent>;
    let playlistsService: {
        getPlaylistById: jest.Mock;
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
        beforeClosed: jest.Mock;
        close: jest.Mock;
        disableClose: boolean;
    };
    let dialogBeforeClosed: Subject<void>;
    let stalkerConnectionEditor: {
        applyResolvedConnection: jest.Mock;
        resolveConnection: jest.Mock;
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
            getPlaylistById: jest.fn(),
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
        dialogBeforeClosed = new Subject<void>();
        dialogRef = {
            beforeClosed: jest.fn(() => dialogBeforeClosed),
            close: jest.fn(),
            disableClose: false,
        };
        stalkerConnectionEditor = {
            applyResolvedConnection: jest.fn(
                async (playlist: PlaylistMeta) => playlist
            ),
            resolveConnection: jest.fn(
                async (updatedPlaylist: PlaylistMeta) => ({
                    status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.RESOLVED,
                    playlist: updatedPlaylist,
                })
            ),
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
                {
                    provide: STALKER_PLAYLIST_CONNECTION_EDITOR,
                    useValue: stalkerConnectionEditor,
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

    describe('Stalker identity fields', () => {
        async function createStalkerComponent(
            overrides: Partial<Playlist> = {}
        ): Promise<void> {
            const stalkerPlaylist = {
                ...playlist,
                url: undefined,
                portalUrl: 'https://portal.example.com/c',
                macAddress: '00:1a:79:aa:bb:cc',
                isFullStalkerPortal: true,
                ...overrides,
            } as Playlist & { id: string };
            playlistsService.getPlaylistById.mockReturnValue(
                of(stalkerPlaylist)
            );
            TestBed.overrideProvider(MAT_DIALOG_DATA, {
                useValue: stalkerPlaylist,
            });
            createComponent();
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();
        }

        it('hydrates the complete stored row before editing a summarized Stalker playlist', async () => {
            const summary = {
                ...playlist,
                url: undefined,
                portalUrl: 'https://portal.example.com/c',
                macAddress: '00:1a:79:aa:bb:cc',
            } as Playlist & { id: string };
            const storedPlaylist = {
                ...summary,
                isFullStalkerPortal: true,
                stalkerSerialNumber: 'STORED-SERIAL',
                stalkerDeviceId1: 'STORED-DEVICE-1',
                stalkerDeviceId2: 'STORED-DEVICE-2',
                stalkerSignature1: 'STORED-SIGNATURE-1',
                stalkerSignature2: 'STORED-SIGNATURE-2',
            };
            const storedPlaylist$ = new Subject<Playlist>();
            playlistsService.getPlaylistById.mockReturnValue(storedPlaylist$);
            TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: summary });
            createComponent();
            fixture.detectChanges();

            expect(component.isHydratingStalkerPlaylist()).toBe(true);

            storedPlaylist$.next(storedPlaylist);
            storedPlaylist$.complete();
            await fixture.whenStable();
            component.playlistDetails
                .get('portalUrl')
                ?.setValue('https://new.example.com');

            await component.saveChanges(
                component.playlistDetails.getRawValue() as PlaylistMeta
            );

            expect(playlistsService.getPlaylistById).toHaveBeenCalledWith(
                'playlist-1'
            );
            expect(
                stalkerConnectionEditor.resolveConnection
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    portalUrl: 'https://new.example.com',
                    stalkerSerialNumber: 'STORED-SERIAL',
                    stalkerDeviceId1: 'STORED-DEVICE-1',
                    stalkerDeviceId2: 'STORED-DEVICE-2',
                    stalkerSignature1: 'STORED-SIGNATURE-1',
                    stalkerSignature2: 'STORED-SIGNATURE-2',
                })
            );
        });

        it('canonicalizes an edited MAC on blur', async () => {
            await createStalkerComponent();
            const control = component.playlistDetails.get('macAddress');
            control?.setValue('00-1a-79-ab-cd-ef');

            component.onMacAddressBlur();

            expect(control?.value).toBe('00:1A:79:AB:CD:EF');
            // The rewrite is a change the user has to save deliberately.
            expect(control?.dirty).toBe(true);
        });

        it('leaves a stored MAC untouched until it is edited', async () => {
            // Loading the dialog must not move the session fingerprint: the
            // stored lowercase MAC is what the portal already accepted.
            await createStalkerComponent();

            expect(component.playlistDetails.get('macAddress')?.value).toBe(
                '00:1a:79:aa:bb:cc'
            );
            expect(component.playlistDetails.pristine).toBe(true);
        });

        it('refuses to save a malformed MAC', async () => {
            await createStalkerComponent();
            const control = component.playlistDetails.get('macAddress');

            control?.setValue('00:1A:79:AA:BB');

            expect(control?.valid).toBe(false);
            expect(component.playlistDetails.valid).toBe(false);
        });

        it('canonicalizes the MAC on submit when no blur fired', async () => {
            // Pressing Enter inside the field submits without the field losing
            // focus, so `onMacAddressBlur` never runs.
            await createStalkerComponent();
            component.playlistDetails
                .get('macAddress')
                ?.setValue('00-1a-79-ab-cd-ef');

            await component.saveChanges(
                component.playlistDetails.value as PlaylistMeta
            );

            expect(store.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: expect.objectContaining({
                        macAddress: '00:1A:79:AB:CD:EF',
                    }) as PlaylistMeta,
                    persist: false,
                })
            );
            expect(
                stalkerConnectionEditor.resolveConnection
            ).toHaveBeenCalledTimes(1);
        });

        it('saves metadata without discovery when connection fields are unchanged', async () => {
            await createStalkerComponent({
                username: 'subscriber',
                password: 'secret',
                stalkerSerialNumber: 'SERIAL',
            });
            component.playlistDetails.get('title')?.setValue('Renamed');

            await component.saveChanges(
                component.playlistDetails.getRawValue() as PlaylistMeta
            );

            expect(
                stalkerConnectionEditor.resolveConnection
            ).not.toHaveBeenCalled();
            expect(
                stalkerConnectionEditor.applyResolvedConnection
            ).not.toHaveBeenCalled();
            expect(store.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: expect.objectContaining({
                        title: 'Renamed',
                        portalUrl: 'https://portal.example.com/c',
                        macAddress: '00:1a:79:aa:bb:cc',
                        username: 'subscriber',
                        password: 'secret',
                        stalkerSerialNumber: 'SERIAL',
                    }) as PlaylistMeta,
                })
            );
        });

        it.each([
            ['portalUrl', 'https://new.example.com'],
            ['macAddress', '00:1A:79:AB:CD:EF'],
            ['username', 'new-user'],
            ['password', 'new-password'],
            ['stalkerSerialNumber', 'NEW-SERIAL'],
            ['stalkerDeviceId1', 'NEW-DEVICE-1'],
            ['stalkerDeviceId2', 'NEW-DEVICE-2'],
            ['stalkerSignature1', 'NEW-SIGNATURE-1'],
            ['stalkerSignature2', 'NEW-SIGNATURE-2'],
        ])('runs discovery when %s changes', async (field, value) => {
            await createStalkerComponent({
                username: 'subscriber',
                password: 'secret',
                stalkerSerialNumber: 'SERIAL',
                stalkerDeviceId1: 'DEVICE-1',
                stalkerDeviceId2: 'DEVICE-2',
                stalkerSignature1: 'SIGNATURE-1',
                stalkerSignature2: 'SIGNATURE-2',
            });
            component.playlistDetails.get(field)?.setValue(value);

            await component.saveChanges(
                component.playlistDetails.getRawValue() as PlaylistMeta
            );

            expect(
                stalkerConnectionEditor.resolveConnection
            ).toHaveBeenCalledTimes(1);
        });

        it('dispatches the resolved endpoint, mode and session patch together', async () => {
            await createStalkerComponent();
            const resolvedPlaylist = {
                ...component.playlistDetails.getRawValue(),
                portalUrl: 'https://portal.example.com/server/load.php',
                isFullStalkerPortal: true,
                stalkerSessionPatch: {
                    stalkerToken: 'NEW_TOKEN',
                    stalkerSessionIdentity: 'new-fingerprint',
                    stalkerWatchdogTimeout: 90,
                    stalkerTimeslot: 4,
                },
            };
            stalkerConnectionEditor.resolveConnection.mockResolvedValue({
                status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.RESOLVED,
                playlist: resolvedPlaylist,
            });
            component.playlistDetails
                .get('portalUrl')
                ?.setValue('https://portal.example.com/c');
            component.playlistDetails.get('username')?.setValue('subscriber');

            await component.saveChanges(
                component.playlistDetails.getRawValue() as PlaylistMeta
            );

            expect(store.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: resolvedPlaylist,
                    persist: false,
                })
            );
            expect(
                stalkerConnectionEditor.applyResolvedConnection
            ).toHaveBeenCalledWith(resolvedPlaylist);
            expect(dialogRef.close).toHaveBeenCalledTimes(1);
        });

        it('does not route a Stalker edit through stale Xtream metadata', async () => {
            runtime.supportsXtreamSqliteDataSource = true;
            await createStalkerComponent({
                serverUrl: 'https://old-xtream.example.com',
                username: 'subscriber',
                password: 'secret',
            });
            component.playlistDetails
                .get('portalUrl')
                ?.setValue('https://new.example.com');

            await component.saveChanges(
                component.playlistDetails.getRawValue() as PlaylistMeta
            );

            expect(
                databaseService.updateXtreamPlaylistDetails
            ).not.toHaveBeenCalled();
            expect(
                stalkerConnectionEditor.applyResolvedConnection
            ).toHaveBeenCalledTimes(1);
        });

        it('persists a resolved edit when the component is destroyed during discovery', async () => {
            await createStalkerComponent();
            const resolvedPlaylist = {
                ...component.playlistDetails.getRawValue(),
                portalUrl: 'https://portal.example.com/server/load.php',
                isFullStalkerPortal: true,
                stalkerSessionPatch: {
                    stalkerToken: 'NEW_TOKEN',
                    stalkerSessionIdentity: 'new-fingerprint',
                },
            };
            const currentPlaylist = {
                ...resolvedPlaylist,
                title: 'Newer title',
                epgUrls: ['https://new.example.com/epg.xml'],
            };
            stalkerConnectionEditor.applyResolvedConnection.mockResolvedValueOnce(
                currentPlaylist
            );
            let finishDiscovery:
                | ((value: {
                      status: 'resolved';
                      playlist: typeof resolvedPlaylist;
                  }) => void)
                | undefined;
            stalkerConnectionEditor.resolveConnection.mockReturnValueOnce(
                new Promise((resolve) => {
                    finishDiscovery = resolve;
                })
            );
            component.playlistDetails
                .get('portalUrl')
                ?.setValue('https://new.example.com');
            const saving = component.saveChanges(
                component.playlistDetails.getRawValue() as PlaylistMeta
            );
            await Promise.resolve();

            fixture.destroy();
            finishDiscovery?.({
                status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.RESOLVED,
                playlist: resolvedPlaylist,
            });
            await saving;

            expect(
                stalkerConnectionEditor.applyResolvedConnection
            ).toHaveBeenCalledWith(resolvedPlaylist, {
                preserveCurrentMetadata: true,
            });
            expect(store.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: currentPlaylist,
                    persist: false,
                })
            );
            expect(snackBar.open).not.toHaveBeenCalled();
            expect(dialogRef.close).not.toHaveBeenCalled();
        });

        it('persists a resolved edit while the dialog close animation is pending', async () => {
            await createStalkerComponent();
            const resolvedPlaylist = {
                ...component.playlistDetails.getRawValue(),
                portalUrl: 'https://portal.example.com/server/load.php',
                isFullStalkerPortal: true,
                stalkerSessionPatch: {
                    stalkerToken: 'NEW_TOKEN',
                    stalkerSessionIdentity: 'new-fingerprint',
                },
            };
            const currentPlaylist = {
                ...resolvedPlaylist,
                title: 'Newer title',
                epgUrls: ['https://new.example.com/epg.xml'],
            };
            stalkerConnectionEditor.applyResolvedConnection.mockResolvedValueOnce(
                currentPlaylist
            );
            let finishDiscovery:
                | ((value: {
                      status: 'resolved';
                      playlist: typeof resolvedPlaylist;
                  }) => void)
                | undefined;
            stalkerConnectionEditor.resolveConnection.mockReturnValueOnce(
                new Promise((resolve) => {
                    finishDiscovery = resolve;
                })
            );
            component.playlistDetails
                .get('portalUrl')
                ?.setValue('https://new.example.com');
            const saving = component.saveChanges(
                component.playlistDetails.getRawValue() as PlaylistMeta
            );
            await Promise.resolve();

            dialogBeforeClosed.next();
            finishDiscovery?.({
                status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.RESOLVED,
                playlist: resolvedPlaylist,
            });
            await saving;

            expect(
                stalkerConnectionEditor.applyResolvedConnection
            ).toHaveBeenCalledWith(resolvedPlaylist, {
                preserveCurrentMetadata: true,
            });
            expect(store.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: currentPlaylist,
                    persist: false,
                })
            );
            expect(snackBar.open).not.toHaveBeenCalled();
            expect(dialogRef.close).not.toHaveBeenCalled();
        });

        it('does not update UI state or report success when resolved persistence fails', async () => {
            const consoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            try {
                await createStalkerComponent();
                const resolvedPlaylist = {
                    ...component.playlistDetails.getRawValue(),
                    portalUrl: 'https://portal.example.com/server/load.php',
                    isFullStalkerPortal: true,
                    stalkerSessionPatch: {
                        stalkerToken: 'NEW_TOKEN',
                        stalkerSessionIdentity: 'new-fingerprint',
                    },
                };
                stalkerConnectionEditor.resolveConnection.mockResolvedValue({
                    status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.RESOLVED,
                    playlist: resolvedPlaylist,
                });
                stalkerConnectionEditor.applyResolvedConnection.mockRejectedValue(
                    new Error('write failed')
                );
                component.playlistDetails
                    .get('username')
                    ?.setValue('subscriber');

                await component.saveChanges(
                    component.playlistDetails.getRawValue() as PlaylistMeta
                );

                expect(store.dispatch).not.toHaveBeenCalled();
                expect(dialogRef.close).not.toHaveBeenCalled();
                expect(snackBar.open).toHaveBeenCalledWith(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_FAILED',
                    'CLOSE',
                    { duration: 3000 }
                );
            } finally {
                consoleError.mockRestore();
            }
        });

        it.each([
            STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.AUTH_REJECTED,
            STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.UNREACHABLE,
        ])('keeps the dialog open and saves nothing on %s', async (status) => {
            await createStalkerComponent();
            stalkerConnectionEditor.resolveConnection.mockResolvedValue({
                status,
                message: `error:${status}`,
            });
            component.playlistDetails
                .get('portalUrl')
                ?.setValue('https://new.example.com');

            await component.saveChanges(
                component.playlistDetails.getRawValue() as PlaylistMeta
            );

            expect(store.dispatch).not.toHaveBeenCalled();
            expect(dialogRef.close).not.toHaveBeenCalled();
            expect(snackBar.open).toHaveBeenCalledWith(
                `error:${status}`,
                'CLOSE',
                { duration: 8000 }
            );
            expect(component.isSaving()).toBe(false);
        });

        it('ignores a second Save while discovery is pending', async () => {
            await createStalkerComponent();
            let resolveDiscovery:
                | ((value: { status: 'unreachable'; message: string }) => void)
                | undefined;
            stalkerConnectionEditor.resolveConnection.mockReturnValue(
                new Promise((resolve) => {
                    resolveDiscovery = resolve;
                })
            );
            component.playlistDetails
                .get('portalUrl')
                ?.setValue('https://new.example.com');
            const value =
                component.playlistDetails.getRawValue() as PlaylistMeta;

            const firstSave = component.saveChanges(value);
            const secondSave = component.saveChanges(value);

            expect(component.isSaving()).toBe(true);
            expect(dialogRef.disableClose).toBe(true);
            expect(
                stalkerConnectionEditor.resolveConnection
            ).toHaveBeenCalledTimes(1);
            resolveDiscovery?.({
                status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.UNREACHABLE,
                message: 'offline',
            });
            await Promise.all([firstSave, secondSave]);
            expect(store.dispatch).not.toHaveBeenCalled();
            expect(dialogRef.disableClose).toBe(false);
        });

        it('accepts a bare HTTP host but rejects an address without a protocol', async () => {
            await createStalkerComponent();
            const control = component.playlistDetails.get('portalUrl');

            control?.setValue('portal.example.com');
            expect(control?.valid).toBe(false);

            control?.setValue('https://portal.example.com');
            expect(control?.valid).toBe(true);

            control?.setValue('HTTP://portal.example.com/c');
            expect(control?.valid).toBe(true);
        });

        it('persists a grandfathered MAC untouched on submit', async () => {
            await createStalkerComponent({ macAddress: 'legacy-device-42' });

            await component.saveChanges(
                component.playlistDetails.value as PlaylistMeta
            );

            expect(store.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: expect.objectContaining({
                        macAddress: 'legacy-device-42',
                    }) as PlaylistMeta,
                })
            );
        });

        it('leaves a non-canonical MAC alone when focus passes through it', async () => {
            // Tabbing through the dialog fires blur with no edit. Rewriting
            // there would mark the form dirty AND make the value differ from
            // the stored one, which is what the submit guard reads — so a
            // later title-only save would carry the rewritten identity.
            await createStalkerComponent({
                macAddress: '00-1a-79-aa-bb-cc',
            });
            const control = component.playlistDetails.get('macAddress');

            component.onMacAddressBlur();

            expect(control?.value).toBe('00-1a-79-aa-bb-cc');
            expect(control?.dirty).toBe(false);

            component.playlistDetails.get('title')?.setValue('Renamed');
            await component.saveChanges(
                component.playlistDetails.value as PlaylistMeta
            );

            expect(store.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: expect.objectContaining({
                        macAddress: '00-1a-79-aa-bb-cc',
                    }) as PlaylistMeta,
                })
            );
        });

        it('leaves an untouched non-canonical MAC alone on an unrelated save', async () => {
            // Renaming a playlist must not rewrite its MAC: those bytes are
            // what a permissive portal registered, and changing them moves
            // the session fingerprint and re-authenticates under a spelling
            // the portal never saw.
            await createStalkerComponent({
                macAddress: '00-1a-79-aa-bb-cc',
            });
            component.playlistDetails.get('title')?.setValue('Renamed');

            await component.saveChanges(
                component.playlistDetails.value as PlaylistMeta
            );

            expect(store.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: expect.objectContaining({
                        macAddress: '00-1a-79-aa-bb-cc',
                        title: 'Renamed',
                    }) as PlaylistMeta,
                })
            );
        });

        it('does not claim a simple portal has pinned its device IDs', async () => {
            // device_id travels only on get_profile/do_auth, which a
            // panel-style portal never runs — so nothing was pinned and the
            // lockout warning would be false.
            await createStalkerComponent({
                isFullStalkerPortal: false,
                stalkerDeviceId1: 'ABCDEF',
            });

            expect(component.hasStoredStalkerDeviceIds).toBe(false);
            expect(fixture.nativeElement.textContent).not.toContain(
                'HOME.STALKER_PORTAL.DEVICE_ID_PINNED_WARNING'
            );
        });

        it('keeps a MAC outside the Infomir range saveable', async () => {
            // Most reseller panels do not run the stock OUI filter, so this is
            // a working configuration — the import hint explains the risk, the
            // form must not block it.
            await createStalkerComponent({
                macAddress: 'AA:BB:CC:DD:EE:01',
            });

            expect(component.playlistDetails.get('macAddress')?.valid).toBe(
                true
            );
        });

        it('grandfathers a stored MAC it would now reject', async () => {
            // Before this validation existed the field accepted anything, and
            // on a panel that ignores the MAC such a playlist works. Blocking
            // Save would also strand the title, URL and EPG edits in the same
            // dialog.
            await createStalkerComponent({ macAddress: 'legacy-device-42' });

            expect(component.playlistDetails.get('macAddress')?.valid).toBe(
                true
            );
            expect(component.playlistDetails.valid).toBe(true);
        });

        it('still refuses a newly typed malformed MAC on a grandfathered playlist', async () => {
            await createStalkerComponent({ macAddress: 'legacy-device-42' });
            const control = component.playlistDetails.get('macAddress');

            control?.setValue('legacy-device-43');

            expect(control?.valid).toBe(false);
        });

        it('does not warn about a pinning that has not happened', async () => {
            await createStalkerComponent();

            expect(component.hasStoredStalkerDeviceIds).toBe(false);
            expect(fixture.nativeElement.textContent).not.toContain(
                'HOME.STALKER_PORTAL.DEVICE_ID_PINNED_WARNING'
            );
        });

        it('treats a blank stored device ID as never sent', async () => {
            await createStalkerComponent({ stalkerDeviceId2: '   ' });

            expect(component.hasStoredStalkerDeviceIds).toBe(false);
        });

        it('warns once a device ID has been pinned', async () => {
            await createStalkerComponent({ stalkerDeviceId1: 'ABCDEF' });

            expect(component.hasStoredStalkerDeviceIds).toBe(true);
            expect(fixture.nativeElement.textContent).toContain(
                'HOME.STALKER_PORTAL.DEVICE_ID_PINNED_WARNING'
            );
        });

        it('warns when only the second device ID is pinned', async () => {
            await createStalkerComponent({ stalkerDeviceId2: 'FEDCBA' });

            expect(component.hasStoredStalkerDeviceIds).toBe(true);
        });
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
