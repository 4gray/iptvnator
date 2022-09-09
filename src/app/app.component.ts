import { Component, NgZone } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { ModalWindow } from 'ngx-whats-new/lib/modal-window.interface';
import * as semver from 'semver';
import { IpcCommand } from '../../shared/ipc-command.class';
import {
    EPG_ERROR,
    EPG_FETCH_DONE,
    ERROR,
    OPEN_FILE,
    SHOW_WHATS_NEW,
    VIEW_ADD_PLAYLIST,
    VIEW_SETTINGS,
} from '../../shared/ipc-commands';
import { DataService } from './services/data.service';
import { EpgService } from './services/epg.service';
import { SettingsService } from './services/settings.service';
import { WhatsNewService } from './services/whats-new.service';
import { Language } from './settings/language.enum';
import { Settings } from './settings/settings.interface';
import { Theme } from './settings/theme.enum';
import { STORE_KEY } from './shared/enums/store-keys.enum';

/**
 * AppComponent
 */
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
        new IpcCommand(EPG_FETCH_DONE, () => this.epgService.onEpgFetchDone()),
        new IpcCommand(EPG_ERROR, () => this.epgService.onEpgError()),
        new IpcCommand(SHOW_WHATS_NEW, () => this.showWhatsNewDialog()),
        new IpcCommand(
            ERROR,
            (response: { message: string; status: number }) => {
                this.snackBar.open(
                    `Error: ${response.status} ${response.message}.`,
                    null,
                    { duration: 2000 }
                );
            }
        ),
    ];

    /** Default language as fallback */
    DEFAULT_LANG = Language.ENGLISH;

    /**
     * Creates an instance of AppComponent
     */
    constructor(
        private electronService: DataService,
        private epgService: EpgService,
        private ngZone: NgZone,
        private router: Router,
        private snackBar: MatSnackBar,
        private translate: TranslateService,
        private settingsService: SettingsService,
        private whatsNewService: WhatsNewService
    ) {
        if (
            ((this.electronService.isElectron &&
                this.electronService?.remote?.process.platform === 'linux') ||
                this.electronService?.remote?.process.platform === 'win32') &&
            this.electronService.remote.process.argv.length > 2
        ) {
            const filePath = this.electronService.remote.process.argv.find(
                (filepath) =>
                    filepath.endsWith('.m3u') || filepath.endsWith('.m3u8')
            );
            if (filePath) {
                const filePathsArray = filePath.split('/');
                const fileName = filePathsArray[filePathsArray.length - 1];
                this.electronService.sendIpcEvent(OPEN_FILE, {
                    filePath,
                    fileName,
                });
            }
        }
    }

    /**
     * Starts all the functions to initialize the component
     */
    ngOnInit(): void {
        this.translate.setDefaultLang(this.DEFAULT_LANG);

        this.setRendererListeners();
        this.initSettings();
        this.handleWhatsNewDialog();
    }

    /**
     * Initializes all necessary listeners for the events from the renderer process
     */
    setRendererListeners(): void {
        if (this.electronService.isElectron) {
            this.commandsList.forEach((command) =>
                this.electronService.listenOn(command.id, () =>
                    this.ngZone.run((data) => command.callback(data))
                )
            );
        }
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
                    this.translate.use(settings.language ?? this.DEFAULT_LANG);
                    if (settings.epgUrl) {
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
        const actualVersion = this.electronService.getAppVersion();
        this.settingsService
            .getValueFromLocalStorage(STORE_KEY.Version)
            .subscribe((version) => {
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
            this.electronService.getAppVersion()
        );
        this.setDialogVisibility(true);
    }

    /**
     * Removes all ipc command listeners on component destroy
     */
    ngOnDestroy(): void {
        this.electronService.removeAllListeners(EPG_FETCH_DONE);
        this.electronService.removeAllListeners(EPG_ERROR);
        this.electronService.removeAllListeners(VIEW_ADD_PLAYLIST);
        this.electronService.removeAllListeners(VIEW_SETTINGS);
    }
}
