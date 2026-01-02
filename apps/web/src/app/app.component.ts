import { Component, HostBinding, inject, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterOutlet } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions, selectAllPlaylistsMeta } from 'm3u-state';
import { filter, take } from 'rxjs';
import { DataService, EpgService } from 'services';
import {
    AUTO_UPDATE_PLAYLISTS,
    Language,
    OPEN_FILE,
    Settings,
    STORE_KEY,
    Theme,
} from 'shared-interfaces';
import { SettingsService } from './services/settings.service';
import { RecentlyViewedComponent } from './xtream-tauri/recently-viewed/recently-viewed.component';
import { SearchResultsComponent } from './xtream-tauri/search-results/search-results.component';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    imports: [RouterOutlet],
})
export class AppComponent implements OnInit {
    @HostBinding('class.macos-platform') get isMacOS() {
        return (
            window.electron && navigator.platform.toLowerCase().includes('mac')
        );
    }
    private actions$ = inject(Actions);
    private dataService = inject(DataService);
    private dialog = inject(MatDialog);
    private epgService = inject(EpgService);
    private router = inject(Router);
    private store = inject(Store);
    private translate = inject(TranslateService);
    private settingsService = inject(SettingsService);

    /** Default language as fallback */
    private readonly DEFAULT_LANG = Language.ENGLISH;

    constructor() {
        if (
            ((this.dataService.isElectron &&
                this.dataService?.remote?.process.platform === 'linux') ||
                this.dataService?.remote?.process.platform === 'win32') &&
            this.dataService.remote.process.argv.length > 2
        ) {
            const filePath = this.dataService.remote.process.argv.find(
                (filepath) =>
                    filepath.endsWith('.m3u') || filepath.endsWith('.m3u8')
            );
            if (filePath) {
                const filePathsArray = filePath.split('/');
                const fileName = filePathsArray[filePathsArray.length - 1];
                this.dataService.sendIpcEvent(OPEN_FILE, {
                    filePath,
                    fileName,
                });
            }
        }
        /* if (isTauri()) {
            document.addEventListener('keydown', (event) => {
                if (event.ctrlKey || event.metaKey) {
                    if (event.key === 'f') {
                        event.preventDefault();
                        this.openGlobalSearch();
                    } else if (event.key === 'r') {
                        event.preventDefault();
                        this.openGlobalRecent();
                    }
                }
            });
        } */
    }

    ngOnInit() {
        this.store.dispatch(PlaylistActions.loadPlaylists());
        this.translate.setDefaultLang(this.DEFAULT_LANG);

        this.initSettings();
        this.triggerAutoUpdatePlaylists();
    }

    /**
     * Reads the settings object from local storage and initializes the
     * application based on them
     */
    initSettings(): void {
        this.settingsService
            .getValueFromLocalStorage(STORE_KEY.Settings)
            .subscribe((settings: Settings) => {
                if (settings && Object.keys(settings).length > 0) {
                    // No need to send settings to Electron on init
                    // Settings are stored in IndexedDB and loaded by the settings store
                    // Only specific Electron settings (MPV/VLC paths) are sent when changed in settings component

                    this.translate.use(settings.language ?? this.DEFAULT_LANG);

                    // Fetch EPG if URLs are configured (only fetch stale data)
                    if (
                        window.electron &&
                        settings.epgUrl?.length > 0 &&
                        settings.epgUrl?.some((u) => u !== '')
                    ) {
                        this.fetchStaleEpgData(settings.epgUrl);
                    }

                    if (settings.theme) {
                        this.settingsService.changeTheme(settings.theme);
                    } else {
                        this.detectDarkMode();
                    }
                } else {
                    this.detectDarkMode();
                }
            });
    }

    /**
     * Detects if the operation system uses dark mode and changes the theme
     */
    detectDarkMode(): void {
        if (
            window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: dark)').matches
        ) {
            this.settingsService.changeTheme(Theme.DarkTheme);
            this.settingsService.setValueToLocalStorage(STORE_KEY.Settings, {
                theme: Theme.DarkTheme,
            });
        }
    }

    /**
     * Navigate to the specified route
     * @param route route to navigate to
     */
    navigateToRoute(route: string) {
        this.router.navigateByUrl(route);
    }

    openGlobalSearch(): void {
        this.dialog.open(SearchResultsComponent, {
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            panelClass: 'global-search-overlay',
            data: { isGlobalSearch: true },
        });
    }

    openGlobalRecent(): void {
        this.dialog.open(RecentlyViewedComponent, {
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            panelClass: 'global-search-overlay',
            data: { isGlobal: true },
            hasBackdrop: true,
            disableClose: false,
        });
    }

    /**
     * Fetches EPG data only for URLs that have stale or missing data.
     * Data is considered fresh if updated within the last 12 hours.
     */
    private async fetchStaleEpgData(urls: string[]): Promise<void> {
        try {
            const result = await window.electron.checkEpgFreshness(urls, 12);

            if (result.freshUrls.length > 0) {
                console.log(
                    `EPG: ${result.freshUrls.length} source(s) already fresh, skipping fetch`
                );
            }

            if (result.staleUrls.length > 0) {
                console.log(
                    `EPG: Fetching ${result.staleUrls.length} stale source(s)`
                );
                this.epgService.fetchEpg(result.staleUrls);
            }
        } catch (error) {
            console.error('Error checking EPG freshness, fetching all:', error);
            // Fallback: fetch all URLs if freshness check fails
            this.epgService.fetchEpg(urls);
        }
    }

    /**
     * Triggers auto-update for playlists that have autoRefresh enabled
     */
    private triggerAutoUpdatePlaylists(): void {
        // Wait for playlists to be loaded successfully
        this.actions$
            .pipe(
                ofType(PlaylistActions.loadPlaylistsSuccess),
                take(1) // Only trigger once on app startup
            )
            .subscribe(() => {
                // Get all playlists from store
                this.store
                    .select(selectAllPlaylistsMeta)
                    .pipe(
                        take(1),
                        filter((playlists) => playlists.length > 0)
                    )
                    .subscribe((playlists) => {
                        // Filter playlists with autoRefresh enabled
                        const playlistsToUpdate = playlists.filter(
                            (playlist) => playlist.autoRefresh === true
                        );

                        // Trigger auto-update if there are playlists to update
                        if (playlistsToUpdate.length > 0) {
                            console.log(
                                `Auto-updating ${playlistsToUpdate.length} playlist(s) on startup`
                            );
                            this.dataService.sendIpcEvent(
                                AUTO_UPDATE_PLAYLISTS,
                                playlistsToUpdate
                            );
                        }
                    });
            });
    }
}
