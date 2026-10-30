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

    beforeEach(async () => {
        persisted = new Subject();
        updatePlaylistMeta = jest.fn(() => persisted);
        dispatch = jest.fn();
        close = jest.fn();
        open = jest.fn();
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
                { provide: DatabaseService, useValue: {} },
                { provide: RuntimeCapabilitiesService, useValue: {} },
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
        const saving = component.saveChanges({
            ...opened,
            title: 'Shared edit',
        });
        expect(updatePlaylistMeta).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceSyncRevision: '"opened"',
                title: 'Shared edit',
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
            const saving = component.saveChanges({
                ...opened,
                title: 'Stale edit',
            });
            persisted.error(new Error('SOURCE_SYNC.CONFLICT'));
            await saving;
            expect(close).not.toHaveBeenCalled();
            expect(dispatch).not.toHaveBeenCalled();
            expect(open).toHaveBeenCalledWith('SOURCE_SYNC.CONFLICT', 'CLOSE', {
                duration: 3000,
            });
        } finally {
            log.mockRestore();
        }
    });
});
