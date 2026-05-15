import { Component, effect, HostBinding, inject, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterOutlet } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { EpgService } from '@iptvnator/epg/data-access';
import { WORKSPACE_SHELL_ACTIONS } from '@iptvnator/workspace/shell/util';
import { EpgProgressPanelComponent } from '@iptvnator/ui/epg/progress-panel';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { filter, take } from 'rxjs';
import { DataService, SettingsStore } from '@iptvnator/services';
import {
    AUTO_UPDATE_PLAYLISTS,
    Language,
    OPEN_FILE,
    Settings,
    STORE_KEY,
    Theme,
    createDevLogger,
} from '@iptvnator/shared/interfaces';
import { SettingsService } from './services/settings.service';

const debugAppComponent = createDevLogger('AppComponent');

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    imports: [EpgProgressPanelComponent, RouterOutlet],
})
export class AppComponent implements OnInit {
    @HostBinding('class.macos-platform') get isMacOS() {
        return (
            window.electron && navigator.platform.toLowerCase().includes('mac')
        );
    }
    private actions$ = inject(Actions);
    private dataService = inject(DataService);
    private epgService = inject(EpgService);
    private snackBar = inject(MatSnackBar);
    private router = inject(Router);
    private store = inject(Store);
    private translate = inject(TranslateService);
    private settingsService = inject(SettingsService);
    private settingsStore = inject(SettingsStore);
    private readonly workspaceShellActions = inject(WORKSPACE_SHELL_ACTIONS);

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
        effect(() => {
            const size = this.settingsStore.coverSize?.() ?? 'medium';
            document.documentElement.dataset.coverSize = size;
        });

        if (window.electron) {
            document.addEventListener('keydown', (event) => {
                if (event.ctrlKey || event.metaKey) {
                    if (event.key === 'f') {
                        event.preventDefault();
                        this.workspaceShellActions.openGlobalSearch();
                    } else if (event.key === 'r') {
                        event.preventDefault();
                        this.workspaceShellActions.openGlobalRecent();
                    }
                }
            });
        }
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

                    const resolvedLang = settings.language ?? this.DEFAULT_LANG;
                    this.translate.use(resolvedLang);
                    // Mirror the active language to localStorage so the next
                    // cold start can read it synchronously in app.config.ts's
                    // getInitialLanguage() and avoid the English-then-localized
                    // flash for non-English users.
                    try {
                        localStorage.setItem(
                            'iptvnator:preferred-language',
                            resolvedLang
                        );
                    } catch {
                        // Ignore quota / privacy mode errors.
                    }

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
     * Applies the operating system color scheme when no explicit theme is set
     */
    detectDarkMode(): void {
        this.settingsService.changeTheme(Theme.SystemTheme);
    }

    /**
     * Navigate to the specified route
     * @param route route to navigate to
     */
    navigateToRoute(route: string) {
        this.router.navigateByUrl(route);
    }

    /**
     * Fetches EPG data only for URLs that have stale or missing data.
     * Data is considered fresh if updated within the last 12 hours.
     */
    private async fetchStaleEpgData(urls: string[]): Promise<void> {
        try {
            const result = await window.electron.checkEpgFreshness(urls, 12);

            if (result.freshUrls.length > 0) {
                debugAppComponent(
                    `EPG: ${result.freshUrls.length} source(s) already fresh, skipping fetch`
                );
                // Show snackbar if all EPG sources are fresh (no stale URLs)
                if (result.staleUrls.length === 0) {
                    this.snackBar.open(
                        this.translate.instant('EPG.UP_TO_DATE'),
                        this.translate.instant('CLOSE'),
                        { duration: 3000 }
                    );
                }
            }

            if (result.staleUrls.length > 0) {
                debugAppComponent(
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
                            debugAppComponent(
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
