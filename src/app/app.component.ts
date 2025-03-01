import { Component, NgZone } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { isTauri } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { ModalWindow } from 'ngx-whats-new/lib/modal-window.interface';
import { firstValueFrom } from 'rxjs';
import * as semver from 'semver';
import { IpcCommand } from '../../shared/ipc-command.class';
import {
    AUTO_UPDATE_PLAYLISTS,
    ERROR,
    OPEN_FILE,
    SETTINGS_UPDATE,
    SHOW_WHATS_NEW,
    VIEW_ADD_PLAYLIST,
    VIEW_SETTINGS,
} from '../../shared/ipc-commands';
import { DataService } from './services/data.service';
import { EpgService } from './services/epg.service';
import { PlaylistsService } from './services/playlists.service';
import { SettingsService } from './services/settings.service';
import { WhatsNewService } from './services/whats-new.service';
import { Language } from './settings/language.enum';
import { Settings } from './settings/settings.interface';
import { Theme } from './settings/theme.enum';
import { STORE_KEY } from './shared/enums/store-keys.enum';
import * as PlaylistActions from './state/actions';
import { RecentlyViewedComponent } from './xtream-tauri/recently-viewed/recently-viewed.component';
import { SearchResultsComponent } from './xtream-tauri/search-results/search-results.component';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
})
export class AppComponent {
    /** Visibility flag of the "what is new" modal dialog */
    isDialogVisible$ = this.whatsNewService.dialogState$;

    /** Dialog options */
    options = this.whatsNewService.options;

    /** Modals to show for the updated version of the application */
    modals: ModalWindow[] = [];

    /** List of ipc commands with function mapping */
    commandsList = [
        new IpcCommand(VIEW_ADD_PLAYLIST, () => this.navigateToRoute('/')),
        new IpcCommand(VIEW_SETTINGS, () => this.navigateToRoute('/settings')),
        new IpcCommand(SHOW_WHATS_NEW, () => this.showWhatsNewDialog()),
        new IpcCommand(ERROR, (response: { message: string; status: number }) =>
            this.showErrorAsNotification(response)
        ),
    ];

    /** Default language as fallback */
    DEFAULT_LANG = Language.ENGLISH;

    listeners = [];

    constructor(
        private dataService: DataService,
        private dialog: MatDialog,
        private epgService: EpgService,
        private ngZone: NgZone,
        private playlistService: PlaylistsService,
        private router: Router,
        private store: Store,
        private snackBar: MatSnackBar,
        private translate: TranslateService,
        private settingsService: SettingsService,
        private whatsNewService: WhatsNewService
    ) {
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
        if (isTauri()) {
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
        }
    }

    ngOnInit() {
        this.store.dispatch(PlaylistActions.loadPlaylists());
        this.translate.setDefaultLang(this.DEFAULT_LANG);

        this.setRendererListeners();
        this.initSettings();
        this.handleWhatsNewDialog();

        this.triggerAutoUpdateMechanism();
        this.checkForUpdates();
    }

    async checkForUpdates() {
        if (isTauri()) {
            const update = await check();
            if (update?.available) {
                console.log(
                    `found update ${update.version} from ${update.date} with notes ${update.body}`
                );
                let downloaded = 0;
                let contentLength = 0;

                const wantsUpdate = await ask(
                    `New version ${update.version} is available. Do you want to update now?`
                );

                if (wantsUpdate) {
                    await update.downloadAndInstall((event) => {
                        switch (event.event) {
                            case 'Started':
                                contentLength = event.data.contentLength;
                                console.log(
                                    `started downloading ${event.data.contentLength} bytes`
                                );
                                break;
                            case 'Progress':
                                downloaded += event.data.chunkLength;
                                console.log(
                                    `downloaded ${downloaded} from ${contentLength}`
                                );
                                break;
                            case 'Finished':
                                console.log('download finished');
                                break;
                        }
                    });

                    console.log('update installed');
                    await relaunch();
                }
            }
        }
    }

    async triggerAutoUpdateMechanism() {
        if (this.dataService.isElectron) {
            const playlistForAutoUpdate = await firstValueFrom(
                this.playlistService.getPlaylistsForAutoUpdate()
            );
            if (playlistForAutoUpdate && playlistForAutoUpdate.length > 0)
                this.dataService.sendIpcEvent(
                    AUTO_UPDATE_PLAYLISTS,
                    playlistForAutoUpdate
                );
        }
    }

    /**
     * Initializes all necessary listeners for the events from the renderer process
     */
    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            if (this.dataService.isElectron) {
                this.dataService.listenOn(command.id, () =>
                    this.ngZone.run((data) => command.callback(data))
                );
            } else {
                const cb = (response) => {
                    if (response.data.type === command.id) {
                        command.callback(response.data);
                    }
                };
                this.dataService.listenOn(command.id, cb);
                this.listeners.push(cb);
            }
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
                    this.dataService.sendIpcEvent(SETTINGS_UPDATE, settings);
                    this.translate.use(settings.language ?? this.DEFAULT_LANG);
                    if (
                        settings.epgUrl?.length > 0 &&
                        settings.epgUrl?.some((u) => u !== '') &&
                        isTauri()
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
    handleWhatsNewDialog(): void {
        const actualVersion = this.dataService.getAppVersion();
        this.settingsService
            .getValueFromLocalStorage(STORE_KEY.Version)
            .subscribe((version: string) => {
                const isNewVersion = semver.gt(
                    actualVersion,
                    version || '0.0.0'
                );
                if (!version || isNewVersion) {
                    this.modals =
                        this.whatsNewService.getModalsByVersion(actualVersion);
                    this.setDialogVisibility(true);
                }
                this.settingsService.setValueToLocalStorage(
                    STORE_KEY.Version,
                    actualVersion
                );
            });
    }

    /**
     * Sets the visibility flag of the modal window
     * @param visible show/hide window flag
     */
    setDialogVisibility(visible: boolean): void {
        if (this.modals.length > 0) {
            this.whatsNewService.changeDialogVisibleState(visible);
        }
    }

    /**
     * Navigate to the specified route
     * @param route route to navigate to
     */
    navigateToRoute(route: string) {
        this.router.navigateByUrl(route);
    }

    /**
     * Shows the "what is new" dialog
     */
    showWhatsNewDialog(): void {
        this.modals = this.whatsNewService.getModalsByVersion(
            this.dataService.getAppVersion()
        );
        this.setDialogVisibility(true);
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
