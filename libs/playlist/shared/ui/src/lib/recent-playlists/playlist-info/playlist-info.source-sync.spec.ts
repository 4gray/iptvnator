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
import { EMPTY, Subject, of, throwError } from 'rxjs';
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

    it('normalizes standalone connection fields and persists User-Agent before catalog completion', async () => {
        jest.spyOn(
            TestBed.inject(PlaylistStorageBackend),
            'kind'
        ).mockReturnValue('electron');
        runtime.supportsXtreamSqliteDataSource = true;
        const original = {
            ...opened,
            serverUrl: 'https://old.synthetic.invalid',
            username: 'old-user',
            password: 'old-password',
        };
        component.playlist = original;
        component.playlistDetails.patchValue(original);
        await component.saveChanges({
            ...original,
            title: 'Updated synthetic source',
            serverUrl:
                ' https://new.synthetic.invalid/get.php?username=ignored&password=ignored ',
            username: ' new-user ',
            password: ' new-password ',
            userAgent: 'Fixture agent',
        });
        expect(sqliteUpdate).toHaveBeenCalledWith({
            id: opened._id,
            title: 'Updated synthetic source',
            serverUrl: 'https://new.synthetic.invalid',
            username: 'new-user',
            password: 'new-password',
            userAgent: 'Fixture agent',
            xtreamContentTypes: undefined,
        });
        expect(sqliteUpdate).toHaveBeenCalledTimes(1);
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
                    const saved = {
                        ...next,
                        sourceSyncRevision: '"accepted"',
                    };
                    (
                        TestBed.inject(PlaylistsService)
                            .getPlaylistById as jest.Mock
                    ).mockReturnValue(of(saved));
                    persisted.next(saved);
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

    it.each(['current', 'unavailable', 'deleted'] as const)(
        'does not republish a superseded shared connection after cache failure (read=%s)',
        async (readResult) => {
            const original = {
                ...opened,
                serverUrl: 'https://synthetic-before.invalid',
                username: 'synthetic-user',
                password: 'synthetic-password',
                xtreamContentTypes: ['live'],
            } as Playlist;
            const accepted = {
                ...original,
                xtreamContentTypes: ['live', 'movie'],
                sourceSyncRevision: '"accepted-r1"',
            } as Playlist;
            const current = {
                ...accepted,
                serverUrl: 'https://synthetic-current.invalid',
                sourceSyncRevision: '"current-r2"',
            };
            component.playlist = { ...original, id: original._id };
            const getCurrent = TestBed.inject(PlaylistsService)
                .getPlaylistById as jest.Mock;
            getCurrent.mockClear();
            const failure = new Error('Synthetic interrupted catalog save');
            const persist = jest.fn().mockResolvedValue(accepted);
            refresh.mockImplementation(
                async (_playlist, _types, beforeReplace) => {
                    await beforeReplace();
                    if (readResult === 'unavailable') {
                        // Preserve a newer context even when storage cannot
                        // confirm its projection after the native write fails.
                        component.playlist = { ...current, id: current._id };
                        getCurrent.mockReturnValue(
                            throwError(
                                () => new Error('Synthetic read failure')
                            )
                        );
                    } else {
                        getCurrent.mockReturnValue(
                            of(readResult === 'deleted' ? null : current)
                        );
                    }
                    throw failure;
                }
            );

            await expect(
                component.updateXtreamPlaylist(accepted, persist)
            ).rejects.toBe(failure);
            expect(persist).toHaveBeenCalledTimes(1);
            expect(sqliteUpdate).not.toHaveBeenCalled();
            if (readResult === 'current') {
                expect(dispatch).toHaveBeenCalledTimes(1);
                expect(dispatch).toHaveBeenCalledWith(
                    expect.objectContaining({
                        persist: false,
                        playlist: current,
                    })
                );
                expect(component.playlist.sourceSyncRevision).toBe(
                    current.sourceSyncRevision
                );
            } else {
                expect(dispatch).not.toHaveBeenCalled();
                if (readResult === 'unavailable')
                    expect(component.playlist).toEqual(current);
            }
            expect(close).not.toHaveBeenCalled();
        }
    );

    it.each([false, true])(
        'rehydrates the existing form after a connection-change failure (custom header=%s)',
        async (customHeader) => {
            const original = {
                ...opened,
                serverUrl: 'https://synthetic-before.invalid',
                username: 'synthetic-before-user',
                password: 'synthetic-before-password',
                userAgent: 'Synthetic previous player',
                xtreamContentTypes: ['live'],
            } as Playlist;
            const accepted = {
                ...original,
                xtreamContentTypes: ['live', 'movie'],
                sourceSyncRevision: '"accepted-r1"',
            } as Playlist;
            const current = {
                ...accepted,
                serverUrl: 'https://synthetic-current.invalid',
                username: 'synthetic-current-user',
                password: 'synthetic-current-password',
                userAgent: customHeader
                    ? 'Synthetic current player'
                    : undefined,
                sourceSyncRevision: '"current-r2"',
            };
            component.playlist = { ...original, id: original._id };
            component.playlistDetails.patchValue(accepted);
            component.playlistDetails.markAsDirty();
            const form = component.playlistDetails;
            const connectionTest = component.connectionTest;
            const failure = new Error('Synthetic connection changed');
            failure.name = 'XtreamCatalogConnectionChangedError';
            const persist = jest.fn().mockResolvedValue(accepted);
            refresh.mockImplementation(
                async (_playlist, _types, beforeReplace) => {
                    await beforeReplace();
                    (
                        TestBed.inject(PlaylistsService)
                            .getPlaylistById as jest.Mock
                    ).mockReturnValue(of(current));
                    throw failure;
                }
            );

            await expect(
                component.updateXtreamPlaylist(accepted, persist)
            ).rejects.toBe(failure);
            expect(persist).toHaveBeenCalledTimes(1);
            expect(component.playlist).toEqual(current);
            expect(component.playlistDetails).toBe(form);
            expect(component.connectionTest).toBe(connectionTest);
            expect(form.value).toEqual(
                expect.objectContaining({
                    serverUrl: current.serverUrl,
                    username: current.username,
                    password: current.password,
                    userAgent: current.userAgent ?? '',
                    xtreamContentTypes: ['movie', 'live'],
                })
            );
            expect(form.pristine).toBe(true);
            expect(dispatch).toHaveBeenCalledWith(
                expect.objectContaining({ persist: false, playlist: current })
            );
            expect(sqliteUpdate).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
        }
    );

    it.each([false, true])(
        'leaves rejected edits untouched when a restore predates this scan (pending=%s)',
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
                refresh.mockRejectedValue(new Error('scan blocked'));
                pending.mockReturnValue(parked ? {} : null);
                const editor = TestBed.createComponent(
                    PlaylistInfoComponent
                ).componentInstance;
                for (let n = 0; n < 6; n++) await Promise.resolve();
                const next = {
                    ...complete,
                    username: 'rejected',
                    xtreamContentTypes: ['live', 'movie'],
                } as Playlist;
                updatePlaylistMeta.mockReturnValue(of(next));
                await editor.saveChanges(next);
                expect(updatePlaylistMeta).not.toHaveBeenCalled();
                expect(sqliteUpdate).not.toHaveBeenCalled();
                expect(dispatch).not.toHaveBeenCalled();
                expect(close).not.toHaveBeenCalled();
                expect(editor.playlist.sourceSyncRevision).toBe('"opened"');
            } finally {
                log.mockRestore();
            }
        }
    );
});
