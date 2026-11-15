import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    DatabaseService,
    PlaylistsService,
    PlaylistStorageBackend,
    RuntimeCapabilitiesService,
    SettingsStore,
    SourceActivityService,
} from '@iptvnator/services';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { EMPTY, of } from 'rxjs';
import { PlaylistRefreshActionService } from '../../playlist-refresh-action.service';
import { PlaylistInfoComponent } from './playlist-info.component';
import { STALKER_PLAYLIST_CONNECTION_EDITOR } from './stalker-playlist-connection-editor.token';

// Saving a new M3U source while a refresh is running (#1677).
describe('PlaylistInfoComponent M3U source refresh guard', () => {
    const opened = {
        _id: 'm3u',
        title: 'M3U',
        count: 0,
        importDate: '2026-04-01',
        lastUsage: '2026-04-01',
        autoRefresh: false,
        url: 'https://old.example.com/list.m3u',
    } as PlaylistMeta;
    let component: PlaylistInfoComponent;
    let dispatch: jest.Mock;
    let open: jest.Mock;
    let close: jest.Mock;
    let refresh: jest.Mock;
    let blocked: boolean;

    beforeEach(async () => {
        dispatch = jest.fn();
        open = jest.fn();
        close = jest.fn();
        refresh = jest.fn();
        blocked = false;
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
                        updatePlaylistMeta: jest.fn((p) => of(p)),
                        getPlaylistById: jest.fn(() => of(opened)),
                    },
                },
                {
                    provide: PlaylistStorageBackend,
                    useValue: { kind: () => 'local' },
                },
                { provide: Store, useValue: { dispatch } },
                { provide: DatabaseService, useValue: {} },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsXtreamSqliteDataSource: false },
                },
                {
                    provide: SourceActivityService,
                    useValue: { isBusy: () => false },
                },
                {
                    provide: PlaylistRefreshActionService,
                    useValue: { refresh, isBlocked: () => blocked },
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
    });

    it('refuses a new source while a refresh is running and writes nothing', async () => {
        blocked = true;

        await component.saveChanges({
            ...opened,
            url: 'https://new.example.com/list.m3u',
        });

        expect(dispatch).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        expect(open).toHaveBeenCalledWith(
            'HOME.PLAYLISTS.PLAYLIST_UPDATE_FAILED',
            'CLOSE',
            { duration: 3000 }
        );
    });

    it('still saves other edits while a refresh is running', async () => {
        blocked = true;

        await component.saveChanges({ ...opened, title: 'Renamed' });

        expect(dispatch).toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
        expect(open).toHaveBeenCalledWith(
            'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS',
            'CLOSE',
            { duration: 3000 }
        );
    });

    it('saves and refreshes a new source when nothing is running', async () => {
        const url = 'https://new.example.com/list.m3u';

        await component.saveChanges({ ...opened, url });

        expect(dispatch).toHaveBeenCalled();
        expect(refresh).toHaveBeenCalledWith(
            expect.objectContaining({ _id: 'm3u', url })
        );
    });
});
