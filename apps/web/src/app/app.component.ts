import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
/* import * as semver from 'semver'; */
import * as PlaylistActions from 'm3u-state';
import { DataService, EpgService } from 'services';
import {
    ERROR,
    IpcCommand,
    Language,
    OPEN_FILE,
    Settings,
    STORE_KEY,
    Theme,
    VIEW_ADD_PLAYLIST,
    VIEW_SETTINGS,
} from 'shared-interfaces';
import { SettingsService } from './services/settings.service';
import { RecentlyViewedComponent } from './xtream-tauri/recently-viewed/recently-viewed.component';
import { SearchResultsComponent } from './xtream-tauri/search-results/search-results.component';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    imports: [RouterOutlet],
})
export class AppComponent implements OnInit, OnDestroy {
    private dataService = inject(DataService);
    private dialog = inject(MatDialog);
    private epgService = inject(EpgService);
    private router = inject(Router);
    private store = inject(Store);
    private snackBar = inject(MatSnackBar);
    private translate = inject(TranslateService);
    private settingsService = inject(SettingsService);

    /** List of ipc commands with function mapping */
    private readonly commandsList = [
        new IpcCommand(VIEW_ADD_PLAYLIST, () => this.navigateToRoute('/')),
        new IpcCommand(VIEW_SETTINGS, () => this.navigateToRoute('/settings')),
        new IpcCommand(ERROR, (response: { message: string; status: number }) =>
            this.showErrorAsNotification(response)
        ),
    ];

    /** Default language as fallback */
    private readonly DEFAULT_LANG = Language.ENGLISH;

    private listeners = [];

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

        this.setRendererListeners();
        this.initSettings();
        /* this.handleWhatsNewDialog(); */
    }

    /**
     * Initializes all necessary listeners for the events from the renderer process
     */
    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            const cb = (response) => {
                if (response.data.type === command.id) {
                    command.callback(response.data);
                }
            };
            this.dataService.listenOn(command.id, cb);
            this.listeners.push(cb);
        });
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

                    // Fetch EPG if URLs are configured
                    if (
                        window.electron &&
                        settings.epgUrl?.length > 0 &&
                        settings.epgUrl?.some((u) => u !== '')
                    ) {
                        this.epgService.fetchEpg(settings.epgUrl);
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
     * Checks the actual version of the application and shows the "what is new" dialog if the updated version was detected
     */
    /* handleWhatsNewDialog(): void {
        const actualVersion = this.dataService.getAppVersion();
        this.settingsService
            .getValueFromLocalStorage(STORE_KEY.Version)
            .subscribe(() => {
                this.settingsService.setValueToLocalStorage(
                    STORE_KEY.Version,
                    actualVersion
                );
            });
    } */

    /**
     * Navigate to the specified route
     * @param route route to navigate to
     */
    navigateToRoute(route: string) {
        this.router.navigateByUrl(route);
    }

    showErrorAsNotification(response: { message: string; status: number }) {
        this.snackBar.open(
            `Error: ${response?.message ?? 'Something went wrong'} (Status: ${
                response?.status ?? 0
            })`,
            null,
            { duration: 4000 }
        );
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
     * Removes all ipc command listeners on component destroy
     */
    ngOnDestroy(): void {
        if (this.dataService.isElectron) {
            this.commandsList.forEach((command) =>
                this.dataService.removeAllListeners(command.id)
            );
        } else {
            this.listeners.forEach((listener) =>
                window.removeEventListener('message', listener)
            );
        }
    }
}
