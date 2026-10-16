import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ServerStorageStatusService } from '@iptvnator/services';
import { SettingsDeleteAllPlaylistsDialogComponent } from './settings-delete-all-playlists-dialog.component';

describe('SettingsDeleteAllPlaylistsDialogComponent', () => {
    let component: SettingsDeleteAllPlaylistsDialogComponent;
    let fixture: ComponentFixture<SettingsDeleteAllPlaylistsDialogComponent>;
    let translate: TranslateService;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                SettingsDeleteAllPlaylistsDialogComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        summary: {
                            total: 6,
                            m3u: 3,
                            xtream: 2,
                            stalker: 1,
                        },
                    },
                },
            ],
        }).compileComponents();

        translate = TestBed.inject(TranslateService);
        translate.setTranslation(
            'en',
            {
                CANCEL: 'Cancel',
                HOME: {
                    PLAYLIST_TYPES: {
                        M3U: 'M3U',
                        XTREAM: 'Xtream',
                        STALKER: 'Stalker',
                    },
                },
                SETTINGS: {
                    REMOVE_DIALOG: {
                        TITLE: 'Delete all playlists?',
                        MESSAGE: 'Delete all {{count}} playlists from the app.',
                        SUMMARY_TITLE: 'Playlist sources',
                        CONSEQUENCES_TITLE: 'This also removes',
                        CONSEQUENCE_FAVORITES: 'Favorites',
                        CONSEQUENCE_RECENTLY_VIEWED: 'Recently viewed history',
                        CONSEQUENCE_PLAYBACK: 'Playback positions',
                        CONSEQUENCE_DOWNLOADS: 'Download history',
                        CONSEQUENCE_XTREAM_CACHE: 'Xtream cache',
                        BACKUP_HINT: 'Use Export first if you need a backup.',
                        CONFIRM: 'Delete everything',
                    },
                },
            },
            true
        );
        translate.use('en');

        fixture = TestBed.createComponent(
            SettingsDeleteAllPlaylistsDialogComponent
        );
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('renders the playlist type summary and destructive guidance', () => {
        const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

        expect(component.summaryItems().map((item) => item.count)).toEqual([
            3, 2, 1,
        ]);
        expect(text).toContain('Delete all playlists?');
        expect(text).toContain('Delete all 6 playlists from the app.');
        expect(text).toContain('Playlist sources');
        expect(text).toContain('M3U');
        expect(text).toContain('Xtream');
        expect(text).toContain('Stalker');
        expect(text).toContain('Favorites');
        expect(text).toContain('Use Export first if you need a backup.');
    });

    it('renders cancel and the destructive confirm in the footer, dismiss first', () => {
        const buttons = Array.from(
            (fixture.nativeElement as HTMLElement).querySelectorAll(
                '[appDialogFooter] button'
            )
        );

        expect(buttons.map((button) => button.textContent?.trim())).toEqual([
            'Cancel',
            'Delete everything',
        ]);
        expect(
            buttons.map((button) =>
                button.classList.contains('app-destructive-button')
            )
        ).toEqual([false, true]);
    });

    it('warns about every device only with server storage', () => {
        const warning = () =>
            fixture.nativeElement.querySelector(
                '[data-test-id="delete-all-server-warning"]'
            );
        expect(warning()).toBeNull();

        TestBed.inject(ServerStorageStatusService).activate(
            {
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: 'i',
                storage: 'server',
                auth: 'none',
            },
            () => undefined
        );
        fixture.detectChanges();

        expect(warning()).not.toBeNull();
    });
});
