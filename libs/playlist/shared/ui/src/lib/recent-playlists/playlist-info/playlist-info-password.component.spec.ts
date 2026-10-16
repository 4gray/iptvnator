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

/** The edit dialog masks a stored password exactly like the add forms. */
describe('PlaylistInfoComponent password field', () => {
    const base = {
        id: 'playlist-1',
        _id: 'playlist-1',
        title: 'Source',
        count: 0,
        importDate: '2026-04-01T00:00:00.000Z',
        autoRefresh: false,
        username: 'user1',
        password: 'pass1',
    };
    const xtream = {
        ...base,
        serverUrl: 'http://xtream.example:8080',
    } as Playlist & { id: string };
    const stalker = {
        ...base,
        portalUrl: 'http://portal.example/portal.php',
        macAddress: '00:1A:79:00:00:01',
    } as Playlist & { id: string };

    function render(playlist: Playlist & { id: string }) {
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
                    useValue: { supportsDataManagement: false },
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

    it.each([
        ['Xtream', xtream],
        ['Stalker', stalker],
    ])(
        'masks a stored %s password until it is revealed',
        async (_, playlist) => {
            const fixture = render(playlist);
            await fixture.whenStable();
            fixture.detectChanges();
            const root = fixture.nativeElement as HTMLElement;
            const password = root.querySelector(
                'input[formcontrolname="password"]'
            ) as HTMLInputElement;
            const toggle = password
                .closest('mat-form-field')
                ?.querySelector('button') as HTMLButtonElement;

            expect(password.value).toBe('pass1');
            expect(password.type).toBe('password');
            expect(toggle.type).toBe('button');
            expect(toggle.getAttribute('aria-label')).toBe(
                'HOME.SHOW_PASSWORD'
            );
            expect(toggle.getAttribute('aria-pressed')).toBe('false');

            toggle.click();
            fixture.detectChanges();

            expect(password.type).toBe('text');
            expect(toggle.getAttribute('aria-pressed')).toBe('true');
            // A toggle never submits the edit form it sits in.
            expect(fixture.componentInstance.isSaving()).toBe(false);
        }
    );
});
