import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    DatabaseService,
    PlaylistsService,
    PlaylistStorageBackend,
    RuntimeCapabilitiesService,
    SettingsStore,
    XtreamConnectionTestService,
} from '@iptvnator/services';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { EMPTY, Subject, of } from 'rxjs';
import { PlaylistInfoComponent } from './playlist-info.component';
import { XtreamSelectedCatalogRefreshService } from '@iptvnator/services/xtream-catalog-refresh';
import {
    SourceActivityService,
    XtreamPendingRestoreService,
} from '@iptvnator/services';
import { Router } from '@angular/router';
import { STALKER_PLAYLIST_CONNECTION_EDITOR } from './stalker-playlist-connection-editor.token';

describe('shared source editor', () => {
    const opened = {
        _id: 'shared',
        id: 'shared',
        title: 'Shared',
        count: 0,
        importDate: '2026-04-01',
        lastUsage: '2026-04-01',
        autoRefresh: false,
        sourceSyncRevision: '"opened"',
    };
    let component: PlaylistInfoComponent;
    let persisted: Subject<Playlist>;
    let updatePlaylistMeta: jest.Mock;
    let dispatch: jest.Mock;
    let close: jest.Mock;
    let open: jest.Mock;
    let refresh: jest.Mock;
    let pending: jest.Mock;
    let sqliteUpdate: jest.Mock;
    const runtime = { supportsXtreamSqliteDataSource: false };

    beforeEach(async () => {
        persisted = new Subject();
        updatePlaylistMeta = jest.fn(() => persisted);
        dispatch = jest.fn();
        close = jest.fn();
        open = jest.fn();
        runtime.supportsXtreamSqliteDataSource = false;
        refresh = jest.fn(async (_playlist, _types, beforeReplace) => {
            await beforeReplace?.();
        });
        pending = jest.fn().mockReturnValue(null);
        sqliteUpdate = jest.fn().mockResolvedValue(true);
        await TestBed.configureTestingModule({
            imports: [PlaylistInfoComponent],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: opened },
                {
                    provide: MatDialogRef,
                    useValue: { beforeClosed: () => EMPTY, close },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        updatePlaylistMeta,
                        getPlaylistById: jest.fn(() => of(opened)),
                    },
                },
                {
                    provide: PlaylistStorageBackend,
                    useValue: { kind: () => 'server' },
                },
                {
                    provide: XtreamConnectionTestService,
                    useValue: {
                        test: jest.fn(async () => ({
                            status: 'active',
                            usedHttpFallback: false,
                        })),
                    },
                },
                { provide: Store, useValue: { dispatch } },
                {
                    provide: DatabaseService,
                    useValue: { updateXtreamPlaylistDetails: sqliteUpdate },
                },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                {
                    provide: SourceActivityService,
                    useValue: { isBusy: () => false },
                },
                {
                    provide: XtreamPendingRestoreService,
                    useValue: { getOrThrow: pending },
                },
                {
                    provide: XtreamSelectedCatalogRefreshService,
                    useValue: { refresh },
                },
                {
                    provide: Router,
                    useValue: { navigate: jest.fn().mockResolvedValue(true) },
                },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: { supportsDataManagement: false },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        getSettings: () => ({}),
                        getTrustOptions: () => ({}),
                    },
                },
                { provide: MatSnackBar, useValue: { open } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
                { provide: STALKER_PLAYLIST_CONNECTION_EDITOR, useValue: null },
            ],
        })
            .overrideComponent(PlaylistInfoComponent, {
                set: { template: '', imports: [] },
            })
            .compileComponents();
        component = TestBed.createComponent(
            PlaylistInfoComponent
        ).componentInstance;
        await Promise.resolve();
        await Promise.resolve();
    });

    it('hydrates a lightweight shared summary before capturing its edit revision', async () => {
        const playlists = TestBed.inject(PlaylistsService);
        expect(playlists.getPlaylistById).toHaveBeenCalledWith(opened._id);
        expect(component.isHydratingStalkerPlaylist()).toBe(false);
        expect(component.playlist.sourceSyncRevision).toBe('"opened"');
    });
    it('tests the current hydrated form when a shared Xtream summary is edited', async () => {
        const complete = {
            ...opened,
            serverUrl: 'https://panel.test',
            username: 'full-user',
            password: 'full-secret',
        };
        (
            TestBed.inject(PlaylistsService).getPlaylistById as jest.Mock
        ).mockReturnValue(of(complete));
        const hydrated = TestBed.createComponent(
            PlaylistInfoComponent
        ).componentInstance;
        await Promise.resolve();
        await Promise.resolve();
        hydrated.playlistDetails.get('username')!.setValue('edited-user');
        await hydrated.connectionTest.test();
        expect(
            TestBed.inject(XtreamConnectionTestService).test
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                username: 'edited-user',
                password: 'full-secret',
            }),
            expect.any(Function),
            false
        );
    });
    it('awaits a shared edit using the revision captured when its dialog opened', async () => {
        component.epg.inputs.at(0).setValue('https://epg.test/new.xml');
        const saving = component.saveChanges({
            ...opened,
            title: 'Shared edit',
        });
        expect(updatePlaylistMeta).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceSyncRevision: '"opened"',
                title: 'Shared edit',
                epgUrls: ['https://epg.test/new.xml'],
                manualEpgUrls: ['https://epg.test/new.xml'],
            })
        );
        expect(close).not.toHaveBeenCalled();
        persisted.next({
            ...opened,
            title: 'Shared edit',
            sourceSyncRevision: '"saved"',
        } as Playlist);
        persisted.complete();
        await saving;
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                persist: false,
                playlist: expect.objectContaining({
                    sourceSyncRevision: '"saved"',
                }),
            })
        );
    });

    it('keeps a rejected conflicting edit open without reporting success', async () => {
        const log = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        try {
            component.epg.inputs.at(0).setValue('https://epg.test/retry.xml');
            const saving = component.saveChanges({
                ...opened,
                title: 'Stale edit',
            });
            persisted.error(new Error('SOURCE_SYNC.CONFLICT'));
            await saving;
            expect(close).not.toHaveBeenCalled();
            expect(dispatch).not.toHaveBeenCalled();
            expect(component.epg.inputs.at(0).value).toBe(
                'https://epg.test/retry.xml'
            );
            expect(component.epg.urls).toEqual([]);
            expect(open).toHaveBeenCalledWith('SOURCE_SYNC.CONFLICT', 'CLOSE', {
                duration: 3000,
            });
        } finally {
            log.mockRestore();
        }
    });

    it('scans newly enabled cached desktop catalogs while retaining authoritative server persistence', async () => {
        const complete = {
            ...opened,
            serverUrl: 'https://panel.test',
            username: 'user',
            password: 'password',
            xtreamContentTypes: ['live'],
        } as Playlist;
        (
            TestBed.inject(PlaylistsService).getPlaylistById as jest.Mock
        ).mockReturnValue(of(complete));
        runtime.supportsXtreamSqliteDataSource = true;
        const editor = TestBed.createComponent(
            PlaylistInfoComponent
        ).componentInstance;
        for (let n = 0; n < 6; n++) await Promise.resolve();
        const next = {
            ...complete,
            xtreamContentTypes: ['live', 'movie'],
        } as Playlist;
        const saving = editor.saveChanges(next);
        for (let n = 0; n < 6; n++) await Promise.resolve();
        expect(refresh).toHaveBeenCalledWith(
            expect.objectContaining({ _id: 'shared' }),
            ['movie'],
            expect.any(Function)
        );
        expect(updatePlaylistMeta).toHaveBeenCalledTimes(1);
        persisted.next({ ...next, sourceSyncRevision: '"saved"' });
        persisted.complete();
        await saving;
        expect(sqliteUpdate).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                persist: false,
                playlist: expect.objectContaining({
                    sourceSyncRevision: '"saved"',
                }),
            })
        );
    });

    it.each([false, true])(
        'confirms metadata before cache mutation and persists once (accepted=%s)',
        async (accepted) => {
            const log = jest
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            try {
                const complete = {
                    ...opened,
                    serverUrl: 'https://panel.test',
                    username: 'user',
                    password: 'password',
                    xtreamContentTypes: ['live'],
                } as Playlist;
                (
                    TestBed.inject(PlaylistsService)
                        .getPlaylistById as jest.Mock
                ).mockReturnValue(of(complete));
                runtime.supportsXtreamSqliteDataSource = true;
                let replaced = false;
                refresh.mockImplementation(
                    async (_playlist, _types, beforeReplace) => {
                        await beforeReplace();
                        replaced = true;
                        pending.mockReturnValue({});
                        throw new Error('cache save interrupted');
                    }
                );
                const editor = TestBed.createComponent(
                    PlaylistInfoComponent
                ).componentInstance;
                for (let n = 0; n < 6; n++) await Promise.resolve();
                const next = {
                    ...complete,
                    username: 'edited',
                    xtreamContentTypes: ['live', 'movie'],
                } as Playlist;
                const saving = editor.saveChanges(next);
                for (let n = 0; n < 6; n++) await Promise.resolve();
                expect(replaced).toBe(false);
                expect(updatePlaylistMeta).toHaveBeenCalledTimes(1);
                if (accepted) {
                    persisted.next({
                        ...next,
                        sourceSyncRevision: '"accepted"',
                    });
                    persisted.complete();
                } else persisted.error(new Error('SOURCE_SYNC.CONFLICT'));
                await saving;
                expect(replaced).toBe(accepted);
                expect(editor.playlist.sourceSyncRevision).toBe(
                    accepted ? '"accepted"' : '"opened"'
                );
                expect(updatePlaylistMeta).toHaveBeenCalledTimes(1);
                expect(close).not.toHaveBeenCalled();
                expect(sqliteUpdate).not.toHaveBeenCalled();
                if (accepted)
                    expect(dispatch).toHaveBeenCalledWith(
                        expect.objectContaining({
                            persist: false,
                            playlist: expect.objectContaining({
                                sourceSyncRevision: '"accepted"',
                            }),
                        })
                    );
                else expect(dispatch).not.toHaveBeenCalled();
            } finally {
                log.mockRestore();
            }
        }
    );

    it.each([false, true])(
        'retains server edit recovery without duplicate writes (parked=%s)',
        async (parked) => {
            const log = jest
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            try {
                const complete = {
                    ...opened,
                    serverUrl: 'https://panel.test',
                    username: 'user',
                    password: 'password',
                    xtreamContentTypes: ['live'],
                } as Playlist;
                (
                    TestBed.inject(PlaylistsService)
                        .getPlaylistById as jest.Mock
                ).mockReturnValue(of(complete));
                runtime.supportsXtreamSqliteDataSource = true;
                refresh.mockRejectedValue(new Error('scan failed'));
                pending.mockReturnValue(parked ? {} : null);
                const editor = TestBed.createComponent(
                    PlaylistInfoComponent
                ).componentInstance;
                for (let n = 0; n < 6; n++) await Promise.resolve();
                const next = {
                    ...complete,
                    xtreamContentTypes: ['live', 'movie'],
                } as Playlist;
                const saving = editor.saveChanges(next);
                for (let n = 0; n < 6; n++) await Promise.resolve();
                if (parked) {
                    expect(updatePlaylistMeta).toHaveBeenCalledTimes(1);
                    persisted.next({
                        ...next,
                        sourceSyncRevision: '"recovery"',
                    });
                    persisted.complete();
                }
                await saving;
                expect(sqliteUpdate).not.toHaveBeenCalled();
                expect(close).not.toHaveBeenCalled();
                if (parked)
                    expect(dispatch).toHaveBeenCalledWith(
                        expect.objectContaining({
                            persist: false,
                            playlist: expect.objectContaining({
                                sourceSyncRevision: '"recovery"',
                                xtreamContentTypes: ['live', 'movie'],
                            }),
                        })
                    );
                else {
                    expect(updatePlaylistMeta).not.toHaveBeenCalled();
                    expect(dispatch).not.toHaveBeenCalled();
                }
            } finally {
                log.mockRestore();
            }
        }
    );
});
