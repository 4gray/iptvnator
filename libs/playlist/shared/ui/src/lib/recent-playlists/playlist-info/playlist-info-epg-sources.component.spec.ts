import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { PlaylistInfoComponent } from './playlist-info.component';
import { STALKER_PLAYLIST_CONNECTION_EDITOR } from './stalker-playlist-connection-editor.token';

/**
 * The component is OnPush: the playlist is replaced after the awaited EPG
 * cleanup, outside any template event, so the rendered source list has to
 * follow without a zone-triggered tick.
 */
describe('PlaylistInfoComponent playlist EPG source rows', () => {
    const keepUrl = 'https://playlist.example.com/keep.xml';
    const removeUrl = 'https://playlist.example.com/remove.xml';
    const playlist = {
        id: 'playlist-1',
        _id: 'playlist-1',
        title: 'My Playlist',
        count: 1,
        importDate: '2026-04-01T00:00:00.000Z',
        autoRefresh: false,
        url: 'https://example.com/playlist.m3u',
        epgUrls: [keepUrl, removeUrl],
        detectedEpgUrls: [keepUrl, removeUrl],
    } as Playlist & { id: string };

    function render() {
        TestBed.configureTestingModule({
            imports: [PlaylistInfoComponent, TranslateModule.forRoot()],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: playlist },
                {
                    provide: PlaylistsService,
                    useValue: { getPlaylistById: jest.fn(() => of(playlist)) },
                },
                { provide: DatabaseService, useValue: {} },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: {
                        supportsDataManagement: true,
                        clearEpgDataForSource: jest
                            .fn()
                            .mockResolvedValue({ success: true }),
                    },
                },
                { provide: Store, useValue: { dispatch: jest.fn() } },
                {
                    provide: SettingsStore,
                    useValue: { getSettings: jest.fn(() => ({ epgUrl: [] })) },
                },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                {
                    provide: MatDialogRef,
                    useValue: { beforeClosed: () => new Subject<void>() },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsDesktopFileSave: false },
                },
                { provide: STALKER_PLAYLIST_CONNECTION_EDITOR, useValue: {} },
            ],
        });
        const fixture = TestBed.createComponent(PlaylistInfoComponent);
        fixture.detectChanges();
        return fixture;
    }

    it('drops a removed source row once its cleanup resolves', async () => {
        const fixture = render();
        const renderedSources = () =>
            Array.from(
                (fixture.nativeElement as HTMLElement).querySelectorAll(
                    '.playlist-epg-source-row input[readonly]'
                ),
                (input) => (input as HTMLInputElement).value
            );
        expect(renderedSources()).toEqual([keepUrl, removeUrl]);

        await fixture.componentInstance.removePlaylistEpgSource(removeUrl);
        fixture.detectChanges();

        expect(renderedSources()).toEqual([keepUrl]);
    });
});
